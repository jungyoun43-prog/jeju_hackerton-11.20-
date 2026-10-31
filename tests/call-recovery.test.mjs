import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase, applyAction } from '../app/domain.js';
import { CALL_RECOVERY_SCENARIOS, getCallAttemptGate, getCallRecoveryHandoffs } from '../app/call-recovery.js';
import { getCareJourneySummary } from '../app/care-journey.js';
import { createToolDispatcher } from '../agent/tools.mjs';
import { createAgentService } from '../agent/service.mjs';

const start=Date.parse('2026-10-31T12:00:00Z');
function fixture(reason='no_answer') {
  let clock=start,calls=0,answer=false;
  const adapter={isSimulation:true,async hospital(){calls++;return answer?{isSimulation:true,outcome:'documents'}:{isSimulation:true,outcome:'unreachable',failureReason:reason};},async support(){calls++;return {isSimulation:true,outcome:'unreachable',failureReason:reason};}};
  const dispatch=createToolDispatcher({phoneAdapter:adapter,clock:()=>clock});
  return {dispatch,calls:()=>calls,advance:minutes=>{clock+=minutes*60000;},answer:()=>{answer=true;}};
}
const contact=(f,state,target='mainland',extra={})=>f.dispatch({name:'request_hospital_contact',input:{target},state,...extra});
const policy=(f,state,maxAttempts=2,windowMinutes=15,extra={})=>f.dispatch({name:'update_call_retry_policy',input:{target:'mainland',maxAttempts,windowMinutes},state,userMessage:`무응답이면 ${windowMinutes}분 안에 최초 포함 최대 ${maxAttempts}회까지 재시도해 줘.`,...extra});

test('기본 무응답은 정책 미설정으로 두 번째 adapter 실행 전에 막고 이력·담당·남은 일을 보존한다',async()=>{
  const f=fixture();let result=await contact(f,createDemoCase());result=await contact(f,result.state);
  assert.equal(f.calls(),1);const handoff=getCallRecoveryHandoffs(result.state)[0];
  assert.equal(handoff.reason,'no_answer');assert.equal(handoff.status,'policy_required');assert.equal(handoff.stopAutomatic,true);
  assert.equal(handoff.attempts.length,1);assert.equal(handoff.retryPolicy.configured,false);assert.equal(handoff.retryPolicy.scheduled,false);
  assert.equal(handoff.actualCallPlaced,false);assert.ok(handoff.owner);assert.ok(handoff.remainingTasks.length);assert.ok(handoff.questions.length);assert.equal(handoff.contact.phone,null);
  assert.equal(result.events.at(-1).status,'needs_input');
});

test('총횟수 제한은 최초 포함이며 반복 도구·같은 정책 재적용으로 카운터와 시작·종료 시각을 초기화하지 않는다',async()=>{
  const f=fixture();let result=await policy(f,createDemoCase()),configured=structuredClone(result.data.retryPolicy);
  result=await contact(f,result.state);f.advance(1);result=await policy(f,result.state);
  assert.deepEqual(result.data.retryPolicy,configured);assert.equal(result.state.callRecovery.targets.mainland.attempts.length,1);
  result=await contact(f,result.state);result=await contact(f,result.state);result=await policy(f,result.state);result=await contact(f,result.state);
  assert.equal(f.calls(),2);const handoff=getCallRecoveryHandoffs(result.state)[0];
  assert.equal(handoff.attempts.length,2);assert.equal(handoff.status,'retry_exhausted');assert.equal(handoff.stopAutomatic,true);
  assert.equal(handoff.retryPolicy.startsAt,configured.startsAt);assert.equal(handoff.retryPolicy.expiresAt,configured.expiresAt);
});

test('시간 초과는 adapter 전에 차단하고 정책 재적용으로 지난 허용 시간을 되살리지 않는다',async()=>{
  const f=fixture();let result=await policy(f,createDemoCase(),3,1);result=await contact(f,result.state);f.advance(1);
  result=await contact(f,result.state);assert.equal(f.calls(),1);assert.equal(getCallRecoveryHandoffs(result.state)[0].status,'retry_expired');
  result=await policy(f,result.state,3,1);result=await contact(f,result.state);assert.equal(f.calls(),1);
  assert.equal(getCallRecoveryHandoffs(result.state)[0].retryPolicy.startsAt,'2026-10-31T12:00:00.000Z');
});

test('AI응대 거절·본인확인은 정책 설정과 모델 반복 호출로 재무장할 수 없고 담당자를 구분한다',async()=>{
  for(const reason of ['ai_declined','identity_required']) {
    const f=fixture(reason);let result=await contact(f,createDemoCase());result=await policy(f,result.state,3,120);
    result=await contact(f,result.state);result=await contact(f,result.state);
    assert.equal(f.calls(),1);const handoff=getCallRecoveryHandoffs(result.state)[0];
    assert.equal(handoff.reason,reason);assert.equal(handoff.status,'handed_off');assert.equal(handoff.stopAutomatic,true);
    assert.equal(handoff.owner,reason==='identity_required'?'환자 본인':'보호자');
    assert.equal(handoff.attempts.length,1);assert.equal(handoff.actualCallPlaced,false);
  }
});

test('재시도 정책은 명시된 재시도 총횟수·시간만 허용하며 일정/나이 숫자·임의 시계/결과를 받지 않는다',async()=>{
  const f=fixture(),state=createDemoCase();
  for(const userMessage of ['68세이고 11월 12일 15시에 진료해요. 2명이 갑니다.','재시도하지 말아 주세요. 15분 안에 최대 2회도 하지 마세요.','15분 안에 최대 2회 운동했어요.']) await assert.rejects(policy(f,state,2,15,{userMessage}),e=>e.code==='EXPLICIT_RETRY_POLICY_REQUIRED');
  for(const input of [{target:'mainland',maxAttempts:4,windowMinutes:15},{target:'mainland',maxAttempts:2,windowMinutes:121},{target:'mainland',maxAttempts:2,windowMinutes:15,at:'2026-10-31T00:00:00Z'}]) await assert.rejects(f.dispatch({name:'update_call_retry_policy',input,state,userMessage:'15분 안에 최대 2회 재시도해줘'}),e=>e.code==='INVALID_TOOL_ARGUMENTS');
  assert.equal(f.calls(),0);
});

test('서류 부족은 자료 태스크에 연결하고 자료 보완 뒤 합성응답에도 과거 실패·담당·남은 일을 숨기지 않는다',async()=>{
  const f=fixture('missing_documents');let result=await contact(f,createDemoCase());result=await contact(f,result.state);
  assert.equal(f.calls(),1);let summary=getCareJourneySummary(result.state);
  assert.equal(summary.handoffs[0].reason,'missing_documents');assert.equal(summary.handoffs[0].status,'blocked');
  assert.ok(summary.tasks.some(x=>x.id==='report-obtain'));assert.match(summary.handoffs[0].remainingTasks.join(' '),/발급.*작성일.*제출/);
  result=await f.dispatch({name:'request_records',input:{source:'demo'},state:result.state});f.answer();result=await contact(f,result.state);
  assert.equal(f.calls(),2);summary=getCareJourneySummary(result.state);
  assert.equal(summary.handoffs[0].reason,'missing_documents');assert.equal(summary.handoffs[0].status,'followup_required');
  assert.deepEqual(summary.handoffs[0].attempts.map(x=>x.outcome),['missing_documents','answered']);
  assert.ok(summary.handoffs[0].remainingTasks.length);assert.equal(summary.boundary.reservationConfirmed,false);
});

test('예약 불가 뒤 다른 날짜 문의는 새 사용자 요청의 명시 허용으로만 한 번 열고 날짜를 선택하지 않는다',async()=>{
  const f=fixture('no_slots');let result=await contact(f,createDemoCase(),'jeju');const date=result.state.patient.nextVisit;
  result=await contact(f,result.state,'jeju');assert.equal(f.calls(),1);
  result=await contact(f,result.state,'jeju',{userMessage:'다른 날짜도 문의해 줘.',requestId:'allowed-alternate-0001'});assert.equal(f.calls(),2);
  result=await contact(f,result.state,'jeju',{userMessage:'다른 날짜도 문의해 줘.',requestId:'allowed-alternate-0001'});assert.equal(f.calls(),2);
  const handoff=getCallRecoveryHandoffs(result.state)[0];assert.equal(handoff.reason,'no_slots');assert.equal(handoff.status,'waiting_user');
  assert.equal(handoff.attempts.length,2);assert.equal(result.state.patient.nextVisit,date);assert.match(handoff.detail,/임의 선택/);
});

test('이동·동행 지원도 같은 gate를 사용하고 정책 미설정·거절 뒤 adapter에 다시 접근하지 않는다',async()=>{
  for(const reason of ['no_answer','ai_declined','identity_required']) {
    const f=fixture(reason);let result=await f.dispatch({name:'prepare_inquiries',input:{kind:'taxi'},state:createDemoCase()});
    result=await f.dispatch({name:'request_support_contact',input:{kind:'taxi'},state:result.state});
    result=await f.dispatch({name:'request_support_contact',input:{kind:'taxi'},state:result.state});
    assert.equal(f.calls(),1);const handoff=getCallRecoveryHandoffs(result.state)[0];assert.match(handoff.contact.phone,/^0|^1899/);
    assert.equal(handoff.stopAutomatic,true);assert.equal(handoff.attempts.length,1);
  }
});

test('4개 고정복구 preview는 명시 시연만 허용하며 키·store·모델 없이 같은 reducer와 gate를 실행한다',async()=>{
  const service=createAgentService({store:new Proxy({},{get(){throw new Error('preview must not persist');}})});
  assert.equal(CALL_RECOVERY_SCENARIOS.length,4);
  for(const {id} of CALL_RECOVERY_SCENARIOS) {
    const response=await service.handleAgentRequest({method:'POST',path:'/api/agent/preview',body:{scenarioId:id,requestId:'recovery-preview-test-001'}});
    assert.equal(response.statusCode,200);const body=JSON.parse(response.body),summary=getCareJourneySummary(body.caseState);
    assert.equal(body.isPreview,true);assert.equal(body.capabilities.llm,false);assert.equal(body.sessionId,'');assert.ok(summary.handoffs.length);
    for(const handoff of summary.handoffs){assert.equal(handoff.stopAutomatic,true);assert.equal(handoff.actualCallPlaced,false);assert.equal(handoff.retryPolicy.scheduled,false);}
    assert.ok(body.events.some(x=>/자동 문의 중단/.test(x.label)));
  }
  const dispatch=createToolDispatcher();for(const userMessage of ['병원 문의를 도와줘','무응답 시연이 무엇인지 설명해 줘','무응답 시연하지 말고 실제로 전화해줘']) await assert.rejects(dispatch({name:'run_call_recovery_demo',input:{scenarioId:'call_no_answer'},state:createDemoCase(),userMessage}),e=>e.code==='EXPLICIT_DEMO_REQUIRED');
});


test('새 기관 명시 선택 뒤에도 이전 수신처 실패·공개 연락처에 묶어 보존하고 새 기관의 거절로 표시하지 않는다',async()=>{
  const f=fixture('ai_declined');let result=await f.dispatch({name:'select_hospital_contact',input:{hospitalId:'hospital-4'},state:createDemoCase(),userMessage:'제주우리병원으로 문의해줘'});
  result=await contact(f,result.state,'jeju');const original=getCallRecoveryHandoffs(result.state)[0];
  result=await f.dispatch({name:'select_hospital_contact',input:{hospitalId:'hospital-13'},state:result.state,userMessage:'제주선한병원으로 문의해줘'});
  result=await contact(f,result.state,'jeju');const handoff=getCallRecoveryHandoffs(result.state)[0];
  assert.equal(f.calls(),1);assert.deepEqual(handoff.contact,original.contact);assert.equal(handoff.contact.name,'제주우리병원');
  assert.equal(result.state.patient.localHospital,'제주선한병원');assert.match(handoff.detail,/새 기관의 거절로 해석하지/);
  assert.equal(handoff.attempts.length,1);
});


test('허용 시간 안에 시작한 느린 합성 문의도 시도 이력을 남기고 같은 서류 부족 반복 응답을 유실하지 않는다',async()=>{
  let clock=start,calls=0;
  const dispatch=createToolDispatcher({clock:()=>clock,phoneAdapter:{isSimulation:true,async hospital(){calls++;clock+=61000;return {isSimulation:true,outcome:'unreachable',failureReason:'no_answer'};}}});
  let result=await dispatch({name:'update_call_retry_policy',input:{target:'mainland',maxAttempts:2,windowMinutes:1},state:createDemoCase(),userMessage:'1분 안에 최대2회 재시도해줘'});
  result=await dispatch({name:'request_hospital_contact',input:{target:'mainland'},state:result.state});
  assert.equal(result.state.callRecovery.targets.mainland.attempts.length,1);
  result=await dispatch({name:'request_hospital_contact',input:{target:'mainland'},state:result.state});assert.equal(calls,1);assert.equal(getCallRecoveryHandoffs(result.state)[0].status,'retry_expired');
  const f=fixture('missing_documents');let repeated=await contact(f,createDemoCase());
  repeated=await f.dispatch({name:'request_records',input:{source:'demo'},state:repeated.state});repeated=await contact(f,repeated.state);
  assert.equal(f.calls(),2);assert.equal(getCallRecoveryHandoffs(repeated.state)[0].attempts.length,2);
  assert.equal(repeated.state.documents.find(item=>item.id==='report').status,'missing');
});

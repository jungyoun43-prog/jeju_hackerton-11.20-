import test from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createCloudAgentRequestHandler } from '../agent/cloud-runtime.mjs';
import assert from 'node:assert/strict';
import { createAgentService } from '../agent/service.mjs';
import { getGuidedDemo } from '../app/guided-demo.js';
import { getPreparationWorkflow } from '../app/preparation-workflow.js';
import { buildCallPlan } from '../app/call-policy.js';

const requestId='guided-test-0001';
const choices=[['records_ready','records_missing'],['hospitals_accept','hospitals_declined'],['support_taxi','support_wheelchair'],['plan_keep','plan_changed']];
const post=(service,body)=>service.handleAgentRequest({method:'POST',path:'/api/agent/preview',headers:{'Content-Type':'application/json'},body:{scenarioId:'guided-visit',requestId,...body}});
const semantic=value=>JSON.parse(JSON.stringify(value,(key,item)=>['at','createdAt','updatedAt','confirmedAt','checkedAt'].includes(key)||key==='id'&&typeof item==='string'&&/^[0-9a-f]{8}-[0-9a-f-]{27}$/.test(item)?undefined:item));

test('16개 고정 선택 조합은 도구·공개 출처를 사용하며 미확보·거절·동행 인계와 실제 미실행 경계를 보존한다',async()=>{
  let calls=0;
  const forbidden=()=>{calls++;throw new Error('외부 실행 금지');};
  const service=createAgentService({provider:{connected:true,respond:forbidden},store:{loadOrCreate:forbidden,save:forbidden,consumeTurn:forbidden,acquireLease:forbidden}});
  for(const records of choices[0]) for(const hospitals of choices[1]) for(const support of choices[2]) for(const plan of choices[3]) {
    const answers=[records,hospitals,support,plan];
    const response=await post(service,{answers});
    assert.equal(response.statusCode,200,response.body);
    const body=JSON.parse(response.body),state=body.caseState;
    assert.equal(body.guidedDemo.complete,true);
    assert.equal(body.guidedDemo.stepId,'plan');
    assert.deepEqual(body.guidedDemo.choices,[]);
    assert.equal(body.previewMessages.length,9);
    assert.deepEqual(body.previewMessages.map(item=>item.role),['assistant','user','assistant','user','assistant','user','assistant','user','assistant']);
    assert.equal(body.reply,body.previewMessages.at(-1).text);
    assert.ok(body.events.length<=24);
    assert.equal(state.documents.find(item=>item.id==='report').status,records==='records_ready'?'ready':'missing');
    assert.equal(state.documents.find(item=>item.id==='exam').status,'not_performed');
    assert.equal(state.documents.find(item=>item.id==='referral').status,'missing');
    assert.equal(state.permissions.share,false);
    assert.equal(state.inquiries.jeju.status,hospitals==='hospitals_accept'?'confirmed':'not_participating');
    assert.equal(state.visitSupport.requirements.appointmentTime,plan==='plan_changed'?'14:00':'10:00');
    assert.equal(state.visitSupport.taxi.status,plan==='plan_changed'?'needs_recheck':'available_demo');
    assert.equal(state.visitSupport.companion.status,plan==='plan_changed'?'needs_recheck':'unreachable_demo');
    assert.equal(state.visitSupport.taxi.provider.id==='jeju-accessible-transport',support==='support_wheelchair');
    assert.ok(body.careJourney.handoffs.some(item=>item.target==='companion'&&item.reason==='no_answer'));
    assert.equal(body.careJourney.pathway.status,'unconfirmed');
    assert.equal(getPreparationWorkflow(state).visitReady,false);
    for(const target of ['jeju','mainland','taxi','companion']) assert.equal(buildCallPlan(state,target).actualCallPlaced,false);
    assert.ok(body.events.some(item=>item.tool==='request_records'&&item.status==='not_connected'));
    assert.ok(body.events.some(item=>item.tool==='search_hospital_contacts'&&item.source==='https://jejudatahub.net/data/view/data/859'));
    assert.ok(body.events.some(item=>item.tool==='prepare_inquiries'&&item.source.startsWith('https://')));
    if(records==='records_missing') assert.ok(state.careJourney.findings.some(item=>item.id==='report_issuance'));
    if(records==='records_missing'&&hospitals==='hospitals_accept') assert.ok(state.careJourney.findings.some(item=>item.id==='report_submission'));
    if(support==='support_wheelchair') assert.match(state.visitSupport.taxi.inquiry,/병원 휠체어 대여·수령·반납이 미확인/);
    const repeated=JSON.parse((await post(service,{answers})).body);
    assert.deepEqual(semantic(repeated),semantic(body));
  }
  assert.equal(calls,0);
});

test('시작과 각 선택은 순차 metadata·전체 대화 이력을 반환하고 이전 단계의 상태를 보존한다',async()=>{
  const service=createAgentService();
  for(let length=0;length<=4;length++) {
    const answers=choices.map(items=>items[0]).slice(0,length);
    const response=await post(service,{answers});
    assert.equal(response.statusCode,200);
    const body=JSON.parse(response.body);
    assert.deepEqual(body.guidedDemo,getGuidedDemo(answers));
    assert.equal(body.previewMessages.length,1+length*2);
    assert.equal(body.caseState.patient.nextVisit,'2026-11-12');
    assert.equal(body.caseState.patient.area,'제주시 애월읍');
    if(length<2) assert.equal(body.caseState.selectedHospital,undefined);
    if(length<3) assert.equal(body.caseState.visitSupport.taxi.status,'not_selected');
  }
});

test('잘못된 순서·건너뛰기·중복·미지 선택·초과·자유문·client state를 400으로 거절한다',async()=>{
  const service=createAgentService();
  for(const answers of [undefined,null,{},'records_ready',['unknown'],['hospitals_accept'],['records_ready','support_taxi'],['records_ready','records_ready'],[...choices.map(items=>items[0]),'plan_keep']]) {
    assert.equal(getGuidedDemo(answers),null);
    assert.equal((await post(service,{answers})).statusCode,400);
  }
  for(const extra of [{caseState:{}},{message:'자유 입력'},{state:{}},{source:'demo'}]) assert.equal((await post(service,{answers:[],...extra})).statusCode,400);
  assert.equal((await post(service,{scenarioId:'aewol-parent-visit',answers:[]})).statusCode,400);
  assert.equal((await post(service,{scenarioId:'aewol-parent-visit'})).statusCode,200);
});


test('HTTP 고정 체험은 200/400을 반환하고 cloud runtime·secret 초기화를 건너뛴다',async t=>{
  let runtimeCalls=0;
  const cloud=createCloudAgentRequestHandler({getRuntime:async()=>{runtimeCalls++;throw new Error('secret·DB 접근 금지');}});
  const body={scenarioId:'guided-visit',requestId,answers:choices.map(items=>items[1])};
  assert.equal((await cloud({method:'POST',path:'/api/agent/preview',headers:{'content-type':'application/json'},body})).statusCode,200);
  assert.equal(runtimeCalls,0);
  const child=spawn(process.execPath,['scripts/server.mjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,HOST:'127.0.0.1',PORT:'0',OPENAI_API_KEY:'',OPENAI_SECRET_ARN:'',SESSION_TABLE_NAME:''},stdio:['ignore','pipe','pipe']});
  t.after(async()=>{child.kill('SIGTERM');await once(child,'exit');});
  const base=await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(new Error('서버 시작 시간 초과')),5000);
    child.stdout.on('data',chunk=>{const match=chunk.toString().match(/Local: (http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timeout);resolve(match[1]);}});
    child.once('error',error=>{clearTimeout(timeout);reject(error);});
    child.once('exit',()=>{clearTimeout(timeout);reject(new Error('서버 종료'));});
  });
  for(const [input,status] of [[body,200],[{...body,answers:['support_wheelchair']},400],[{...body,caseState:{}},400]]) {
    const response=await fetch(base+'/api/agent/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    assert.equal(response.status,status);
    const result=await response.json();
    if(status===200) {assert.equal(result.guidedDemo.complete,true);assert.equal(result.caseState.visitSupport.taxi.status,'needs_recheck');}
  }
});

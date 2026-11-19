import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createAgentService} from '../agent/service.mjs';
import {createMemorySessionStore} from '../agent/store.mjs';
import {createToolDispatcher} from '../agent/tools.mjs';
import {visitSessionId} from '../agent/visit-recovery.mjs';
import {applyAction,createDemoCase} from '../app/domain.js';
import {currentSupportRecipients,getVisitSupportSummary} from '../app/visit-support.js';

const actions = (...calls) => ({
  stopReason:'tool_use',
  content:calls.map(([name,input,id]) => ({toolUse:{name,input,toolUseId:id}})),
});
const reply = text => ({stopReason:'end_turn',content:[{text}]});
const results = input => input.messages.at(-1).content.map(block => block.toolResult.content[0].json);

async function post(service, body, path='/api/agent') {
  const response = await service.handleAgentRequest({method:'POST',path,headers:{'Content-Type':'application/json'},body});
  assert.equal(response.statusCode,200,response.body);
  return JSON.parse(response.body);
}

test('성산 보호자의 4회 대화는 실제 327·254 문의처 → 휠체어 조건 충돌 → 선택한 공식 창구 → 타지역 조회를 이어간다 (모델 대역)',async () => {
  let ordinaryTaxi,companion;
  const steps = [
    () => actions(['update_visit',{area:'서귀포시 성산읍',date:'2026-12-08',appointmentTime:'14:00'},'visit']),
    () => actions(['analyze_public_data',{analysis:'support_candidates'},'local']),
    input => {
      const [analysis] = results(input);
      const first = kind => analysis.candidates.find(item => item.kind === kind);
      const taxi = first('taxi'), care = first('companion');
      assert.equal(taxi.name,'동성콜');
      assert.equal(taxi.source.datasetId,'327');
      assert.equal(care.name,'성산원광소규모요양시설');
      assert.equal(care.source.datasetId,'254');
      assert.equal(care.availabilityVerified,false);
      assert.deepEqual(analysis.datasetRefs.filter(ref => ['hub:327','hub:254'].includes(ref.id)).map(ref => ref.coverage.rowCount),[34,19]);
      ordinaryTaxi=taxi.id;companion=care.id;
      return actions(['prepare_inquiries',{kind:'taxi'},'taxi'],['prepare_inquiries',{kind:'companion'},'care']);
    },
    input => {
      const [taxi,care] = results(input);
      for (const [record,id,date] of [[taxi,'hub:327','2026-03-19'],[care,'hub:254','2020-04-17']]) {
        const basis = record.publicDataEvidence.recipient;
        assert.equal(basis.id,record.provider.id);
        assert.equal(basis.sourceId,id);
        assert.equal(basis.asOf,date);
        assert.equal(basis.sourceUrl,record.provider.source.url);
        assert.match(basis.locationMatch,/등록 지역 일치/);
        assert.equal(record.actualCallPlaced,false);
      }
      assert.match(care.draft,/현재 병원 동행을 제공하나요/);
      return reply('성산의 등록 차량·돌봄 문의처에 확인할 내용이 준비됐습니다.');
    },
    () => actions(['update_visit',{wheelchair:true},'wheelchair']),
    () => actions(['find_support',{kind:'taxi'},'list'],['prepare_inquiries',{kind:'taxi',providerId:ordinaryTaxi},'named-recipient']),
    input => {
      const [listing,conflict] = results(input);
      assert.deepEqual(listing.candidates.map(row => row.serviceType),['accessible_transport']);
      assert.equal(conflict.status,'recipient_needs_review');
      assert.equal(conflict.provider,undefined);
      assert.equal(conflict.suggestedProvider.id,'jeju-accessible-transport');
      assert.match(conflict.reason,/휠체어 탑승 차량 정보가 없/);
      return reply('지정한 업체는 탑승형 차량 정보를 확인할 수 없습니다. 이동지원센터로 문의처를 바꿀까요?');
    },
    () => actions(['prepare_inquiries',{kind:'taxi',providerId:'jeju-accessible-transport'},'new-recipient']),
    input => {
      const [taxi] = results(input);
      assert.equal(taxi.publicDataEvidence.recipient.sourceId,'official:jeju-accessible-transport');
      assert.equal(taxi.provider.phone,'1899-6884');
      assert.equal(taxi.publicDataEvidence.recipient.asOf,null);
      assert.match(taxi.draft,/이용 대상.*회원 등록/s);
      return reply('이동지원센터에 자격·회원등록·탑승 조건을 확인할 초안을 준비했습니다.');
    },
    () => actions(['analyze_public_data',{analysis:'support_candidates',area:'제주시 애월읍'},'explore']),
    input => {
      const [analysis] = results(input);
      assert.deepEqual(analysis.preparationActions,[]);
      assert.equal(analysis.caseMutation,false);
      return reply('애월 문의처는 조회만 했습니다.');
    },
  ];
  const provider = {connected:true,model:'tool-flow-fixture',async respond(input) {
    const next=steps.shift();
    assert.ok(next,'예정한 도구/정리 단계만 실행해야 합니다.');
    return next(input);
  }};
  const service=createAgentService({provider,dispatch:createToolDispatcher({phoneAdapter:null})});
  const visitToken=randomBytes(32).toString('base64url');
  const first=await post(service,{visitToken,requestId:'seongsan-routing-01',message:'성산에서 병원까지 일반 택시와 병원 동행 문의를 준비해 주세요.'});
  assert.equal(first.caseState.visitSupport.taxi.provider.id,ordinaryTaxi);
  assert.equal(first.caseState.visitSupport.companion.provider.id,companion);
  const turn=(requestId,message) => post(service,{sessionId:first.sessionId,visitToken,requestId,message});
  const second=await turn('seongsan-routing-02','휠체어에 앉아 가야 해요. 먼저 고른 동성콜에 문의해도 될까요?');
  assert.equal(second.caseState.visitSupport.taxi.provider,null);
  assert.equal(second.caseState.visitSupport.companion.provider.id,companion);
  assert.ok(second.events.some(event => event.tool === 'prepare_inquiries' && event.status === 'needs_input'));
  const third=await turn('seongsan-routing-03','그러면 제주 교통약자 이동지원센터로 문의 초안을 바꿔 주세요.');
  assert.equal(third.caseState.visitSupport.taxi.status,'prepared');
  assert.equal(third.caseState.visitSupport.taxi.wheelchairConfirmed,false);
  assert.equal(third.caseState.visitSupport.taxi.eligibilityConfirmed,false);
  const fourth=await turn('seongsan-routing-04','애월의 후보도 비교만 해 주세요. 성산에서 출발하는 계획은 그대로예요.');
  assert.deepEqual(fourth.caseState,third.caseState);
  assert.equal(steps.length,0);
});

test('예전 일반택시 가능 회신은 읽기 전용 복구와 중복 요청에서 수신처 재선택으로 표시하고 연락하지 않는다',async () => {
  let contacts=0;
  const dispatch=createToolDispatcher({phoneAdapter:{isSimulation:true,async support(){contacts++;}}});
  const draft=await dispatch({name:'prepare_inquiries',input:{kind:'taxi'},state:createDemoCase()});
  const state=applyAction(draft.state,{type:'SUPPORT_RECORD_RESPONSE',kind:'taxi',outcome:'available'});
  state.visitSupport.requirements.wheelchair=true; // 이전 버전이 저장한, 배차 유형과 현재 조건이 다른 상태
  const before=structuredClone(state),token=randomBytes(32).toString('base64url');
  const store=createMemorySessionStore(),id=visitSessionId(token);
  const stored=await store.loadOrCreate(undefined,{initialSessionId:id});
  const requestId='legacy-recipient-request';
  await store.save({...stored,state,requestIds:[requestId]});
  const service=createAgentService({store,provider:{connected:true,model:'unused',respond(){assert.fail('복구·중복 요청은 모델을 실행할 수 없습니다.');}}});
  const restored=await post(service,{visitToken:token},'/api/agent/resume');
  const repeated=await post(service,{visitToken:token,sessionId:id,requestId,message:'저장한 상태를 보여 주세요.'});
  assert.deepEqual(restored.caseState,repeated.caseState);
  const entry=restored.caseState.visitSupport.taxi;
  assert.equal(entry.status,'needs_recheck');
  assert.equal(entry.provider.id,draft.data.provider.id);
  assert.equal(entry.response,'');
  assert.equal(entry.inquiry,undefined);
  assert.equal(getVisitSupportSummary(state).taxi.label,'문의처 다시 선택');
  assert.equal(currentSupportRecipients(restored.caseState),restored.caseState);
  await assert.rejects(dispatch({name:'request_support_contact',input:{kind:'taxi'},state}),{code:'SUPPORT_RECIPIENT_RECHECK_REQUIRED'});
  assert.throws(() => applyAction(state,{type:'SUPPORT_PREPARE_INQUIRY',kind:'taxi'}),/휠체어/);
  assert.equal(contacts,0);
  assert.deepEqual((await store.loadOrCreate(id)).state,before);
  assert.deepEqual(state,before);
});

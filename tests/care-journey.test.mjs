import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase, applyAction } from '../app/domain.js';
import { getCareJourneySummary, JOURNEY_SCENARIOS, validateCareJourneyState } from '../app/care-journey.js';
import { createToolDispatcher } from '../agent/tools.mjs';
import { buildFixedPreview } from '../agent/preview.mjs';
import hospitalData from '../app/data/hospital-candidates.json' with {type:'json'};

const act = (state,type,values={}) => applyAction(state,{type,...values});
async function preview(scenarioId) { return buildFixedPreview({scenarioId,requestId:'journey-unit-preview-001',capabilities:{llm:false}}); }
function clinicalReady() {
  let state=createDemoCase();
  for(const target of ['mainland','jeju']) state=act(state,'RECORD_CALL',{target,outcome:'referral'});
  for(const id of ['report','exam','referral']) state=act(state,'ADD_DOCUMENT',{id,source:'검사용 고정 합성 의료진 자료',content:'의료진 역할의 합성 기록입니다. 실제 진료기록이 아닙니다.'});
  state=act(state,'SET_PERMISSION',{permission:'share',value:true});
  return act(state,'SUBMIT_PACKET');
}

test('순수 여정 DTO는 legacy 상태를 읽고 세 결과를 기본 선택하지 않으며 참조를 공유하지 않는다',()=>{
  const state=createDemoCase();delete state.careJourney;delete state.callRecovery;
  const original=structuredClone(state),summary=getCareJourneySummary(state);
  assert.equal(summary.pathway.outcome,'unconfirmed');assert.equal(summary.pathway.status,'unconfirmed');
  assert.deepEqual(summary.pathways.map(x=>x.id),['local_transfer','shared_care','mainland_continues']);
  assert.ok(summary.pathways.every(x=>!x.selected));assert.equal(summary.activeScenario,null);
  assert.deepEqual(summary.boundary,{actualCallPlaced:false,reservationConfirmed:false,clinicalAcceptanceConfirmed:false,externalRecordsConnected:false});
  summary.pathways[0].label='changed';summary.tasks[0].evidence[0].excerpt='changed';
  assert.deepEqual(state,original);assert.notEqual(getCareJourneySummary(state).pathways[0].label,'changed');
});

test('세 결과는 고정 합성 의료진 출처·원문·작성일·확인일과 검토 전제가 있어야만 표시한다',()=>{
  for(const outcome of ['local_transfer','shared_care','mainland_continues']) {
    assert.throws(()=>act(createDemoCase(),'JOURNEY_RECORD_GUIDANCE',{guidanceId:outcome}));
    const ready=clinicalReady(),state=act(ready,'JOURNEY_RECORD_GUIDANCE',{guidanceId:outcome});
    const summary=getCareJourneySummary(state),evidence=summary.pathway.evidence[0];
    assert.equal(summary.pathway.status,'demo_confirmed');assert.equal(summary.pathway.outcome,outcome);
    assert.equal(summary.pathways.filter(x=>x.selected).length,1);assert.match(evidence.label,/의료진.*합성/);
    assert.match(evidence.excerpt,/고정 합성 원문/);assert.ok(evidence.authoredAt);assert.ok(evidence.confirmedAt);
    assert.equal(evidence.confirmation,'demo_confirmed');assert.equal(evidence.isSimulation,true);
    const invalidated=act(state,'REMOVE_DOCUMENT',{id:'report'});
    assert.equal(getCareJourneySummary(invalidated).pathway.outcome,'unconfirmed');
    assert.equal(getCareJourneySummary(invalidated).pathway.evidence.length,0);
  }
  const forged=createDemoCase();forged.review={status:'completed',outcome:'local_transfer',source:'사용자 임의 주장',note:'확정'};
  assert.equal(getCareJourneySummary(forged).pathway.outcome,'unconfirmed');
  assert.throws(()=>act(clinicalReady(),'JOURNEY_RECORD_GUIDANCE',{guidanceId:'local_transfer',text:'임의 원문'}));
  const state=createDemoCase();state.careJourney.guidance.push({id:'invented',confirmedAt:'2026-10-31T00:00:00Z'});
  assert.throws(()=>validateCareJourneyState(state.careJourney));
});

test('자료 누락 시 요구 원문→보유비교→발급 절차→제주 제출 문의의 의존 작업을 보존한다',async()=>{
  const {caseState}=await preview('missing_record'),summary=getCareJourneySummary(caseState);
  const task=id=>summary.tasks.find(x=>x.id===id),evidence=task('records-compare').evidence;
  assert.equal(caseState.documents.find(x=>x.id==='report').status,'missing');
  assert.equal(task('report-issuance').status,'ready');assert.equal(task('report-submission').status,'ready');
  assert.equal(task('report-obtain').status,'todo');assert.equal(task('report-delivery').status,'blocked');
  assert.ok(evidence.some(x=>x.documentId==='guidance-preparation-demo'&&x.authoredAt==='2026-10-30'&&x.confirmation==='demo_confirmed'));
  assert.ok(evidence.some(x=>x.documentId==='history'&&x.authoredAt===null&&x.confirmedAt===null&&x.confirmation==='unverified'));
  assert.match(task('report-delivery').detail,/원본/);
  assert.ok(summary.findings.some(x=>x.target==='mainland'&&/발급/.test(x.label)));
  assert.ok(summary.findings.some(x=>x.target==='jeju'&&/제출/.test(x.label)));
  const dispatch=createToolDispatcher();let state=createDemoCase();
  assert.equal(getCareJourneySummary(state).tasks.find(x=>x.id==='report-submission').status,'blocked');
  state=(await dispatch({name:'request_hospital_contact',input:{target:'mainland'},state})).state;
  assert.equal(getCareJourneySummary(state).tasks.find(x=>x.id==='report-submission').status,'todo');
  const result=await dispatch({name:'request_hospital_contact',input:{target:'jeju'},state});
  assert.match(result.data.callPlan.questions.join(' '),/발급 절차.*제출 방식/);
  assert.equal(result.state.documents.find(x=>x.id==='exam').status,'not_performed');
  assert.equal(result.state.permissions.share,false);
});

test('접수 거절은 미확인 경로와 거절 원문을 남기고 공개 후보에서 해당 기관만 제외한다',async()=>{
  const {caseState}=await preview('jeju_unavailable'),summary=getCareJourneySummary(caseState);
  assert.equal(summary.pathway.outcome,'unconfirmed');assert.ok(summary.pathways.every(x=>!x.selected));
  assert.match(summary.pathway.detail,/임상 결론/);assert.match(summary.tasks.find(x=>x.id==='jeju-alternative').detail,/기존 의료진 계획/);
  assert.ok(summary.findings.some(x=>x.target==='jeju'&&/고정 합성 원문.*접수/.test(x.detail)));
  const source=summary.dataImpact.find(x=>x.datasetId==='859');
  assert.ok(source.candidateCount>0);assert.match(source.detail,/거절 기관 제외/);
  assert.equal(caseState.patient.localHospital,'제주우리병원');assert.equal(caseState.review.status,'not_requested');
});

test('휠체어 대여 응답이 차량·동행 다음 문의와 진료 지연 귀가·동행 재조정에 반영된다',async()=>{
  const {caseState}=await preview('missing_record'),summary=getCareJourneySummary(caseState);
  for(const kind of ['taxi','companion']) {
    const inquiry=caseState.visitSupport[kind].inquiry;
    for(const word of ['수령','반납','앉은 채','승하차','동행인','지연','귀가','재조정']) assert.ok(inquiry.includes(word),`${kind}: ${word}`);
    assert.equal(inquiry.includes(caseState.patient.name),false);
    assert.equal(inquiry.includes(caseState.documents[0].content),false);
  }
  assert.ok(summary.findings.some(x=>x.target==='companion'&&/지연/.test(x.detail)));
  assert.equal(summary.boundary.reservationConfirmed,false);
});

test('날짜·시각·기관·출발지역·휠체어 변경은 이전 조건과 응답을 보존하고 두 지원을 재확인한다',async()=>{
  const base=(await preview('missing_record')).caseState;
  for(const action of [
    {type:'UPDATE_PATIENT',values:{nextVisit:'2026-11-13'}},
    {type:'SUPPORT_UPDATE_REQUIREMENTS',values:{appointmentTime:'14:00'}},
    {type:'SELECT_LOCAL_HOSPITAL',hospital:hospitalData.records.find(x=>x.id==='hospital-5')},
    {type:'UPDATE_PATIENT',values:{area:'서귀포시'}},
    {type:'SUPPORT_UPDATE_REQUIREMENTS',values:{wheelchair:false}},
  ]) {
    const state=applyAction(base,action),summary=getCareJourneySummary(state);
    assert.notEqual(state.visitSupport.taxi.status,'available_demo');assert.notEqual(state.visitSupport.companion.status,'available_demo');
    assert.ok(summary.schedule.recheckReasons.length>0);assert.ok(summary.findings.some(x=>x.target==='schedule'&&/변경 전:.*가능 응답/.test(x.detail)));
    assert.ok(summary.tasks.some(x=>/coordination/.test(x.id)&&['todo','recheck'].includes(x.status)));
  }
  const {caseState}=await preview('time_changed'),summary=getCareJourneySummary(caseState);
  assert.equal(summary.schedule.time,'14:00');assert.equal(summary.schedule.taxiStatus,'needs_recheck');assert.equal(summary.schedule.companionStatus,'needs_recheck');
  assert.match(summary.schedule.recheckReasons.join(' '),/10:00 → 14:00/);
  assert.equal(caseState.visitSupport.taxi.response,'');assert.equal(caseState.visitSupport.taxi.wheelchairConfirmed,false);
});

test('공개 자료859·327·254와 공식2건은 지역·기관종류·휠체어 조건별 후보·질문을 바꾼다',()=>{
  const state=createDemoCase(),base=getCareJourneySummary(state);
  const selected=act(state,'SELECT_LOCAL_HOSPITAL',{hospital:hospitalData.records.find(x=>x.id==='hospital-4')});
  const selectedSummary=getCareJourneySummary(selected);
  assert.notEqual(base.dataImpact[0].candidateCount,selectedSummary.dataImpact[0].candidateCount);
  assert.match(selectedSummary.dataImpact[0].detail,/기관명.*분류/);
  const changed=getCareJourneySummary(act(state,'UPDATE_PATIENT',{values:{area:'서귀포시 성산읍'}}));
  assert.notEqual(base.dataImpact.find(x=>x.datasetId==='327').candidateCount,changed.dataImpact.find(x=>x.datasetId==='327').candidateCount);
  const wheelchair=getCareJourneySummary(act(state,'SUPPORT_UPDATE_REQUIREMENTS',{values:{wheelchair:true}}));
  assert.notDeepEqual(base.dataImpact.find(x=>x.datasetId==='327').questions,wheelchair.dataImpact.find(x=>x.datasetId==='327').questions);
  assert.deepEqual(base.dataImpact.filter(x=>x.datasetId!==null).map(x=>x.datasetId),['859','327','254']);
  assert.equal(base.dataImpact.filter(x=>x.datasetId===null).length,2);
  for(const item of base.dataImpact) { assert.ok(Number.isSafeInteger(item.candidateCount)&&item.candidateCount>=0);assert.match(item.sourceUrl,/^https:/);assert.ok(item.detail); }
});

test('세 preview는 같은 reducer·도구를 실행하며 실제 개인기록·발신·예약을 만들지 않는다',async()=>{
  assert.deepEqual(JOURNEY_SCENARIOS.map(x=>x.id),['missing_record','jeju_unavailable','time_changed']);
  for(const {id} of JOURNEY_SCENARIOS) {
    const result=await preview(id),summary=getCareJourneySummary(result.caseState);
    assert.equal(result.isPreview,true);assert.equal(result.capabilities.llm,false);assert.equal(result.sessionId,'');
    assert.equal(summary.activeScenario.id,id);assert.equal(summary.pathway.outcome,'unconfirmed');
    assert.ok(result.events.some(x=>x.tool==='request_hospital_contact'));assert.ok(result.events.some(x=>x.tool==='get_care_journey'));
  }
});


test('의료진 근거는 행정 거절·전화 실패만으로 사라지거나 다른 경로로 바뀌지 않는다',async()=>{
  const fixed=act(clinicalReady(),'JOURNEY_RECORD_GUIDANCE',{guidanceId:'shared_care'});
  const dispatch=createToolDispatcher({phoneAdapter:{isSimulation:true,async hospital(){return {isSimulation:true,outcome:'not_participating'};}}});
  const result=await dispatch({name:'request_hospital_contact',input:{target:'jeju'},state:fixed});
  const summary=getCareJourneySummary(result.state);
  assert.equal(summary.pathway.outcome,'shared_care');assert.equal(summary.pathway.evidence[0].documentId,'guidance-shared-care-demo');
  assert.equal(result.state.inquiries.jeju.status,'not_participating');assert.equal(summary.handoffs[0].reason,'not_participating');
  assert.equal(getCareJourneySummary(act(result.state,'REMOVE_DOCUMENT',{id:'report'})).pathway.outcome,'unconfirmed');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase} from '../app/domain.js';
import {createAppointmentDemo,reduceAppointmentDemo} from '../app/appointment-demo.js';
import {applyCareRequest} from '../app/care-request-entry.js';
import {reduceCoordination,runCoordinationDemo} from '../app/care-coordination.js';
import {reservationOverview} from '../app/reservation-overview.js';
const caseState=createDemoCase();
const chosen=()=>applyCareRequest(createAppointmentDemo('jeju',{usePublicData:true,today:'2026-11-18'}),'제주우리병원 정형외과 12월 3일 오후. 애월읍에서 휠체어와 동행이 필요해요.');
async function finish(state){state=reduceCoordination(state,{type:'coordination_start',runId:'overview-test'},caseState);await runCoordinationDemo(state,caseState,{wait:async()=>{},onEvent:value=>{state=reduceCoordination(state,{type:'coordination_event',value},caseState);}});return state;}
test('아무 준비가 없는 예약 현황은 비어 있다',()=>assert.deepEqual(reservationOverview({},caseState),{visits:[],confirmed:0,handoffs:0}));
test('진행한 두 지역만 모으며 읽기가 초안이나 회신을 바꾸지 않는다',async()=>{
 const drafts={jeju:await finish(chosen()),seoul:createAppointmentDemo('seoul')},before=structuredClone(drafts);
 const overview=reservationOverview(drafts,caseState);assert.equal(overview.visits.length,2);assert.equal(overview.confirmed,3);assert.equal(overview.visits[0].selectedName,'제주우리병원');assert.equal(overview.visits[0].view.hospitalName,'가상 제주 병원');assert.equal(overview.visits[1].status,'준비 중');assert.deepEqual(drafts,before);
});
test('인계는 완료 집계에 넣지 않는다',async()=>{
 const draft=reduceCoordination(chosen(),{type:'coordination_scenario',value:'taxi_unavailable'},caseState),overview=reservationOverview({jeju:await finish(draft)},caseState);assert.equal(overview.confirmed,2);assert.equal(overview.handoffs,1);assert.equal(overview.visits[0].status,'직접 확인 필요');
});
test('완료 뒤 날짜 조건을 바꾸면 이전 완료 체크를 다시 쓰지 않는다',async()=>{
 const complete=await finish(chosen()),changed=reduceAppointmentDemo(complete,{type:'public_time',value:'morning'}),overview=reservationOverview({jeju:changed},caseState);assert.equal(overview.confirmed,0);assert.equal(overview.visits[0].status,'조건 변경 · 재확인');assert.equal(overview.visits[0].view.done,false);
});
test('중지한 예약에서 회신받은 항목을 유지하고 남은 조율만 재개한다',async()=>{
  let state=reduceCoordination(chosen(),{type:'coordination_start',runId:'partial-overview'},caseState);
  await runCoordinationDemo(state,caseState,{wait:async()=>{},onEvent:value=>{
    state=reduceCoordination(state,{type:'coordination_event',value},caseState);
    if(value.jobId==='hospital'&&value.phase==='result')state=reduceCoordination(state,{type:'coordination_stop'},caseState);
  }});
  const receipt=state.coordination.results.hospital;
  const [paused]=reservationOverview({jeju:state},caseState).visits;
  assert.equal(paused.status,'조율 중지 · 시연');
  assert.equal(paused.confirmed,1);
  assert.deepEqual(paused.view.rows.map(row=>row.status),['confirmed','queued','queued']);
  const resumed=await finish(state);
  assert.deepEqual(resumed.coordination.results.hospital,receipt);
  assert.equal(reservationOverview({jeju:resumed},caseState).visits[0].status,'조율 완료 · 시연');
});

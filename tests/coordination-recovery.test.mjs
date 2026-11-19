import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase} from '../app/domain.js';
import {createAppointmentDemo,reduceAppointmentDemo} from '../app/appointment-demo.js';
import {flightSearch} from '../app/appointment-booking-links.js';
import {applyCareRequest} from '../app/care-request-entry.js';
import {coordinationReport,coordinationView,reduceCoordination,runCoordinationDemo} from '../app/care-coordination.js';
import {reservationEditTarget,reservationEditSummary,applyReservationEdit} from '../app/reservation-edit.js';
import {bookingNext} from '../app/appointment-flow.js';

const caregiver=createDemoCase(),today='2026-11-18';
const appointment=(s,type,value)=>reduceAppointmentDemo(s,{type,value});
const view=s=>coordinationView(s,caregiver);
const dispatch=(s,type,value,runId)=>reduceCoordination(s,{type,value,runId},caregiver);
const set=(s,field,value)=>dispatch(s,'coordination_option',{field,value});
const retry=(s,key,runId='second')=>dispatch(s,'coordination_vehicle_retry',key,runId);
function jeju() {
  return applyCareRequest(createAppointmentDemo('jeju',{usePublicData:true,today}),
    '제주우리병원 정형외과에 12월 8일 오후 2시 진료를 희망해요. 애월읍에서 오전 11시 30분에 휠체어 택시와 병원 동행이 필요해요.');
}
function mainland() {
  let state=appointment(createAppointmentDemo('seoul',{today}),'find_dates');
  for(const [type,value] of [['preferred_month','2026-12'],['preferred_date','2026-12-08'],['slot','hanbit-kim|2026-12-08|14:40']])state=appointment(state,type,value);
  return state;
}
async function simulate(started,events=[]) {
  let state=started;
  await runCoordinationDemo(started,caregiver,{wait:async()=>{},onEvent:event=>{
    events.push(event);
    state=dispatch(state,'coordination_event',event);
  }});
  return state;
}
function firstRun(s,scenario='taxi_unavailable') {
  return simulate(dispatch(dispatch(s,'coordination_scenario',scenario),'coordination_start',null,'first'));
}

test('휠체어 차량 부족 시 같은 날짜에 탑승 조건에 맞는 가까운 시간만 제안하고 실제 문의처를 구분한다',async()=>{
  const failed=await firstRun(jeju()),recovery=view(failed).vehicleRecovery;
  assert.deepEqual(recovery.offers.map(offer=>offer.time),['11:15','11:45']);
  assert.ok(recovery.offers.every(offer=>offer.provider==='가상 휠체어 협력차량'));
  assert.deepEqual(recovery.contacts.map(contact=>contact.serviceType),['accessible_transport']);
  assert.match(coordinationReport(failed,caregiver),/11:15 가상 휠체어 협력차량 · 시연 제안, 선택 전/);
  assert.equal(bookingNext({...failed,screen:'support'},caregiver).action,'coordination_result_open');
  assert.equal(view(failed).confirmed,2);
  const regular=view(await firstRun(set(jeju(),'wheelchair',false))).vehicleRecovery;
  assert.equal(regular.offers[0].time,'11:30');
  assert.notEqual(regular.offers[0].provider,recovery.offers[0].provider);
  assert.ok(regular.contacts.some(contact=>contact.name==='애월콜'));
});

test('선택한 대체 차량만 재조율하며 이중 선택·늦은 회신·이전 결과의 제안을 거부한다',async()=>{
  const failed=await firstRun(jeju()),receipts=failed.coordination.results;
  const offer=view(failed).vehicleRecovery.offers[0];
  assert.equal(retry(failed,offer.key.replace('first','old')),failed);
  const started=retry(failed,offer.key);
  assert.equal(view(started).running,true);
  assert.equal(started.coordination.results.hospital,receipts.hospital);
  assert.equal(started.coordination.results.companion,receipts.companion);
  assert.equal(started.coordination.results.taxi,undefined);
  assert.equal(retry(started,offer.key),started);
  const events=[];
  const finished=await simulate(started,events);
  assert.deepEqual(events.map(e=>[e.jobId,e.phase]),[['taxi','contacting'],['taxi','waiting'],['taxi','result']]);
  assert.equal(view(finished).confirmed,3);
  assert.equal(view(finished).vehicleRecovery,null);
  assert.equal(finished.coordination.results.taxi.time,'11:15');
  assert.match(coordinationReport(finished,caregiver),/11:15 출발 · 11:30에서 변경/);
  assert.equal(finished.coordination.results.taxi.provider,offer.provider);
  assert.equal(retry(finished,offer.key),finished);
  const stopped=dispatch(dispatch(started,'coordination_event',events[0]),'coordination_stop');
  assert.equal(view(stopped).stopped,true);
  assert.equal(bookingNext({...stopped,screen:'support'},caregiver).label,'남은 예약 이어서 조율');
  const resumed=dispatch(stopped,'coordination_start',null,'resumed');
  assert.equal(dispatch(resumed,'coordination_event',events[2]),resumed);
  assert.equal((await simulate(resumed)).coordination.results.hospital,receipts.hospital);
});

test('본인확인 대기와 대체 시간 없음은 차량 예약으로 넘어가지 않는다',async()=>{
  const identity=await firstRun(jeju(),'hospital_identity');
  assert.equal(view(identity).vehicleRecovery,null);
  assert.equal(view(identity).confirmed,0);
  const night=await firstRun(set(jeju(),'pickupTime','04:30')),recovery=view(night).vehicleRecovery;
  assert.deepEqual(recovery.offers,[]);
  assert.ok(recovery.contacts[0].phone);
  assert.equal(retry(night,'unlisted'),night);
});

test('출장 전날·당일과 입력한 공항 도착시각을 대안에 적용하며 지나간 항공 출발일은 차량도 거절한다',async()=>{
  let state=appointment(mainland(),'flight_dates','same');
  state=set(state,'wheelchair',true);
  state=appointment(state,'travel_field',{field:'airportArrival',value:'2026-12-08T09:10'});
  const failed=await firstRun(state),recovery=view(failed).vehicleRecovery;
  assert.deepEqual(recovery.offers.map(offer=>offer.time),['08:45','08:15']);
  const earlier=appointment(failed,'travel_field',{field:'airportArrival',value:'2026-12-08T08:00'});
  assert.equal(view(earlier).ready,false);
  assert.equal(view(earlier).confirmed,2);
  assert.equal(retry(earlier,recovery.offers[0].key),earlier);
  const past=appointment(state,'flight_field',{field:'outbound',value:'2021-01-01'});
  assert.equal(flightSearch(past).issues[0],view(past).issue);
  assert.equal(view(past).issueControl,'flight-outbound');
  assert.equal(dispatch(past,'coordination_start',null,'past'),past);
});

test('자정에 동행보다 늦은 당일 픽업을 막고 전날 또는 동행 제외로 진행한다',async()=>{
  const state=set(appointment(jeju(),'public_exact_time','00:20'),'pickupTime','00:05');
  assert.equal(view(state).ready,false);
  assert.match(view(state).issue,/2026-12-07 23:50/);
  assert.equal(view(state).canChoosePickupDay,true);
  const previous=set(set(state,'pickupDay','previous'),'pickupTime','23:25');
  const result=(await firstRun(previous,'success')).coordination.results;
  assert.equal(result.taxi.date,'2026-12-07');
  assert.equal(result.taxi.time,'23:25');
  assert.match(result.companion.detail,/2026-12-07 23:50/);
  const alone=await firstRun(set(state,'companion',false),'success');
  assert.equal(alone.coordination.results.taxi.date,'2026-12-08');
  assert.equal(alone.coordination.results.taxi.time,'00:05');
  const automatic=applyCareRequest(createAppointmentDemo('jeju',{usePublicData:true,today}),'제주우리병원 정형외과 12월 8일 00:20 진료');
  assert.equal(view(automatic).pickupDate,'2026-12-07');
  assert.equal(view(automatic).options.pickupTime,'23:20');
  const editClock=dispatch(automatic,'coordination_option',{field:'pickupTime',value:'23:10',pickupDay:view(automatic).pickupDay});
  assert.equal(view(editClock).pickupDate,'2026-12-07');
  assert.equal(view(editClock).ready,true);
  assert.equal(view(jeju()).canChoosePickupDay,false);
});

test('동행 약속보다 이른 대안만 제시하고 동행만 제외하면 가능한 기존 차량은 유지한다',async()=>{
  const request=set(jeju(),'pickupTime','13:25');
  const unavailable=await firstRun(request);
  assert.deepEqual(view(unavailable).vehicleRecovery.offers.map(o=>o.time),['13:15','12:45']);
  assert.equal(view(set(request,'pickupTime','13:30')).ready,false);
  const withoutCompanion=await firstRun(set(request,'companion',false));
  assert.ok(view(withoutCompanion).vehicleRecovery.offers.some(o=>o.time==='13:45'));
  const booked=await simulate(retry(unavailable,view(unavailable).vehicleRecovery.offers[0].key));
  const without=set(booked,'companion',false);
  assert.equal(without.coordination.results.taxi,booked.coordination.results.taxi);
  assert.equal(view(without).done,true);
  const late=await simulate(retry(withoutCompanion,view(withoutCompanion).vehicleRecovery.offers.find(o=>o.time==='13:45').key));
  const newCompanion=set(late,'companion',true);
  assert.equal(view(newCompanion).ready,false);
  assert.equal(view(newCompanion).rows.find(r=>r.id==='taxi').result,null);
  const mainlandRequest=set(mainland(),'pickupTime','14:05');
  const sameDay=await firstRun(appointment(mainlandRequest,'flight_dates','same'));
  const previousDay=await firstRun(appointment(mainlandRequest,'flight_dates','previous'));
  assert.ok(view(sameDay).vehicleRecovery.offers.every(o=>o.time<'14:10'));
  assert.ok(view(previousDay).vehicleRecovery.offers.some(o=>o.time==='14:30'));
});

test('제주 구간의 교통약자 차량은 실제 조율 차종에 반영하고 공개자료 필터와 도착 구간은 분리한다',async()=>{
  const base=set(jeju(),'wheelchair',false);
  const completed=await firstRun(base,'success');
  const accessible=appointment(completed,'travel_field',{field:'jejuMode',value:'accessible'});
  assert.equal(view(accessible).options.wheelchair,true);
  assert.equal(accessible.coordination.results.hospital,completed.coordination.results.hospital);
  assert.equal(view(accessible).confirmed,1);
  const regularAgain=appointment(accessible,'travel_field',{field:'jejuMode',value:'taxi'});
  assert.equal(view(regularAgain).confirmed,1);
  const failed=await firstRun(accessible);
  assert.ok(view(failed).vehicleRecovery.offers.every(o=>o.providerId==='partner-lift'));
  assert.ok(view(failed).vehicleRecovery.contacts.every(c=>c.serviceType==='accessible_transport'));
  const regular=set(failed,'wheelchair',false);
  assert.equal(regular.travel.jejuMode,'taxi');
  assert.equal(view(regular).options.wheelchair,false);
  assert.equal(view(appointment(regular,'jeju_support_wheelchair',true)).options.wheelchair,false);
  const mainlandCase=set(mainland(),'wheelchair',false);
  const onArrival=appointment(mainlandCase,'travel_field',{field:'seoulMode',value:'accessible'});
  assert.equal(view(onArrival).options.wheelchair,false);
  const onDeparture=appointment(onArrival,'travel_field',{field:'jejuMode',value:'accessible'});
  assert.equal(view(onDeparture).options.wheelchair,true);
});

test('진료 수정 원복 시 직접 지정한 출발과 대체 차량 회신이 그대로 남는다',async()=>{
  const initial=await firstRun(jeju()),choice=view(initial).vehicleRecovery.offers[0];
  for(const original of [initial,await simulate(retry(initial,choice.key))]){
    let draft=reservationEditTarget(original);
    draft=appointment(draft,'public_exact_time','14:30');
    assert.equal(view(draft).options.pickupTime,original.coordination.results.taxi.time);
    draft=appointment(draft,'public_exact_time','14:00');
    assert.equal(reservationEditSummary(original,draft,caregiver).changed,false);
    assert.equal(applyReservationEdit(original,draft,caregiver).coordination.results,original.coordination.results);
  }
});

test('다른 항목의 선행 이벤트와 같은 실행의 중복 진행 이벤트를 무시한다',async()=>{
  const start=dispatch(jeju(),'coordination_start',null,'order'),events=[];
  await simulate(start,events);
  const [contact,waiting,result,taxiContact]=events;
  assert.equal(dispatch(start,'coordination_event',taxiContact),start);
  const contacted=dispatch(start,'coordination_event',contact);
  assert.equal(dispatch(contacted,'coordination_event',contact),contacted);
  const pending=dispatch(contacted,'coordination_event',waiting);
  assert.equal(dispatch(pending,'coordination_event',contact),pending);
  const wrongReceipt={...result,receipt:{...result.receipt,reference:'DEMO-another-hospital'}};
  assert.equal(dispatch(pending,'coordination_event',wrongReceipt),pending);
});

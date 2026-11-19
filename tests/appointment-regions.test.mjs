import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppointmentDemo,reduceAppointmentDemo as reduce,regionHospitals,intakeComplete,availableAppointments,appointmentSelection,referralDisposition,appointmentPreparation,buildAppointmentReport} from '../app/appointment-demo.js';
import {assessTravel,updateTravel,travelChecklist} from '../app/appointment-travel.js';
import {createDemoCase} from '../app/domain.js';
const act=(state,type,value)=>reduce(state,{type,value});
function localReady(hospital='baram') {
  let s=act(createAppointmentDemo('jeju'),'hospital',hospital);
  s=act(s,'visit_type','first');s=act(s,'find_dates');
  s=act(s,'preferred_date',hospital==='baram'?'2026-11-18':'2026-11-19');
  return act(s,'slot',availableAppointments(s)[0].key);
}
test('두 지역의 병원·진료과·희망 일정이 독립되고 다른 지역 병원/슬롯은 거부한다',()=>{
  const jeju=localReady(),seoul=createAppointmentDemo('seoul'),before=structuredClone(seoul);
  assert.equal(regionHospitals('jeju').length,2);assert.equal(regionHospitals('seoul').length,2);
  assert.equal(jeju.department,'가정의학과');assert.equal(appointmentSelection(jeju).valid,true);
  assert.equal(act(jeju,'hospital','hanbit'),jeju);assert.equal(act(seoul,'hospital','baram'),seoul);
  assert.equal(act(jeju,'slot','hanbit-kim|2026-12-08|10:30'),jeju);
  assert.deepEqual(seoul,before);assert.equal(localReady('onyu').doctorId,'onyu-moon');
});
test('제주는 희망 일정 먼저 선택하고 서울 의뢰서 준비 경계는 유지한다',()=>{
  let jeju=localReady(),seoul=act(createAppointmentDemo(),'visit_type','first');
  assert.equal(intakeComplete(jeju),true);assert.equal(jeju.referralStatus,null);
  assert.equal(intakeComplete(seoul),false);assert.equal(act(seoul,'find_dates').screen,'availability');assert.equal(act(seoul,'request'),seoul);
  seoul=act(seoul,'referral','missing');assert.equal(referralDisposition(seoul).canConfirm,false);
  jeju=act(act(act(jeju,'review'),'request'),'reply','confirm');
  assert.equal(jeju.status,'confirmed_demo');assert.equal(jeju.reservationConfirmed,undefined);
  assert.equal(referralDisposition(act(createAppointmentDemo('jeju'),'visit_type','unknown')).canConfirm,false);
});
test('제주 기간 검색은 여러 의료진·시간을 포함하고 병원 변경은 일정과 이동 체크를 해제한다',()=>{
  let s=act(localReady(),'preferred_mode','range');s=act(s,'preferred_date','2026-11-20');
  assert.equal(new Set(availableAppointments(s).map(slot=>slot.doctor.id)).size,2);
  s=act(s,'slot',availableAppointments(s)[0].key);s=act(s,'travel_check','hospital');
  const changed=act(s,'hospital','onyu');assert.equal(changed.time,null);assert.equal(changed.doctorId,null);
  assert.deepEqual(changed.travel.checks,[]);assert.equal(changed.travel.recheck,true);
});
test('지역 선택으로 돌아가는 읽기용 접수 탐색은 기존 일정·체크·시연 회신을 지우지 않는다',()=>{
  let s=act(act(act(localReady(),'review'),'request'),'reply','confirm');s=act(s,'travel_check','hospital');
  const visit=act(s,'edit_intake');assert.equal(visit.time,s.time);assert.equal(visit.status,s.status);assert.deepEqual(visit.travel,s.travel);
});
test('제주 왕복 모델에는 항공·공항 입력과 체크가 없고 귀가 시각 충돌을 대조한다',()=>{
  let s=localReady();assert.deepEqual(new Set(travelChecklist(s.travel).map(item=>item.leg)),new Set(['jeju','return']));
  for(const action of [{type:'flight_field',value:{field:'outbound',value:'2026-11-18'}},{type:'travel_check',value:'flight'},{type:'travel_field',value:{field:'airport',value:'other'}}])assert.equal(updateTravel(s.travel,action),s.travel);
  s=act(s,'travel_field',{field:'hospitalArrival',value:'2026-11-18T10:00'});
  s=act(s,'travel_field',{field:'examEnd',value:'2026-11-18T12:00'});
  s=act(s,'travel_field',{field:'returnHome',value:'2026-11-18T11:00'});
  assert.equal(assessTravel(s).issues.length,2);assert.equal(assessTravel(s).complete,false);
  const c=createDemoCase(),copy=structuredClone(c),prep=appointmentPreparation(c,s),report=buildAppointmentReport(s,c);
  assert.equal(prep.legs.length,2);assert.match(report,/# 제주 병원 진료 준비/);assert.match(report,/실제 예약 미확정/);
  assert.doesNotMatch(report,/항공권 가격 비교|제주공항|김포|항공편·좌석/);assert.deepEqual(c,copy);
});

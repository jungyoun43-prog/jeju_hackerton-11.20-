import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase} from '../app/domain.js';
import {createAppointmentDemo,reduceAppointmentDemo,needsScheduleConsultation} from '../app/appointment-demo.js';
import {applyCareRequest,careRequestPreview} from '../app/care-request-entry.js';
import {coordinationView,coordinationReport,reduceCoordination,runCoordinationDemo} from '../app/care-coordination.js';
import {flightSearch} from '../app/appointment-booking-links.js';
import {reservationOverview} from '../app/reservation-overview.js';
import {bookingNext} from '../app/appointment-flow.js';
import {jejuSupportEvidence} from '../app/jeju-appointment-data.js';

const caregiver=createDemoCase();
const today='2026-11-18';
const request='제주우리병원 정형외과에 12월 8일 오후 2시 진료를 희망해요. 애월읍에서 오전 11시 30분에 휠체어 택시를 타고 싶어요. 병원 동행은 필요 없어요. 진료의뢰서는 가지고 있어요.';
const jeju=()=>createAppointmentDemo('jeju',{usePublicData:true,today});
const act=(state,type,value)=>reduceAppointmentDemo(state,{type,value});
const view=state=>coordinationView(state,caregiver);
async function coordinate(state){
  let current=reduceCoordination(state,{type:'coordination_start',runId:'test'},caregiver);
  await runCoordinationDemo(current,caregiver,{wait:async()=>{},onEvent:value=>{
    current=reduceCoordination(current,{type:'coordination_event',value},caregiver);
  }});
  return current;
}

test('텍스트의 진료·차량 시간을 입력 미리보기부터 결과표까지 따로 유지한다',async()=>{
  const preview=careRequestPreview(request,'jeju',today);
  assert.match(preview.find(row=>row.id==='schedule').value,/14:00/);
  assert.match(preview.find(row=>row.id==='support').value,/11:30 출발/);
  const state=await coordinate(applyCareRequest(jeju(),request));
  assert.equal(view(state).time,'14:00');
  assert.equal(view(state).options.pickupTime,'11:30');
  const report=coordinationReport(state,caregiver);
  assert.match(report,/입력한 서류 상태 · 의뢰서 보유 응답/);
  assert.match(report,/- 병원 동행: 이번 요청에 없음\n/);
});

test('복수 진료 시각과 용도가 다른 날짜는 기존 확정 조건으로 대체하지 않는다',()=>{
  const previous=applyCareRequest(jeju(),request);
  const ambiguous=applyCareRequest(previous,'진료는 오전 10시 또는 오후 2시로 생각해요.');
  assert.equal(view(ambiguous).ready,false);
  assert.match(ambiguous.quickEntry.notices.join(' '),/진료 시각/);
  const onlyPickup=applyCareRequest(jeju(),'제주우리병원 정형외과 12월 8일. 오전 11시 택시.');
  assert.equal(onlyPickup.jejuHospital.timeOfDay,'unknown');
  assert.equal(view(onlyPickup).options.pickupTime,'11:00');
  const dates=applyCareRequest(previous,'애월읍에서 12월 7일 출발, 12월 8일 진료.');
  assert.equal(dates.jejuHospital.from,null);
  assert.equal(view(dates).ready,false);
});

test('귀가편 시각을 추가해도 가는 차량 시각을 덮어쓰지 않는다',()=>{
  const state=applyCareRequest(jeju(),request+' 귀가 택시는 오후 5시예요.');
  assert.equal(view(state).options.pickupTime,'11:30');
  assert.equal(view(state).time,'14:00');
});

test('제주 문의처를 검색해도 조율 결과와 출발지는 유지되고 선택한 출처만 결과표에 담긴다',async()=>{
  const booked=await coordinate(applyCareRequest(jeju(),request));
  const browsed=act(act(booked,'jeju_support_area','서귀포시'),'jeju_support_wheelchair',false);
  assert.equal(jejuSupportEvidence(browsed,caregiver).area,'서귀포시');
  assert.equal(view(browsed).options.pickup,'제주시 애월읍');
  assert.equal(view(browsed).options.wheelchair,true);
  assert.equal(view(browsed).confirmed,2);
  assert.equal(browsed.coordination.results,booked.coordination.results);
  const contact=jejuSupportEvidence(booked,caregiver).taxi.find(row=>row.name==='애월콜');
  const selected=act(booked,'jeju_support_pick',{kind:'taxi',id:contact.id});
  const report=coordinationReport(selected,caregiver);
  for(const value of [contact.name,contact.phone,contact.source.url,contact.source.asOf])assert.ok(report.includes(value));
  assert.equal(view(selected).rows.find(row=>row.id==='taxi').result.provider,'가상 이동지원센터');
});

test('내륙의 항공 출발일과 차량 탑승일을 맞추고 날짜 변경은 차량만 재조율한다',async()=>{
  let state=act(createAppointmentDemo('seoul'),'find_dates');
  state=act(state,'preferred_month','2026-12');
  state=act(state,'preferred_date','2026-12-08');
  state=await coordinate(act(state,'slot','hanbit-kim|2026-12-08|14:40'));
  assert.equal(flightSearch(state,today).outbound,view(state).pickupDate);
  assert.match(view(state).rows[0].result.detail,/김도윤/);
  const sameDay=act(state,'flight_dates','same');
  assert.equal(flightSearch(sameDay,today).outbound,view(sameDay).pickupDate);
  assert.equal(view(sameDay).pickupDate,'2026-12-08');
  assert.equal(view(sameDay).rows.find(row=>row.id==='taxi').result,null);
  assert.equal(view(sameDay).rows[0].result,state.coordination.results.hospital);
  assert.equal(view(act(sameDay,'flight_dates','previous')).confirmed,2);
  const wrongDay=act(state,'flight_field',{field:'outbound',value:'2026-12-09'});
  assert.equal(view(wrongDay).issueControl,'flight-outbound');
  assert.equal(view(wrongDay).ready,false);
});

test('마감된 날짜의 상담은 현황에서 다시 열 수 있으며 예약 건수를 만들지 않는다',()=>{
  let state=act(createAppointmentDemo('seoul'),'find_dates');
  state=act(state,'preferred_date','2026-11-24');
  state=act(state,bookingNext(state).action);
  assert.equal(needsScheduleConsultation(state),true);
  assert.equal(state.preferredFrom,'2026-11-24');
  assert.equal(bookingNext(state).action,'reservations');
  const overview=reservationOverview({seoul:state},caregiver);
  assert.equal(overview.visits[0].consultation,true);
  assert.equal(overview.confirmed,0);
});

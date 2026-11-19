import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppointmentDemo,reduceAppointmentDemo as reduce,appointmentSelection,buildAppointmentReport} from '../app/appointment-demo.js';
import {bookingStep,bookingNext} from '../app/appointment-flow.js';
import {publicHospitalReady,publicWishReady} from '../app/jeju-appointment-data.js';
import {createDemoCase} from '../app/domain.js';
const act=(s,type,value)=>reduce(s,{type,value});
function chosen(){let s=act(createAppointmentDemo(),'find_dates');s=act(s,'preferred_month','2026-12');s=act(s,'preferred_date','2026-12-08');return act(s,'slot','hanbit-kim|2026-12-08|14:40');}
test('의료진·시간을 먼저 고르고 접수 질문은 선택적으로 남긴다. 레거시 요청 검증은 유지한다',()=>{
  let s=chosen();assert.equal(bookingStep(s),2);assert.equal(bookingNext(s).action,'review');
  s=act(s,'review');assert.equal(bookingStep(s),3);assert.equal(bookingNext(s).action,'view');assert.equal(bookingNext(s).value,'support');assert.equal(act(s,'request'),s);
  s=act(s,'visit_type','first');assert.equal(s.time,'14:40');assert.equal(act(s,'request'),s);
  s=act(s,'referral','reported');assert.equal(s.doctorId,'hanbit-kim');assert.equal(s.time,'14:40');assert.equal(bookingNext(s).disabled,false);
  assert.equal(act(s,'request').status,'requested_demo');
});
test('의뢰서 미준비는 선택한 시각을 보존한 상담이며 확정 회신은 거부한다',()=>{
  let s=act(chosen(),'review');s=act(s,'visit_type','first');s=act(s,'referral','missing');
  assert.equal(bookingNext(s).label,'다음: AI에게 맡길 내용');s=act(s,'request');assert.equal(s.time,'14:40');
  assert.equal(s.status,'consultation_requested_demo');assert.equal(act(s,'reply','confirm'),s);
});
test('뒤로·서류 조회·접수 응답 변경은 선택한 의사와 시각을 지우지 않는다',()=>{
  let s=act(chosen(),'review');s=act(s,'visit_type','first');s=act(s,'referral','reported');s=act(s,'back');
  assert.equal(s.screen,'availability');assert.equal(appointmentSelection(s).valid,true);
  s=act(s,'review');s=act(s,'view','records');s=act(s,'resume');assert.equal(s.screen,'review');
  s=act(s,'visit_type','followup');assert.equal(s.referralStatus,null);assert.equal(s.time,'14:40');assert.equal(s.doctorId,'hanbit-kim');assert.equal(bookingNext(s).disabled,false);
});
test('기간 미완성·빈 결과·시간 미선택에 각각 다음 행동을 안내한다',()=>{
  let s=act(createAppointmentDemo(),'find_dates');assert.equal(bookingNext(s).disabled,true);
  s=act(s,'preferred_date','2026-11-17');assert.equal(bookingNext(s).action,'consult');
  s=act(s,'next_match');assert.equal(bookingNext(s).action,'show_times');
  s=act(s,'preferred_mode','range');assert.equal(bookingNext(s).disabled,true);assert.match(bookingNext(s).hint,/종료일/);
});
test('접수 답변을 열기만 하면 회신·이동 확인을 보존하고 실제 수정 때만 무효화한다',()=>{
  let s=act(chosen(),'review');s=act(s,'visit_type','first');s=act(s,'referral','reported');s=act(act(s,'request'),'reply','confirm');s=act(s,'travel_check','hospital');
  const previous=s;s=act(s,'edit_referral');assert.equal(s.status,'confirmed_demo');assert.deepEqual(s.travel,previous.travel);assert.equal(bookingNext(s).action,'view');
  s=act(s,'referral','missing');assert.equal(s.time,'14:40');assert.equal(s.status,'draft');assert.deepEqual(s.travel.checks,[]);assert.equal(bookingNext(s).label,'다음: AI에게 맡길 내용');
});
test('공개 병원 선택은 자동 이동하지 않고 선택 기관의 등록 과목을 요구한다',()=>{
  let s=createAppointmentDemo('jeju',{usePublicData:true,today:'2026-11-16'});
  s=act(s,'public_hospital','hospital-4');assert.equal(s.screen,'public_find');assert.equal(publicHospitalReady(s.jejuHospital),false);
  assert.equal(act(s,'public_dates_next').screen,'public_find');assert.equal(act(s,'public_visit_department','소아청소년과'),s);
  s=act(s,'public_visit_department','정형외과');assert.equal(publicHospitalReady(s.jejuHospital),true);
  s=act(s,'public_dates_next');assert.equal(s.screen,'public_dates');assert.equal(bookingStep(s),2);
});
test('등록 진료과 미수록 병원은 공식 창구와 병원 재선택을 안내한다',()=>{
  const start=createAppointmentDemo('jeju',{usePublicData:true,today:'2026-11-16'});
  const missing=act(start,'public_hospital','hospital-5');
  assert.equal(bookingNext(missing).disabled,true);
  assert.match(bookingNext(missing).hint,/공식 창구.*다른 병원/);
  const another=act(missing,'public_hospital','hospital-4');
  assert.match(bookingNext(another).hint,/진료받을 과/);
  assert.equal(bookingNext(act(another,'public_visit_department','정형외과')).disabled,false);
});
test('공개 병원 이름·정확한 시각은 검증된 예약이 아닌 사용자 희망으로만 저장한다',()=>{
  let s=createAppointmentDemo('jeju',{usePublicData:true,today:'2026-11-16'});
  for(const [type,value] of [['public_department','정형외과'],['public_hospital','hospital-4'],['public_dates_next'],['public_date','2026-11-25'],['public_doctor_mode','named'],['public_time','specific']])s=act(s,type,value);
  assert.equal(publicWishReady(s.jejuHospital),false);assert.equal(act(s,'public_prepare'),s);
  assert.equal(act(s,'public_exact_time','24:00'),s);assert.equal(act(s,'public_doctor_name','a\nb'),s);
  s=act(s,'public_doctor_name','문의할 의료진');s=act(s,'public_exact_time','10:20');assert.equal(publicWishReady(s.jejuHospital),true);
  s=act(s,'public_prepare');assert.equal(s.screen,'public_review');assert.equal(appointmentSelection(s).valid,false);assert.equal(appointmentSelection(s).doctor,null);
  const report=buildAppointmentReport(s,createDemoCase());for(const str of ['선택 진료과: 정형외과','문의할 의료진','10:20 희망','소속·진료 가능 여부 미확인','예약 미확정'])assert.ok(report.includes(str),str);
  s=act(s,'travel_check','hospital');s=act(s,'public_doctor_name','다른 문의 의료진');assert.deepEqual(s.travel.checks,[]);assert.equal(s.jejuHospital.prepared,false);
  assert.equal(act(s,'reply','confirm'),s);assert.equal(act(s,'edit_referral'),s);
});

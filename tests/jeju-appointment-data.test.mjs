import test from 'node:test';
import assert from 'node:assert/strict';
import {createAppointmentDemo,reduceAppointmentDemo as reduce,appointmentSelection,appointmentPreparation,buildAppointmentReport,canReviewAppointment} from '../app/appointment-demo.js';
import {publicHospitalCandidates,publicHospital,jejuSupportEvidence,JEJU_DATA_SOURCES} from '../app/jeju-appointment-data.js';
import {createDemoCase} from '../app/domain.js';
import {assessTravel} from '../app/appointment-travel.js';
const act=(s,type,value)=>reduce(s,{type,value,area:'제주시 애월읍'});
const start=()=>createAppointmentDemo('jeju',{usePublicData:true,area:'제주시 애월읍',today:'2026-11-16'});
function ready(){let s=act(start(),'public_hospital','hospital-4');s=act(s,'public_visit_department','정형외과');s=act(s,'public_dates_next');s=act(s,'public_date','2026-11-25');return act(s,'public_prepare');}
test('공개 병원은 실명·주소·등록 과목을 보존하고 가상 시간표와 분리한다',()=>{
  let s=start();assert.equal(s.screen,'public_find');assert.equal(publicHospitalCandidates(s.jejuHospital).length,13);
  s=act(s,'public_department','정형외과');assert.deepEqual(publicHospitalCandidates(s.jejuHospital).map(r=>r.id),['hospital-4','hospital-8','hospital-11']);
  assert.equal(act(s,'public_hospital','hospital-2'),s);s=act(s,'public_hospital','hospital-4');
  assert.equal(publicHospital(s).companyName,'제주우리병원');assert.equal(appointmentSelection(s).doctor,null);assert.equal(appointmentSelection(s).valid,false);
  for(const [type,value] of [['slot','baram-kang|2026-11-18|09:30'],['time','09:30'],['request',''],['reply','confirm'],['hospital','baram']])assert.equal(act(s,type,value),s);
});
test('희망 날짜는 한 달 단위로 범위·연도 이동이 가능하고 과거·임의 날짜는 거부한다',()=>{
  let s=act(start(),'public_hospital','hospital-4');s=act(s,'public_visit_department','정형외과');s=act(s,'public_dates_next');assert.equal(s.jejuHospital.month,'2026-11');
  for(const date of ['2026-11-15','2026-11-31','2026-12-01'])assert.equal(act(s,'public_date',date),s);
  s=act(s,'public_date_mode','range');s=act(s,'public_date','2026-11-25');assert.equal(canReviewAppointment(s),false);
  s=act(s,'public_month','2027-01');s=act(s,'public_date','2027-01-05');assert.equal(canReviewAppointment(s),true);
  assert.equal(s.jejuHospital.from,'2026-11-25');assert.equal(s.jejuHospital.to,'2027-01-05');
  assert.equal(act(s,'public_month','2028-01'),s);assert.equal(act(s,'public_month','2026-13'),s);
  s=act(s,'public_prepare');assert.equal(s.screen,'public_review');assert.equal(s.status,'draft');assert.equal(s.reservationConfirmed,undefined);
});
test('역순 기간·하루 전환을 처리하고 병원 조건 변경은 선택·완료와 이동 체크를 해제한다',()=>{
  let s=act(ready(),'public_edit_dates');assert.equal(s.screen,'public_dates');
  s=act(s,'public_date_mode','range');s=act(s,'public_date','2026-11-20');
  assert.equal(s.jejuHospital.from,'2026-11-20');assert.equal(s.jejuHospital.to,'2026-11-25');
  s=act(s,'public_date_mode','single');assert.equal(s.jejuHospital.to,s.jejuHospital.from);
  s=act(s,'travel_check','hospital');assert.ok(s.travel.checks.length);
  s=act(s,'public_area','서귀포시');assert.equal(s.jejuHospital.hospitalId,null);assert.equal(s.jejuHospital.prepared,false);assert.equal(canReviewAppointment(s),false);assert.deepEqual(s.travel.checks,[]);
  assert.equal(publicHospitalCandidates(s.jejuHospital).length,0);
});
test('공개 문의와 가상 예약을 왕복해도 실기관에 가상 확정을 붙이지 않는다',()=>{
  const publicState=ready();let s=act(publicState,'data_mode','demo');assert.equal(s.usePublicData,false);assert.equal(s.screen,'intake');
  s=act(s,'visit_type','first');s=act(s,'find_dates');s=act(s,'preferred_date','2026-11-18');s=act(s,'slot','baram-kang|2026-11-18|09:30');
  s=act(act(act(s,'review'),'request'),'reply','confirm');assert.equal(s.status,'confirmed_demo');
  s=act(s,'data_mode','public');assert.deepEqual(s.jejuHospital,publicState.jejuHospital);assert.equal(appointmentSelection(s).time,null);
  assert.match(assessTravel(s).pending.join(' '),/시간대 무관.*실제 진료 시각은 병원 확인/);assert.deepEqual(s.travel.checks,[]);
  const report=buildAppointmentReport(s,createDemoCase());assert.ok(!report.includes('09:30'));assert.ok(!report.includes('confirmed_demo'));assert.match(report,/예약 미확정/);
});
test('문의 지역과 휠체어 조건이 택시 순서를 바꾸고 등록 관할은 보건 문의처를 바꾼다',()=>{
  let s=start(),e=jejuSupportEvidence(s);assert.equal(e.taxi[0].name,'애월콜');assert.equal(e.health[0].name,'애월보건지소');
  s=act(s,'jeju_support_wheelchair',true);e=jejuSupportEvidence(s);assert.equal(e.taxi[0].id,'jeju-accessible-transport');
  s=act(s,'jeju_support_area','제주시 한경면');e=jejuSupportEvidence(s);assert.equal(e.health[0].name,'한경보건지소');assert.notEqual(e.taxi[0].name,'애월콜');
  s=act(s,'jeju_support_area','서귀포시');assert.equal(jejuSupportEvidence(s).health.length,0);
});
test('문의처 선택은 저장표·차량 창구에 반영되고 범위 변경 때 이전 연락처를 남기지 않는다',()=>{
  const c=createDemoCase(),before=structuredClone(c);let s=ready();
  for(const [kind,id] of [['taxi','taxi327-14'],['companion','care254-1'],['health','public-health1304-1']])s=act(s,'jeju_support_pick',{kind,id});
  assert.equal(appointmentPreparation(c,s).candidate.id,'taxi327-14');
  const report=buildAppointmentReport(s,c);for(const text of ['애월콜','애월보건지소','홀로 사는노인','2026-03-19','2020-04-17','2026-03-23','2024-10-17','2026-11-25','예약 미확정'])assert.ok(report.includes(text),text);
  assert.equal(act(s,'jeju_support_pick',{kind:'taxi',id:'untrusted-provider'}),s);
  s=act(s,'jeju_support_area','서귀포시');assert.deepEqual(jejuSupportEvidence(s).selected,{taxi:null,companion:null,health:null});assert.deepEqual(c,before);
});
test('서울 경로도 제주 구간의 공개 문의처를 사용하고 네 출처의 범위를 저장한다',()=>{
  let s=createAppointmentDemo('seoul',{area:'제주시 애월읍'});s=act(s,'jeju_support_pick',{kind:'taxi',id:'taxi327-14'});
  assert.equal(appointmentPreparation(createDemoCase(),s).candidate.name,'애월콜');
  const report=buildAppointmentReport(s,createDemoCase());for(const id of ['859','327','254','1304'])assert.ok(report.includes(`허브 ${id}`));
  assert.match(report,/제주 구간 문의 후보/);assert.match(report,/제주 문의처는 이 구간의 공급자가 아니에요/);assert.match(report,/ETA/);
  assert.deepEqual(JEJU_DATA_SOURCES.map(r=>r.count),[13,34,19,35]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase } from '../app/domain.js';
import { APPOINTMENT_HOSPITALS, APPOINTMENT_DOCTORS, APPOINTMENT_MONTHS, createAppointmentDemo, reduceAppointmentDemo as reduce, appointmentSlots, appointmentDay, appointmentCalendar, appointmentSelection, appointmentPreparation, nextAppointmentDate, referralDisposition, buildAppointmentReport } from '../app/appointment-demo.js';
import { appointmentMarkup } from '../app/appointment-view.js';
import { APPOINTMENT_DEPARTMENTS } from '../app/appointment-departments.js';
const choose=(state,type,value)=>reduce(state,{type,value});
function intake(type='first',referral='reported',state=createAppointmentDemo()) {
  return choose(choose(state,'visit_type',type),'referral',referral);
}
function ready(referral='reported') {
  let state=choose(intake('first',referral),'doctor','hanbit-kim');
  state=choose(state,'month','2026-12');state=choose(state,'date','2026-12-08');
  return choose(state,'time','10:30');
}
const requested=(referral='reported')=>choose(choose(ready(referral),'review'),'request');

test('27개 진료과는 두 가상 병원에서 해당 과의 의료진이나 일정 상담으로 이어진다',()=>{
  assert.equal(APPOINTMENT_DEPARTMENTS.length,27);
  assert.equal(new Set(APPOINTMENT_DOCTORS.map(doctor=>doctor.id)).size,APPOINTMENT_DOCTORS.length);
  assert.equal(APPOINTMENT_DOCTORS.filter(doctor=>['hanbit','nuri'].includes(doctor.hospitalId)).length,55);
  for(const hospitalId of ['hanbit','nuri'])for(const department of APPOINTMENT_DEPARTMENTS) {
    let state=choose(createAppointmentDemo(),'hospital',hospitalId);state=choose(state,'department',department.name);
    const doctors=APPOINTMENT_DOCTORS.filter(doctor=>doctor.hospitalId===hospitalId && doctor.department===department.name);
    assert.ok(doctors.length);state=intake('first','reported',state);
    const selected=choose(state,'doctor',doctors[0].id);assert.equal(selected.screen,'schedule');assert.equal(appointmentSelection(selected).doctor.department,department.name);
    assert.equal(choose(selected,'consult').requestMode,'consultation');
  }
});

test('일정 열람 전에 접수를 강제하지 않고 판독문으로 의뢰서 준비를 대체하지 않는다',()=>{
  const initial=createAppointmentDemo();assert.equal(initial.screen,'intake');assert.equal(initial.visitType,null);assert.equal(initial.referralStatus,null);
  assert.equal(choose(initial,'continue'),initial);assert.equal(choose(initial,'doctor','hanbit-kim').screen,'schedule');assert.equal(choose(initial,'request'),initial);
  assert.equal(choose(initial,'referral','reported'),initial);assert.equal(choose(initial,'visit_type','__proto__'),initial);
  const source=createDemoCase();source.documents.find(doc=>doc.id==='report').status='ready';
  const before=structuredClone(source),state=intake('first','missing');
  assert.equal(referralDisposition(state).canConfirm,false);assert.match(referralDisposition(state).next,/제주 담당 의료진/);
  assert.equal(appointmentPreparation(source).documents[0].id,'referral');assert.equal(appointmentPreparation(source).documents[0].ready,false);
  assert.deepEqual(source,before);
});

test('의뢰서 미준비·미확인은 일정 열람과 상담을 허용하고 예약 확정 시연을 허용하지 않는다',()=>{
  for(const referral of ['missing','unknown']) {
    const state=requested(referral);assert.equal(state.status,'consultation_requested_demo');
    assert.equal(choose(state,'reply','confirm'),state);
    const reply=choose(state,'reply','documents');assert.equal(reply.status,'documents_needed_demo');
    assert.equal(choose(reply,'reply','confirm'),reply);assert.equal(choose(reply,'edit_intake').screen,'intake');
  }
  const consultation=choose(choose(intake('first','missing'),'consult'),'request');
  assert.equal(consultation.date,null);assert.equal(consultation.time,null);assert.equal(consultation.doctorId,null);
  assert.equal(consultation.status,'consultation_requested_demo');
});

test('재진은 기존 제출 여부를 구분하고 병원·진료과 변경 때 기존 답변을 재사용하지 않는다',()=>{
  const submitted=intake('followup','submitted');assert.equal(referralDisposition(submitted).canConfirm,true);
  assert.match(referralDisposition(submitted).next,/기존 의뢰서.*이번 진료/);
  assert.equal(referralDisposition(intake('followup','unknown')).canConfirm,false);
  assert.equal(referralDisposition(intake('unknown','reported')).canConfirm,false);
  for(const [type,value] of [['hospital','nuri'],['department','외과']]) {
    const next=choose(submitted,type,value);assert.equal(next.screen,'intake');assert.equal(next.visitType,null);assert.equal(next.referralStatus,null);assert.equal(next.time,null);
  }
  const first=choose(createAppointmentDemo(),'visit_type','first');assert.equal(choose(first,'referral','submitted'),first);
});

test('달력은 실제 월 길이·요일·연도 전환을 보존하고 현재 시연 월부터 보여준다',()=>{
  for(const [month,length,offset] of [['2026-11',30,0],['2026-12',31,2],['2027-01',31,5]]) {
    const cells=appointmentCalendar(month);assert.equal(cells.filter(Boolean).length,length);assert.equal(cells.indexOf(month+'-01'),offset);assert.equal(cells.length%7,0);
    assert.equal(cells.filter(Boolean).at(-1),month+'-'+length);
  }
  assert.deepEqual(appointmentCalendar('2026-13'),[]);
  const state=choose(intake(),'doctor','hanbit-kim');assert.equal(state.month,'2026-11');assert.equal(state.date,null);assert.equal(state.time,null);
  assert.equal(nextAppointmentDate('hanbit-kim'),'2026-12-08');assert.equal(nextAppointmentDate('nuri-choi'),null);
  assert.ok(!appointmentCalendar(state.month).filter(Boolean).some(date=>appointmentDay(state.doctorId,date)==='available'));
});

test('마감·미공개·휴진·지난 날짜를 구분하고 미공개를 마감으로 확정하지 않는다',()=>{
  assert.equal(appointmentDay('hanbit-kim','2026-11-17'),'full');assert.equal(appointmentDay('hanbit-kim','2026-11-18'),'unpublished');
  assert.equal(appointmentDay('hanbit-kim','2026-11-14'),'past');assert.equal(appointmentDay('hanbit-kim','2026-11-21'),'closed');
  let state=choose(intake(),'doctor','hanbit-kim');
  assert.equal(choose(state,'date','2026-11-14'),state);assert.equal(choose(state,'date','2026-12-08'),state);
  state=choose(state,'date','2026-11-18');assert.equal(choose(state,'time','10:30'),state);assert.equal(choose(state,'review'),state);
  state=choose(state,'next_available');assert.equal(state.month,'2026-12');assert.equal(state.date,'2026-12-08');assert.equal(state.time,null);
});

test('모든 의사·월의 실제 고정 슬롯만 선택되며 마감 시간·임의 시간은 거부한다',()=>{
  for(const doctor of APPOINTMENT_DOCTORS) {
    let state=choose(createAppointmentDemo(APPOINTMENT_HOSPITALS.find(h=>h.id===doctor.hospitalId).region),'hospital',doctor.hospitalId);state=choose(state,'department',doctor.department);state=intake('first','reported',state);state=choose(state,'doctor',doctor.id);
    for(const month of APPOINTMENT_MONTHS) {
      state=choose(state,'month',month);
      for(const date of appointmentCalendar(month).filter(Boolean)) {
        const dayState=choose(state,'date',date);
        for(const slot of appointmentSlots(doctor.id,date)) {
          const selected=choose(dayState,'time',slot.time);assert.equal(appointmentSelection(selected).valid,slot.available,`${doctor.id} ${date} ${slot.time}`);
          if(!slot.available)assert.equal(selected,dayState);
        }
      }
    }
  }
  const state=ready();assert.equal(choose(state,'time','25:00'),state);assert.equal(choose(state,'month','2028-01'),state);
});

test('의뢰서 보유는 자기보고이며 실제 case를 수정하지 않고 요청·확정도 명시적 시연만 수행한다',()=>{
  const source=createDemoCase(),before=structuredClone(source),state=requested();
  assert.equal(state.status,'requested_demo');assert.equal(choose(state,'request'),state);
  const confirmed=choose(state,'reply','confirm');assert.equal(confirmed.status,'confirmed_demo');assert.equal(choose(confirmed,'reply','change'),confirmed);
  const html=appointmentMarkup(confirmed,source);assert.match(html,/실제 병원 예약은 만들어지지/);assert.match(html,/실제 문서·병원 접수를 검증한 뜻이 아니/);
  assert.deepEqual(source,before);assert.equal(source.documents.find(doc=>doc.id==='referral').status,'missing');
});

test('월·날짜·의료진·접수 조건 변경은 기존 시간·요청을 해제하고 재확인을 남긴다',()=>{
  for(const [type,value] of [['month','2027-01'],['date','2026-12-09'],['doctor','hanbit-lee']]) {
    const next=choose(ready(),type,value);assert.equal(next.time,null);assert.equal(next.status,'draft');
  }
  const confirmed=choose(requested(),'reply','confirm'),edit=choose(confirmed,'edit');assert.equal(edit.recheck,true);assert.equal(edit.time,null);
  assert.equal(choose(edit,'request'),edit);
  const intakeEdit=choose(confirmed,'edit_intake');assert.equal(intakeEdit.time,confirmed.time);assert.equal(intakeEdit.status,confirmed.status);
  const changed=choose(intakeEdit,'referral','missing');assert.equal(changed.time,null);assert.equal(changed.recheck,true);assert.equal(changed.status,'draft');
});

test('공개 일정 없는 의료진도 상담으로 이어지고 자동 대기 등록이나 확정을 만들지 않는다',()=>{
  let state=choose(createAppointmentDemo(),'hospital','nuri');state=intake('first','reported',state);state=choose(state,'doctor','nuri-choi');
  assert.equal(nextAppointmentDate(state.doctorId),null);assert.equal(choose(state,'next_available'),state);
  const consultation=choose(choose(state,'consult'),'request');assert.equal(consultation.status,'consultation_requested_demo');assert.equal(choose(consultation,'reply','confirm'),consultation);
  assert.match(appointmentMarkup(state,createDemoCase()),/이 버튼으로 등록되지는 않아요/);
});

test('자료·휠체어·출처와 공항/항공/서울/귀가를 이어가되 제주 제공자를 서울에 배정하지 않는다',()=>{
  const source=createDemoCase();source.visitSupport.requirements.wheelchair=true;
  const prep=appointmentPreparation(source);assert.equal(prep.candidate.id,'jeju-accessible-transport');assert.equal(prep.legs.length,4);
  assert.match(prep.legs.find(leg=>leg.id==='seoul').detail,/제주 문의처는.*공급자가 아니/);
  assert.match(prep.legs.find(leg=>leg.id==='return').detail,/검사가 다른 날/);
  const report=buildAppointmentReport(requested('missing'),source);
  for(const pattern of [/진료의뢰서: 의뢰서 미준비/,/제주 담당 의료진/,/판독문·영상.*의뢰서를 대신하지/,/2026-12-08 10:30/,/실제 예약 미확정/,/실제 병원의 대기기간 통계가 아닙니다/,/공개 출처/,/snuh.org/])assert.match(report,pattern);
});

test('공개 자료와 이름은 이스케이프하고 자료 조회 뒤 선택 시간은 보존한다',()=>{
  const source=createDemoCase();source.patient.name='<img src=x onerror=alert(1)>';
  const html=appointmentMarkup(choose(ready(),'review'),source);assert.ok(!html.includes('<img src=x'));assert.match(html,/&lt;img/);
  const records=choose(ready(),'view','records');assert.equal(choose(records,'resume').time,'10:30');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase} from '../app/domain.js';
import {createAppointmentDemo,reduceAppointmentDemo} from '../app/appointment-demo.js';
import {applyCareRequest} from '../app/care-request-entry.js';
import {coordinationView,reduceCoordination,runCoordinationDemo} from '../app/care-coordination.js';
import {reservationEditTarget,reservationEditSummary,applyReservationEdit} from '../app/reservation-edit.js';
const c=createDemoCase(),act=(s,type,value)=>reduceAppointmentDemo(s,{type,value}),coord=(s,field,value)=>reduceCoordination(s,{type:'coordination_option',value:{field,value}},c);
const chosen=()=>applyCareRequest(createAppointmentDemo('jeju',{usePublicData:true,today:'2026-11-18'}),'제주우리병원 정형외과 12월 3일 오후. 애월읍에서 휠체어와 동행이 필요해요.');
async function finish(s){s=reduceCoordination(s,{type:'coordination_start',runId:crypto.randomUUID()},c);await runCoordinationDemo(s,c,{wait:async()=>{},onEvent:value=>{s=reduceCoordination(s,{type:'coordination_event',value},c);}});return s;}
test('수정 진입·탐색은 기존 일정·유효 회신을 바꾸지 않는다',async()=>{
 const original=await finish(chosen()),copy=structuredClone(original);for(const [section,screen] of [['hospital','public_find'],['schedule','public_dates'],['support','support']]){const editing=reservationEditTarget(original,section);assert.equal(editing.screen,screen);assert.equal(editing.coordination.resultOpen,false);assert.equal(reservationEditSummary(original,editing,c).changed,false);assert.equal(coordinationView(editing,c).confirmed,3);}assert.deepEqual(original,copy);
});
test('날짜·시간 변경은 진료와 연결된 지원을 함께 재조율한다',async()=>{
 const original=await finish(chosen()),editing=act(reservationEditTarget(original),'public_time','morning');const summary=reservationEditSummary(original,editing,c);assert.deepEqual(summary.changes.map(r=>r.id),['hospital','taxi','companion']);assert.equal(summary.preserved,0);assert.equal(coordinationView(original,c).confirmed,3);const applied=applyReservationEdit(original,editing,c);assert.equal(coordinationView(applied,c).confirmed,0);assert.equal(coordinationView(await finish(applied),c).confirmed,3);
});
test('차량 시각만 변경하면 병원과 동행의 receipt를 보존한다',async()=>{
 const original=await finish(chosen()),editing=coord(reservationEditTarget(original,'support'),'pickupTime','12:20');const summary=reservationEditSummary(original,editing,c);assert.deepEqual(summary.changes.map(r=>r.id),['taxi']);assert.equal(summary.preserved,2);const applied=applyReservationEdit(original,editing,c);assert.equal(applied.coordination.results.hospital,original.coordination.results.hospital);assert.equal(applied.coordination.results.companion,original.coordination.results.companion);assert.equal(coordinationView(applied,c).confirmed,2);
});
test('편집 중 값을 원래대로 돌리면 적용 시 기존 결과를 유지한다',async()=>{
 const original=await finish(chosen());let editing=act(reservationEditTarget(original),'public_time','morning');editing=act(editing,'public_time','afternoon');assert.equal(reservationEditSummary(original,editing,c).changed,false);assert.deepEqual(applyReservationEdit(original,editing,c).coordination.results,original.coordination.results);
});
test('지원 제외와 휠체어 변경은 필요한 항목만 변경한다',async()=>{
 const original=await finish(chosen()),excluded=coord(reservationEditTarget(original,'support'),'companion',false);assert.equal(coordinationView(applyReservationEdit(original,excluded,c),c).confirmed,2);assert.equal(coordinationView(applyReservationEdit(original,excluded,c),c).done,true);
 const wheelchair=coord(reservationEditTarget(original,'support'),'wheelchair',false);assert.deepEqual(reservationEditSummary(original,wheelchair,c).changes.map(r=>r.id),['taxi','companion']);
});
test('잘못된 차량 출발 시각과 날짜가 빠진 수정은 적용하지 않는다',async()=>{
 const original=await finish(chosen()),late=coord(reservationEditTarget(original,'support'),'pickupTime','16:00');assert.equal(applyReservationEdit(original,late,c),null);const blank={...reservationEditTarget(original),jejuHospital:{...original.jejuHospital,from:null,to:null}};assert.equal(reservationEditSummary(original,blank,c).ready,false);assert.equal(applyReservationEdit(original,blank,c),null);
});
test('원래 요청하지 않은 지원은 진료 변경 비교에 끼워 넣지 않는다',async()=>{
 const original=await finish(coord(coord(chosen(),'taxi',false),'companion',false));
 const editing=act(reservationEditTarget(original),'public_time','morning');
 assert.deepEqual(reservationEditSummary(original,editing,c).changes.map(row=>row.id),['hospital']);
 assert.equal(coordinationView(await finish(applyReservationEdit(original,editing,c)),c).confirmed,1);
});
test('내륙에서도 기존 의료진·시간을 채우고 변경 비교에 포함한다',async()=>{
 let original=act(createAppointmentDemo('seoul'),'find_dates');for(const [type,value] of [['preferred_month','2026-12'],['preferred_date','2026-12-08'],['slot','hanbit-kim|2026-12-08|14:40']])original=act(original,type,value);original=await finish(original);const editing=reservationEditTarget(original);assert.equal(editing.screen,'availability');assert.equal(editing.time,'14:40');assert.equal(reservationEditSummary(original,editing,c).changed,false);
});

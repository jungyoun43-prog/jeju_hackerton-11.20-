import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCareRequest,applyCareRequest,careRequestPreview,careRequestReview} from '../app/care-request-entry.js';
import {createAppointmentDemo,reduceAppointmentDemo} from '../app/appointment-demo.js';
const make=()=>createAppointmentDemo('jeju',{usePublicData:true,area:'제주시 애월읍',today:'2026-11-17'});
const options={region:'jeju',today:'2026-11-17'};
test('명시한 병원·등록 과·범위·시간·이동 조건을 기존 reducer로 반영한다',()=>{
  const source=make(),text='제주우리병원 정형외과 12월 1일부터 3일 사이 오후에 가요. 애월읍에서 휠체어가 필요해요.';
  const next=applyCareRequest(source,text);assert.equal(source.jejuHospital.hospitalId,null);
  assert.equal(next.jejuHospital.hospitalId,'hospital-4');assert.equal(next.jejuHospital.visitDepartment,'정형외과');assert.equal(next.jejuHospital.from,'2026-12-01');assert.equal(next.jejuHospital.to,'2026-12-03');assert.equal(next.jejuHospital.timeOfDay,'afternoon');assert.equal(next.jejuSupport.wheelchair,true);assert.equal(next.quickEntry.text,text);assert.equal(next.jejuHospital.prepared,false);
});
test('증상에서 과·병원·날짜를 만들어내지 않는다',()=>{const p=parseCareRequest('무릎이 아파요',options);assert.equal(p.department,null);assert.equal(p.hospitalId,null);assert.equal(p.from,null);});
test('복수 병원·진료과는 직접 선택으로 남긴다',()=>{const p=parseCareRequest('정형외과 또는 신경외과',options);assert.equal(p.department,null);assert.ok(p.notices.length);});
test('부정한 과와 날짜를 긍정 조건으로 반영하지 않는다',()=>{const p=parseCareRequest('정형외과 말고 신경외과. 12월 1일은 말고 다른 날',options);assert.equal(p.department,'신경외과');assert.equal(p.from,null);});
test('지난 날짜·불가능한 날짜·애매한 상대 날짜를 보류한다',()=>{for(const text of ['11월 3일','2월 30일','다음 주'])assert.equal(parseCareRequest(text,options).from,null);});
test('의뢰서와 판독문을 혼동하지 않고 부재 응답도 조건으로 표시한다',()=>{assert.equal(careRequestPreview('판독문은 있어요','jeju')[2].value,'');assert.match(careRequestPreview('의뢰서는 없어요','jeju')[2].value,/미준비/);});
test('네 항목은 입력에 따라 채워지며 예약 완료를 주장하지 않는다',()=>{const p=careRequestPreview('제주우리병원 정형외과 12월 3일 오후. 의뢰서는 없고 애월읍에서 휠체어가 필요해요.','jeju','2026-11-17');assert.equal(p.length,4);assert.ok(p.every(row=>row.value));assert.ok(p.every(row=>!row.value.includes('예약 완료')));});
test('내륙 실제 병원을 기본 가상 기관으로 간주하지 않는다',()=>{const state=applyCareRequest(createAppointmentDemo('seoul'),'서울아산병원 정형외과 12월 3일',{today:'2026-11-17'});assert.equal(careRequestReview(state)[0].value,null);assert.ok(state.quickEntry.notices.length);});
test('이동 조건 수정은 이전 체크를 무효화한다',()=>{const source=make();source.travel.checks=['pickup'];const next=applyCareRequest(source,'애월읍에서 휠체어가 필요해요.');assert.equal(next.travel.checks.length,0);});
test('휠체어 불필요·의문을 필요로 확정하지 않는다',()=>{assert.equal(parseCareRequest('휠체어는 필요 없어요',options).wheelchair,false);assert.equal(parseCareRequest('휠체어가 필요한지 모르겠어요',options).wheelchair,null);});
test('명시한 취소는 이전 병원·날짜·시간과 이동 체크를 지운다',()=>{
  const first=applyCareRequest(make(),'제주우리병원 정형외과 12월 1일 오전');first.travel.checks=['pickup'];
  const next=applyCareRequest(first,'제주우리병원은 취소하고 날짜는 12월 1일 말고 아직 미정이에요');
  assert.equal(next.jejuHospital.hospitalId,null);assert.equal(next.jejuHospital.visitDepartment,'');assert.equal(next.jejuHospital.from,null);assert.equal(next.jejuHospital.to,null);assert.equal(next.jejuHospital.timeOfDay,'unknown');assert.deepEqual(next.travel.checks,[]);
});
test('미언급 조건은 유지하고 명시한 휠체어 미확인은 이전 필요 응답을 지운다',()=>{
  const first=applyCareRequest(make(),'제주우리병원 정형외과 12월 1일 오전. 휠체어가 필요해요');
  const next=applyCareRequest(first,'휠체어 필요 여부 미확인');
  assert.equal(next.jejuSupport.wheelchair,null);assert.equal(next.jejuHospital.hospitalId,first.jejuHospital.hospitalId);assert.equal(next.jejuHospital.from,'2026-12-01');
  assert.equal(parseCareRequest('휠체어 필요하지 않아요',options).wheelchair,false);assert.equal(parseCareRequest('휠체어',options).wheelchair,null);
});
test('가상 병원 명시 취소도 자동 기본 선택으로 돌아가지 않는다',()=>{
  const first=applyCareRequest(createAppointmentDemo('seoul'),'서울 한빛대학교병원 정형외과 12월 1일',{today:'2026-11-17'});
  const next=applyCareRequest(first,'서울 한빛대학교병원은 취소',{today:'2026-11-17'});assert.equal(next.hospitalId,null);assert.equal(careRequestReview(next)[0].value,null);
});
test('예약 미확인은 명시한 희망 날짜를 취소하지 않는다',()=>{
  const p=parseCareRequest('제주우리병원 정형외과. 희망 일정: 2026-12-01 오전 (실제 예약 미확인).',options);
  assert.equal(p.from,'2026-12-01');assert.ok(!p.clear.includes('date'));
});
test('시간 미정은 시간 무관으로 간주하지 않고 선택할 항목으로 남긴다',()=>{
  const first=applyCareRequest(make(),'제주우리병원 정형외과 12월 1일 오전');
  const next=applyCareRequest(first,'시간은 미정이에요');assert.equal(next.jejuHospital.timeOfDay,'unknown');assert.equal(careRequestReview(next)[3].value,null);
});
test('음성 요약의 병원명 띄어쓰기만 정확한 공개 이름으로 맞춘다',()=>{assert.equal(parseCareRequest('제주 우리 병원 정형외과',options).hospitalId,'hospital-4');assert.equal(parseCareRequest('제주 우리 치과 정형외과',options).hospitalId,null);});

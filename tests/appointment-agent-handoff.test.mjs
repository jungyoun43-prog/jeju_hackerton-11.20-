import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase} from '../app/domain.js';
import {createAppointmentDemo,reduceAppointmentDemo,buildAppointmentReport} from '../app/appointment-demo.js';
import {buildAppointmentAgentDraft,mergeAppointmentDraft} from '../app/appointment-agent-handoff.js';
import {bookingSteps} from '../app/appointment-flow.js';
import {assessTravel} from '../app/appointment-travel.js';

function selected(){let state=createAppointmentDemo('jeju',{usePublicData:true,area:'제주시 애월읍',today:'2026-11-17'});for(const [type,value] of [['public_department','정형외과'],['public_hospital','hospital-4'],['public_date_mode','range'],['public_date','2026-11-20'],['public_date','2026-11-23'],['public_time','morning'],['jeju_support_wheelchair',true]])state=reduceAppointmentDemo(state,{type,value});return state;}
test('공개 병원·기간·오전·휠체어 조건과 출처를 요청 초안에 남기고 상태는 바꾸지 않는다',()=>{
 const state=selected(),before=structuredClone(state),draft=buildAppointmentAgentDraft(state,createDemoCase());
 assert.match(draft,/제주우리병원/);assert.match(draft,/정형외과/);assert.match(draft,/2026-11-20 ~ 2026-11-23/);assert.match(draft,/오전/);assert.match(draft,/휠체어 지원 우선 조회: 필요/);
 assert.match(draft,/859.*2024-10-17/);assert.match(draft,/임의의 확정일로 바꾸지/);assert.match(draft,/실제 전화·예약·배차·개인기록 조회는 하지/);assert.ok(draft.length<=1600);assert.deepEqual(state,before);
});
test('가상 병원과 실제 등록 기관을 섞지 않고 내륙 체험임을 요청에 표시한다',()=>{
 const state=createAppointmentDemo('seoul'),draft=buildAppointmentAgentDraft(state,createDemoCase());assert.match(draft,/내륙 가상 예약 체험/);assert.match(draft,/실제 기관으로 조회하지/);assert.doesNotMatch(draft,/병원 근거: 제주데이터허브 859/);
});
test('기존 초안은 이어붙이고 너무 길면 잘라 덮어쓰지 않는다',()=>{
 assert.equal(mergeAppointmentDraft('기존 요청','새 조건'),'기존 요청\n\n새 조건');assert.equal(mergeAppointmentDraft('동일','동일'),'동일');assert.equal(mergeAppointmentDraft('가'.repeat(1590),'나'.repeat(30)),null);
});
test('공개 희망 일정과 가상 의료진을 구분하고 요청 확인에서 AI 예약 결과로 이어진다',()=>{
 const publicSteps=bookingSteps(selected()),demoSteps=bookingSteps(createAppointmentDemo('seoul'));
 assert.equal(publicSteps[1],'희망 의료진·시간');assert.equal(demoSteps[1],'의료진·시간');
 assert.deepEqual(publicSteps.slice(2),['요청 확인','AI 예약·결과']);assert.deepEqual(demoSteps.slice(2),publicSteps.slice(2));
});
test('오전 희망은 화면과 저장 준비표에서 미선택으로 바뀌지 않는다',()=>{
 const state=selected(),summary=assessTravel(state),report=buildAppointmentReport(state,createDemoCase());
 assert.match(summary.pending.join('\n'),/오전 희망/);assert.doesNotMatch(summary.pending.join('\n'),/시각 미선택|희망 희망/);assert.match(report,/오전 희망/);assert.doesNotMatch(report,/시각 미선택|희망 희망/);
});
test('하루·정확한 희망 시각은 계획 순서만 대조하고 가상 시간표는 사용하지 않는다',()=>{
 const state=selected();state.jejuHospital={...state.jejuHospital,from:'2026-11-20',to:'2026-11-20',timeOfDay:'specific',time:'10:00'};state.travel.times.hospitalArrival='2026-11-20T11:00';state.date='2026-12-31';state.time='23:59';
 assert.ok(assessTravel(state).issues.some(item=>item.includes('병원 도착 계획')));
});

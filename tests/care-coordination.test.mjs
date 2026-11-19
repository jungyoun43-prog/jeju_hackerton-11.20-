import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase} from '../app/domain.js';
import {createAppointmentDemo,reduceAppointmentDemo} from '../app/appointment-demo.js';
import {applyCareRequest} from '../app/care-request-entry.js';
import {coordinationView,reduceCoordination,runCoordinationDemo,coordinationReport} from '../app/care-coordination.js';
import {bookingNext} from '../app/appointment-flow.js';
const caseState=createDemoCase();
const act=(s,type,value)=>reduceAppointmentDemo(s,{type,value});
const coord=(s,type,value)=>reduceCoordination(s,{type,value},caseState);
const chosen=()=>applyCareRequest(createAppointmentDemo('jeju',{usePublicData:true,today:'2026-11-18'}),'제주우리병원 정형외과 12월 3일 오후. 애월읍에서 휠체어와 동행이 필요해요.');
const start=s=>reduceCoordination(s,{type:'coordination_start',runId:'test-run'},caseState);
async function finish(s){s=start(s);await runCoordinationDemo(s,caseState,{wait:async()=>{},onEvent:e=>{s=coord(s,'coordination_event',e);}});return s;}
test('공개 병원과 가상 회신을 분리하고 미완료는 체크하지 않는다',()=>{
 const s=chosen(),v=coordinationView(s,caseState);assert.equal(v.ready,true);assert.equal(v.done,false);assert.equal(v.confirmed,0);assert.equal(v.selectedName,'제주우리병원');assert.equal(v.hospitalName,'가상 제주 병원');assert.equal(v.date,'2026-12-03');assert.equal(v.time,'14:00');assert.equal(v.options.pickupTime,'13:00');assert.equal(v.total,3);assert.equal(s.status,'draft');
});
test('가상 회신 수신 뒤 요청한 3건이 완료되며 실제 사례와 기존 상태는 그대로다',async()=>{
 const before=structuredClone(caseState),s=await finish(chosen()),v=coordinationView(s,caseState);assert.equal(v.confirmed,3);assert.equal(v.done,true);assert.equal(v.running,false);assert.deepEqual(caseState,before);assert.equal(s.status,'draft');assert.equal(s.jejuHospital.prepared,false);assert.equal(bookingNext({...s,screen:'support'},caseState).action,'coordination_save');assert.match(coordinationReport(s,caseState),/실제 전화·예약·배차 없음/);assert.match(coordinationReport(s,caseState),/가상 제주 병원/);
});
test('마지막 결과 뒤 결과창을 열고 닫기·다시 열기는 예약 상태를 바꾸지 않는다',async()=>{
 let s=await finish(chosen());assert.equal(s.coordination.resultOpen,true);const receipts=s.coordination.results;
 s=coord(s,'coordination_result_close');assert.equal(s.coordination.resultOpen,false);assert.equal(s.coordination.results,receipts);assert.equal(coordinationView(s,caseState).done,true);
 s=coord(s,'coordination_result_open');assert.equal(s.coordination.resultOpen,true);s=coord(s,'coordination_result_close');s=act(s,'public_time','morning');assert.equal(coord(s,'coordination_result_open'),s);
});
test('단순 시작·연락·회신 대기는 성공 체크를 만들지 않는다',()=>{
 let s=start(chosen());const v=coordinationView(s,caseState);for(const phase of ['contacting','waiting'])s=coord(s,'coordination_event',{runId:v.runId,signature:v.signature,jobId:'hospital',phase});assert.equal(coordinationView(s,caseState).confirmed,0);assert.equal(coordinationView(s,caseState).done,false);
});
test('연락 순서를 생략한 receipt, 실제 모드, 다른 날짜, 이전 run 이벤트는 거부한다',async()=>{
 const events=[];const begun=start(chosen());await runCoordinationDemo(begun,caseState,{wait:async()=>{},onEvent:e=>events.push(e)});let s=begun;const receipt=events.find(e=>e.phase==='result');assert.equal(coord(s,'coordination_event',receipt),s);s=coord(s,'coordination_event',events[0]);s=coord(s,'coordination_event',events[1]);for(const e of [{...receipt,runId:'old'},{...receipt,receipt:{...receipt.receipt,mode:'real'}},{...receipt,receipt:{...receipt.receipt,date:'2026-12-09'}}])assert.equal(coord(s,'coordination_event',e),s);
});
test('차량 없음은 2건 완료·1건 인계로 종료한다',async()=>{
 const s=await finish(coord(chosen(),'coordination_scenario','taxi_unavailable')),v=coordinationView(s,caseState);assert.equal(v.done,true);assert.equal(v.confirmed,2);assert.equal(v.handoffs,1);assert.equal(v.rows.find(r=>r.id==='taxi').status,'handoff');assert.match(v.title,/직접 확인/);
});
test('병원 본인확인에서 멈추면 이동·동행을 확정하지 않는다',async()=>{
 const s=await finish(coord(chosen(),'coordination_scenario','hospital_identity')),v=coordinationView(s,caseState);assert.equal(v.done,true);assert.equal(v.confirmed,0);assert.equal(v.handoffs,3);
});
test('요청하지 않은 지원은 제외하며 명시한 부정 요청이 기본값보다 우선한다',async()=>{
 const input=applyCareRequest(chosen(),'택시는 필요 없고, 동행도 필요 없어요.'),s=await finish(input),v=coordinationView(s,caseState);assert.equal(v.total,1);assert.equal(v.done,true);assert.equal(v.rows.find(r=>r.id==='taxi').status,'not_needed');assert.equal(v.rows.find(r=>r.id==='companion').status,'not_needed');
});
test('픽업 시각 변경은 차량만 다시 확인하고 병원·동행 결과는 보존한다',async()=>{
 let s=await finish(chosen());s=coord(s,'coordination_option',{field:'pickupTime',value:'12:30'});let v=coordinationView(s,caseState);assert.equal(v.confirmed,2);assert.equal(v.done,false);assert.equal(v.rows.find(r=>r.id==='taxi').status,'queued');s=await finish(s);v=coordinationView(s,caseState);assert.equal(v.confirmed,3);
});
test('병원 시각 변경은 종속 예약 결과를 모두 무효로 한다',async()=>{
 let s=await finish(chosen());s=act(s,'public_time','morning');const v=coordinationView(s,caseState);assert.equal(v.done,false);assert.equal(v.confirmed,0);assert.equal(v.changed,true);
});
test('조건을 원래 값으로 되돌려도 예전 예약을 되살리지 않는다',async()=>{
 let s=await finish(chosen());s=act(s,'public_time','morning');s=act(s,'public_time','afternoon');assert.equal(coordinationView(s,caseState).confirmed,0);
 s=await finish(chosen());s=coord(s,'coordination_option',{field:'pickupTime',value:'12:30'});s=coord(s,'coordination_option',{field:'pickupTime',value:'13:00'});assert.equal(coordinationView(s,caseState).confirmed,2);
 s=await finish(chosen());s=applyCareRequest(s,'동행은 필요 없어요.');s=applyCareRequest(s,'동행이 필요해요.');assert.equal(coordinationView(s,caseState).confirmed,2);
});
test('중지 뒤 늦게 온 결과는 무시하고 다시 시작하면 남은 일만 진행한다',async()=>{
 let s=start(chosen());const events=[];await runCoordinationDemo(s,caseState,{wait:async()=>{},onEvent:e=>events.push(e)});for(const e of events.slice(0,3))s=coord(s,'coordination_event',e);s=coord(s,'coordination_stop');assert.equal(coord(s,'coordination_event',events[3]),s);assert.equal(coordinationView(s,caseState).confirmed,1);s=await finish(s);assert.equal(coordinationView(s,caseState).confirmed,3);
});
test('이중 시작·완료 후 시작·진행 중 설정 변경은 실행을 늘리지 않는다',async()=>{
 let s=start(chosen());assert.equal(start(s),s);assert.equal(coord(s,'coordination_option',{field:'taxi',value:false}),s);s=await finish(chosen());assert.equal(start(s),s);
});
test('시간이 없거나 출발이 진료보다 늦으면 시작할 수 없다',()=>{
 const empty=createAppointmentDemo('jeju',{usePublicData:true});assert.equal(start(empty),empty);const bad=coord(chosen(),'coordination_option',{field:'pickupTime',value:'15:00'});assert.equal(start(bad),bad);assert.match(coordinationView(bad,caseState).issue,/진료 시각/);
});
test('내륙 예약 결과와 항공권 결제는 별도로 남긴다',async()=>{
 let s=act(createAppointmentDemo('seoul'),'find_dates');for(const [t,v] of [['preferred_month','2026-12'],['preferred_date','2026-12-08'],['slot','hanbit-kim|2026-12-08|14:40']])s=act(s,t,v);s=await finish(s);assert.equal(coordinationView(s,caseState).done,true);assert.match(coordinationReport(s,caseState),/항공권 가격 비교·결제/);assert.equal(s.status,'draft');
});
test('abort 신호 이후 가상 회신을 발행하지 않는다',async()=>{
 const c=new AbortController(),events=[];await runCoordinationDemo(start(chosen()),caseState,{signal:c.signal,wait:async()=>{c.abort();},onEvent:e=>events.push(e)});assert.equal(events.filter(e=>e.phase==='result').length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppointmentDemo,reduceAppointmentDemo as reduce,availableAppointments,availabilityDay,appointmentSelection,nextMatchingDate,buildAppointmentReport } from '../app/appointment-demo.js';
import { flightSearch,validFlightDate,bookingCallHref } from '../app/appointment-booking-links.js';
import { createDemoCase } from '../app/domain.js';
const act=(state,type,value)=>reduce(state,{type,value});
function start(referral='reported') {let state=createAppointmentDemo();state=act(state,'visit_type','first');state=act(state,'referral',referral);return act(state,'find_dates');}
function range(from,to,state=start()) {state=act(state,'preferred_mode','range');state=act(state,'preferred_month',from.slice(0,7));state=act(state,'preferred_date',from);state=act(state,'preferred_month',to.slice(0,7));return act(state,'preferred_date',to);}
test('날짜 우선: 하루로 찾은 해당 과의 의료진·시간만 선택하고 자동 예약하지 않는다',()=>{
 let s=start();assert.equal(s.screen,'availability');assert.equal(s.doctorId,null);assert.equal(s.month,'2026-11');
 s=act(s,'preferred_month','2026-12');s=act(s,'preferred_date','2026-12-08');
 assert.deepEqual(availableAppointments(s).map(v=>[v.doctor.id,v.time]),[['hanbit-kim','10:30'],['hanbit-kim','14:40']]);
 assert.equal(act(s,'slot','hanbit-kim|2026-12-08|11:20'),s);assert.equal(act(s,'slot','hanbit-lee|2026-12-01|13:30'),s);
 s=act(s,'slot','hanbit-kim|2026-12-08|14:40');assert.equal(appointmentSelection(s).valid,true);assert.equal(s.status,'draft');
});
test('기간 시작·끝 포함, 역순 선택·연도 이동·기간 재선택을 처리한다',()=>{
 let s=range('2026-12-01','2026-12-15');const items=availableAppointments(s);
 assert.equal(items.length,5);assert.deepEqual([...new Set(items.map(i=>i.doctor.id))],['hanbit-lee','hanbit-kim']);
 assert.ok(items.some(i=>i.date==='2026-12-01')&&items.some(i=>i.date==='2026-12-15'));
 const reverse=range('2026-12-15','2026-12-01');assert.equal(reverse.preferredFrom,'2026-12-01');assert.equal(reverse.preferredTo,'2026-12-15');
 s=range('2026-12-22','2027-01-12');assert.deepEqual(availableAppointments(s).map(i=>i.date),['2027-01-05','2027-01-12']);
 s=act(s,'preferred_date','2027-01-20');assert.equal(s.preferredTo,null);assert.deepEqual(availableAppointments(s),[]);
});
test('달력 탐색은 선택을 보존하고 날짜 조건 변경은 선택 슬롯·교통 체크를 해제한다',()=>{
 let s=range('2026-12-01','2026-12-15');s=act(s,'slot','hanbit-kim|2026-12-08|14:40');s=act(s,'travel_check','jeju_route');
 s=act(s,'preferred_month','2027-01');assert.equal(s.time,'14:40');assert.equal(s.travel.checks.length,1);
 s=act(s,'preferred_date','2027-01-05');assert.equal(s.time,null);assert.equal(s.doctorId,null);assert.equal(s.travel.checks.length,0);assert.equal(s.travel.recheck,true);
 assert.equal(act(s,'slot','hanbit-kim|2026-12-08|14:40'),s);
});
test('공개 마감과 미공개·지난 날짜를 구분하고 달력 밖 날짜를 거부한다',()=>{
 let s=start();assert.equal(availabilityDay(s,'2026-11-17'),'full');assert.equal(availabilityDay(s,'2026-11-18'),'unpublished');
 assert.equal(act(s,'preferred_date','2026-11-14'),s);assert.equal(act(s,'preferred_date','2026-12-08'),s);assert.equal(act(s,'preferred_month','2026-13'),s);
 assert.equal(nextMatchingDate(s),'2026-12-01');s=act(s,'next_match');assert.equal(s.preferredFrom,'2026-12-01');assert.equal(s.time,null);
});
test('기간 검색도 의뢰서 없는 확정을 허용하지 않고 돌아오면 날짜 조건을 보존한다',()=>{
 let s=range('2026-12-01','2026-12-15',start('missing'));s=act(s,'slot','hanbit-kim|2026-12-08|14:40');
 s=act(s,'review');assert.equal(s.requestMode,'slot');s=act(s,'request');assert.equal(s.status,'consultation_requested_demo');assert.equal(act(s,'reply','confirm'),s);
 s=act(s,'edit');assert.equal(s.screen,'availability');assert.equal(s.preferredFrom,'2026-12-01');assert.equal(s.time,null);
 assert.match(buildAppointmentReport(s,createDemoCase()),/검색한 희망 날짜: 2026-12-01 ~ 2026-12-15/);
});
test('항공권 링크는 선택 날짜·인원만 전달하고 귀가 미정이면 편도 검색한다',()=>{
 let s=range('2026-12-01','2026-12-15');s=act(s,'slot','hanbit-kim|2026-12-08|14:40');s=act(s,'flight_dates','previous');
 let f=flightSearch(s,'2026-11-16');assert.equal(f.outbound,'2026-12-07');assert.match(f.url,/cju\/gmp\/261207\//);assert.equal(new URL(f.url).searchParams.get('rtn'),'0');
 s=act(s,'flight_field',{field:'inbound',value:'2026-12-10'});s=act(s,'flight_field',{field:'adults',value:'2'});f=flightSearch(s,'2026-11-16');
 assert.match(f.url,/261207\/261210\//);assert.equal(new URL(f.url).searchParams.get('adults'),'2');assert.equal(new URL(f.url).searchParams.get('rtn'),'1');
 assert.deepEqual([...new URL(f.url).searchParams.keys()],['adults','cabinclass','rtn']);assert.ok(!/김|한빛|종양|patient|hospital/.test(f.url));
});
test('항공 검색의 잘못된 날짜·역순·다른 공항은 링크를 막고 전화는 번호만 허용한다',()=>{
 let s=start();assert.equal(flightSearch(s,'2026-11-16').url,null);assert.equal(validFlightDate('2026-02-30'),false);
 s=act(s,'flight_field',{field:'outbound',value:'2026-12-08'});s=act(s,'flight_field',{field:'inbound',value:'2026-12-07'});assert.equal(flightSearch(s,'2026-11-16').url,null);
 s=act(s,'flight_field',{field:'inbound',value:''});s=act(s,'travel_field',{field:'airport',value:'other'});assert.equal(flightSearch(s,'2026-11-16').url,null);
 assert.equal(act(s,'flight_field',{field:'outbound',value:'2026-13-02'}),s);assert.equal(act(s,'flight_field',{field:'__proto__',value:'x'}),s);
 assert.equal(bookingCallHref('1899-6884'),'tel:18996884');assert.equal(bookingCallHref('javascript:alert(1)'),null);
});

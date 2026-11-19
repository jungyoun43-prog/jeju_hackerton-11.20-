import test from 'node:test';
import assert from 'node:assert/strict';
import {createTravelPlan,updateTravel,assessTravel,travelChecklist} from '../app/appointment-travel.js';
import {createAppointmentDemo,reduceAppointmentDemo as reduce} from '../app/appointment-demo.js';
const field=(plan,field,value)=>updateTravel(plan,{type:'travel_field',value:{field,value}});
test('전날·숙박·휠체어 조건에 맞는 항목만 추가하고 체크는 실제 완료로 해석하지 않는다',()=>{
  let travel=createTravelPlan();assert.equal(travelChecklist(travel).length,9);
  travel=field(travel,'departure','previous');assert.ok(travelChecklist(travel).some(item=>item.id==='lodging'));
  assert.equal(travel.recheck,false,'처음 계획을 고르는 단계는 재확인 경고를 만들지 않음');
  assert.ok(travelChecklist(travel,true).some(item=>item.id==='assistance'));
  for(const item of travelChecklist(travel))travel=updateTravel(travel,{type:'travel_check',value:item.id});
  const result=assessTravel({travel});assert.equal(result.checked,result.total);assert.equal(result.complete,false);assert.ok(result.pending.length);
});
test('항공편·공항·진료 전후 순서 충돌은 입력한 한국 시각만으로 판별한다',()=>{
  let travel=createTravelPlan();
  for(const [key,value] of Object.entries({airportArrival:'2026-12-08T09:00',outDeparture:'2026-12-08T08:00',outArrival:'2026-12-08T09:10',hospitalArrival:'2026-12-08T11:00',examEnd:'2026-12-08T17:00',returnAirport:'2026-12-08T16:00',returnDeparture:'2026-12-08T15:00',returnArrival:'2026-12-08T14:00'}))travel=field(travel,key,value);
  const result=assessTravel({travel,date:'2026-12-08',time:'10:30'});
  assert.equal(result.issues.length,5);assert.ok(result.issues.some(text=>/희망 진료/.test(text)));
  assert.equal(result.complete,false);
});
test('미상 검사 종료를 귀가 가능으로 처리하지 않고 날짜·시각·경로 변경 시 체크를 해제한다',()=>{
  let state=createAppointmentDemo();
  for(const [type,value] of [['visit_type','first'],['referral','reported'],['doctor','hanbit-kim'],['next_available'],['time','10:30'],['travel_check','flight']])state=reduce(state,{type,value});
  assert.deepEqual(state.travel.checks,['flight']);
  const changed=reduce(state,{type:'time',value:'14:40'});assert.deepEqual(changed.travel.checks,[]);assert.equal(changed.travel.recheck,true);
  assert.ok(assessTravel(changed).pending.some(text=>/검사 종료 미정/.test(text)));
  const plan=field(state.travel,'airport','other');assert.deepEqual(plan.checks,[]);assert.equal(plan.recheck,true);
});
test('정의되지 않은 필드·날짜·확인 항목은 받아들이지 않는다',()=>{
  const plan=createTravelPlan();
  for(const [key,value] of [['airport','invalid'],['outArrival','2026-02-30T11:00'],['outArrival','2026-12-08T25:00'],['__proto__','x']])assert.equal(field(plan,key,value),plan);
  assert.equal(updateTravel(plan,{type:'travel_check',value:'reservationConfirmed'}),plan);
});

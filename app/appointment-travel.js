import { publicTimeLabel } from './jeju-appointment-data.js';
import { validFlightDate, flightSearch } from './appointment-booking-links.js';
/** 입력한 계획의 순서만 대조한다. 운항·좌석·경로 ETA·실제 예약은 조회하지 않는다. */
export const TRAVEL_SOURCES = [
  {id:'jeju',label:'제주 버스정보 · 노선과 운행시간표',url:'https://bus.jeju.go.kr/'},
  {id:'flight',label:'제주공항 · 항공편과 탑승 안내',url:'https://www.airport.co.kr/jeju/index.do'},
  {id:'seoul',label:'김포공항 · 버스·지하철·교통약자 안내',url:'https://www.airport.co.kr/gimpo/index.do'},
];
export const TRAVEL_OPTIONS = {
  departure:[['unknown','아직 미정'],['previous','진료 전날 이동'],['same','진료 당일 이동']],
  airport:[['gmp','김포공항'],['other','다른 공항 · 경로 확인 필요']],
  jejuMode:[['unknown','아직 미정'],['bus','버스'],['taxi','택시'],['accessible','교통약자 차량'],['family','가족 차량']],
  seoulMode:[['unknown','아직 미정'],['transit','지하철·버스'],['taxi','택시'],['accessible','교통약자 차량'],['family','가족 차량']],
  returnPlan:[['unknown','검사 일정 확인 후 결정'],['same','당일 귀가 희망'],['overnight','숙박 또는 다른 날 귀가']],
};
export const TRAVEL_TIMES = {
  homeDeparture:'집에서 출발 계획',returnHome:'집 도착 계획',
  airportArrival:'제주공항 도착 계획',outDeparture:'제주 출발 항공편',outArrival:'도외 공항 도착 항공편',
  hospitalArrival:'병원 도착 계획',examEnd:'진료·검사 종료 계획',returnAirport:'귀가 공항 도착 계획',
  returnDeparture:'제주행 출발 항공편',returnArrival:'제주 도착 항공편',
};
export function createTravelPlan(region='seoul') {
  return {region,departure:'unknown',airport:'gmp',jejuMode:'unknown',seoulMode:'unknown',returnPlan:'unknown',times:{},checks:[],flightSearch:{},recheck:false};
}
export function invalidateTravel(plan) {
  if(!plan)return createTravelPlan();
  const touched=plan.checks.length || Object.keys(plan.times).length;
  return {...plan,checks:[],recheck:plan.recheck || Boolean(touched)};
}
export function travelChecklist(plan,wheelchair=false) {
  if(plan.region==='jeju')return [
    {id:'jeju_route',leg:'jeju',label:plan.jejuMode==='bus'?'병원행 정류장·노선·환승·첫차 확인할 내용 정리':'집과 병원 주소·픽업 시각·승하차 위치 확인할 내용 정리'},
    {id:'hospital',leg:'jeju',label:'접수·검사와 병원 도착 시각 문의 정리'},
    {id:'tests',leg:'return',label:'진료·검사 종료와 추가 방문 여부 문의 정리'},
    {id:'return_route',leg:'return',label:'귀가 차량·막차·진료 지연 시 대안 확인할 내용 정리'},
    ...(wheelchair||plan.jejuMode==='accessible'?[{id:'assistance',leg:'jeju',label:'이용자격·등록·휠체어 탑승·승하차 지원·동행인 문의 정리'}]:[]),
  ];
  return [
    {id:'jeju_route',leg:'jeju',label:plan.jejuMode==='bus'?'출발 정류장·노선·환승·첫차와 막차를 확인할 내용 정리':'출발지·공항 운행 범위·차량과 픽업 시각 확인할 내용 정리'},
    {id:'jeju_margin',leg:'jeju',label:'공항 도착 여유·보행 거리·동행인과 짐 확인할 내용 정리'},
    {id:'flight',leg:'flight',label:'왕복 편명·운항일·좌석·요금·변경 조건 확인할 내용 정리'},
    {id:'cutoff',leg:'flight',label:'항공사별 수속·수하물·탑승 마감 확인할 내용 정리'},
    {id:'seoul_route',leg:'seoul',label:'도착 공항에서 병원까지 경로·환승·소요시간 확인할 내용 정리'},
    {id:'hospital',leg:'seoul',label:'초진 접수·영상 등록·진료 전 검사와 도착 시각 문의 정리'},
    {id:'tests',leg:'return',label:'당일 검사 종료 예상과 별도 검사일 문의 정리'},
    {id:'return_route',leg:'return',label:'병원→공항·제주공항→집의 막차와 대체 이동 확인할 내용 정리'},
    {id:'disruption',leg:'return',label:'진료 지연·항공편 지연/결항 시 숙박·변경·귀가 대안 정리'},
    ...(plan.departure==='previous'||plan.returnPlan==='overnight'?[{id:'lodging',leg:'return',label:'숙박 위치·보호자 동행·병원 이동 확인할 내용 정리'}]:[]),
    ...(wheelchair||plan.jejuMode==='accessible'||plan.seoulMode==='accessible'?[{id:'assistance',leg:'flight',label:'휠체어 종류·배터리·승하차·항공사 지원과 공항 이동 문의 정리'}]:[]),
  ];
}
const validTime=value=>typeof value==='string' && /^202[67]-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) && !Number.isNaN(Date.parse(value+'+09:00')) && new Date(Date.parse(value+'+09:00')+9*3600000).toISOString().slice(0,16)===value;
export function updateTravel(plan,action,wheelchair=false) {
  if(plan.region==='jeju' && (String(action.type).startsWith('flight_') || (action.type==='travel_field' && !['jejuMode','returnPlan','homeDeparture','hospitalArrival','examEnd','returnHome'].includes(action.value?.field))))return plan;
  if(action.type==='flight_field') {
    const {field,value}=action.value || {};
    if(!(['outbound','inbound'].includes(field) && (value===''||validFlightDate(value))) && !(field==='adults'&&['1','2','3','4'].includes(value)))return plan;
    if(plan.flightSearch?.[field]===value)return plan;
    return {...invalidateTravel(plan),flightSearch:{...plan.flightSearch,[field]:value}};
  }
  if(action.type==='flight_dates' && validFlightDate(action.date) && ['previous','same'].includes(action.value)){
    const flightSearch={...plan.flightSearch};
    delete flightSearch.outbound;
    return {...invalidateTravel(plan),departure:action.value,flightSearch};
  }
  if(action.type==='travel_field') {
    const {field,value}=action.value || {};
    if(field==='departure' && TRAVEL_OPTIONS.departure.some(([id])=>id===value)){
      const flightSearch={...plan.flightSearch};
      delete flightSearch.outbound;
      return {...invalidateTravel(plan),departure:value,flightSearch};
    }
    if(Object.hasOwn(TRAVEL_OPTIONS,field) && TRAVEL_OPTIONS[field].some(([id])=>id===value))return plan[field]===value?plan:{...invalidateTravel(plan),[field]:value};
    if(Object.hasOwn(TRAVEL_TIMES,field) && (value==='' || validTime(value))) {
      if((plan.times[field] || '')===value)return plan;
      const times={...plan.times};if(value)times[field]=value;else delete times[field];
      return {...invalidateTravel(plan),times};
    }
  }
  if(action.type==='travel_check' && travelChecklist(plan,wheelchair).some(item=>item.id===action.value)) {
    return {...plan,checks:plan.checks.includes(action.value)?plan.checks.filter(id=>id!==action.value):[...plan.checks,action.value]};
  }
  return plan;
}
export function assessTravel(state,wheelchair=false) {
  // 희망 하루·정확한 시각만 계획 순서에 대조하며 가상 체험의 시각은 가져오지 않는다.
  if(state.usePublicData)state={...state,date:state.jejuHospital?.from===state.jejuHospital?.to?state.jejuHospital?.from:null,time:state.jejuHospital?.timeOfDay==='specific'?state.jejuHospital.time:null};
  const plan=state.travel || createTravelPlan(),t=plan.times,issues=[];
  const after=(a,b,label)=>{if(a && b && a>=b)issues.push(label);};
  if(plan.region==='jeju') {
    after(t.homeDeparture,t.hospitalArrival,'출발과 병원 도착 시각의 순서를 확인해 주세요.');
    after(t.hospitalArrival,state.date && state.time?`${state.date}T${state.time}`:null,'병원 도착 계획이 희망 진료 시각보다 늦거나 같아요. 접수 시간을 포함해 조정해 주세요.');
    after(state.date && state.time?`${state.date}T${state.time}`:null,t.examEnd,'진료·검사 종료 계획이 희망 진료 시각보다 빠르거나 같아요.');
    after(t.examEnd,t.returnHome,'진료·검사 종료와 집 도착 시각의 순서를 확인해 주세요.');
    const items=travelChecklist(plan,wheelchair),pending=['병원 접수·검사 일정과 실제 차량·버스 운행은 확인 필요'];
    if(state.usePublicData && state.jejuHospital?.from)pending.unshift(`${publicTimeLabel(state.jejuHospital)} · 실제 진료 시각은 병원 확인 후 이동 계획과 대조`);
    else if(!state.date || !state.time)pending.unshift('희망 진료 시각 미선택 · 이동 시각 대조 전');
    if(!t.examEnd)pending.push('검사 종료 미정 · 귀가 시각은 병원 안내 후 조율');
    return {issues,pending,items,checked:items.filter(item=>plan.checks.includes(item.id)).length,total:items.length,complete:false};
  }
  after(t.airportArrival,t.outDeparture,'제주공항 도착 계획이 항공편 출발보다 늦거나 같아요.');
  after(t.outDeparture,t.outArrival,'가는 항공편의 출발·도착 순서를 확인해 주세요.');
  after(t.outArrival,t.hospitalArrival,'공항 도착 이후의 병원 이동 시간이 잡히지 않았어요.');
  after(t.hospitalArrival,state.date && state.time?`${state.date}T${state.time}`:null,'병원 도착 계획이 희망 진료 시각보다 늦거나 같아요. 전날 이동·다른 항공편을 검토해 주세요.');
  after(t.examEnd,t.returnAirport,'진료·검사 종료와 귀가 공항 이동 순서를 확인해 주세요.');
  after(t.returnAirport,t.returnDeparture,'귀가 공항 도착 계획이 제주행 출발보다 늦거나 같아요.');
  after(t.returnDeparture,t.returnArrival,'오는 항공편의 출발·도착 순서를 확인해 주세요.');
  if(state.date && t.outDeparture && ((plan.departure==='previous' && t.outDeparture.slice(0,10)>=state.date)||(plan.departure==='same' && t.outDeparture.slice(0,10)!==state.date)))issues.push('선택한 이동일 조건과 가는 항공편 날짜가 달라요.');
  const items=travelChecklist(plan,wheelchair),checked=items.filter(item=>plan.checks.includes(item.id)).length;
  const pending=['항공편·좌석·운임과 실제 교통 운행은 미조회', '병원 접수·검사 일정과 항공사 마감 시각은 기관 확인 필요'];
  if(!state.date || !state.time)pending.unshift('희망 진료 시각 미선택 · 이동 시각 대조 전');
  if(!t.examEnd)pending.push('검사 종료 미정 · 귀가 항공편 확정 전 병원에 확인');
  if(plan.airport==='other')pending.push('선택한 도착 공항과 제주 노선·병원 접근 경로를 별도로 확인');
  return {issues,pending,items,checked,total:items.length,complete:false};
}
export function travelReport(state,wheelchair=false) {
  const plan=state.travel || createTravelPlan(),summary=assessTravel(state,wheelchair),flight=flightSearch(state);
  if(plan.region==='jeju')return [
    '## 제주 병원 왕복 이동',
    `- 이동 수단: ${TRAVEL_OPTIONS.jejuMode.find(([id])=>id===plan.jejuMode)?.[1] || '미정'}`,
    ...['homeDeparture','hospitalArrival','examEnd','returnHome'].map(key=>`- ${TRAVEL_TIMES[key]}: ${plan.times[key] || '미정'} (한국 시각, 입력한 계획)`),
    `- 문의 내용 정리: ${summary.checked}/${summary.total}. 체크는 실제 확인·예약 완료가 아닙니다.`,
    ...(plan.recheck?['- 조건 변경 후 이동 항목 재점검 필요']:[]),
    ...summary.issues.map(text=>`- 일정 충돌: ${text}`),...summary.pending.map(text=>`- 미확인: ${text}`),
    ...summary.items.map(item=>`- [${plan.checks.includes(item.id)?'x':' '}] ${item.label}`),
    `- 공식 확인 창구: ${TRAVEL_SOURCES[0].label} ${TRAVEL_SOURCES[0].url}`,
  ];
  return [
    '## 항공·공항 교통 준비',
    `- 항공권 검색 조건: 제주–김포, 가는 날 ${flight.outbound || '미선택'}, 오는 날 ${flight.inbound || '미정 (편도 검색)'}, 성인 ${flight.adults}명. 가격·좌석은 외부 사이트에서 확인하며 예약 결과를 수신하지 않습니다.`,
    ...(flight.url?[`- 항공권 가격 비교: ${flight.url}`]:flight.issues.map(issue=>`- 항공권 검색 확인: ${issue}`)),
    ...Object.entries(TRAVEL_OPTIONS).map(([key,values])=>`- ${({departure:'이동일',airport:'도착 공항',jejuMode:'제주 공항행',seoulMode:'도외 병원행',returnPlan:'귀가'})[key]}: ${values.find(([id])=>id===plan[key])?.[1] || '미정'}`),
    ...Object.entries(TRAVEL_TIMES).filter(([key])=>!['homeDeparture','returnHome'].includes(key)).map(([key,label])=>`- ${label}: ${plan.times[key] || '미정'} (한국 시각, 입력한 계획)`),
    `- 문의 내용 정리: ${summary.checked}/${summary.total}. 체크는 실제 확인·예약 완료가 아닙니다.`,
    ...(plan.recheck?['- 조건 변경 후 이동 항목 재점검 필요']:[]),
    ...summary.issues.map(text=>`- 일정 충돌: ${text}`),...summary.pending.map(text=>`- 미확인: ${text}`),
    ...summary.items.map(item=>`- [${plan.checks.includes(item.id)?'x':' '}] ${item.label}`),
    ...TRAVEL_SOURCES.map(source=>`- 공식 확인 창구: ${source.label} ${source.url}`),
  ];
}

import hospitals from './data/hospital-candidates.json' with {type:'json'};
import support from './data/visit-support-providers.json' with {type:'json'};
import health from './data/public-health-contacts.json' with {type:'json'};
import {filterHospitals} from './hospitals.js';
import {getSupportCandidates,getSupportInquiryCandidates} from './support-data.js';
import {getPublicHealthContacts} from './public-health-data.js';

export const JEJU_DATA_SOURCES=[
  {id:'859',name:'병·의원 등록정보',url:hospitals.sourceUrl,hubUrl:hospitals.sourceUrl,count:hospitals.records.length,scope:`공개 ${hospitals.totalPreviewRows}행 중 당시 정상 등록 ${hospitals.records.length}곳 · 폐업 ${hospitals.excludedClosedRows}행 제외`,asOf:hospitals.time.collectedAt[0].slice(0,10),dateLabel:'원자료 수집일'},
  ...support.datasets.map(d=>({id:d.id,name:d.id==='327'?'콜택시 업체':'돌봄 등록 문의처',url:d.sourceUrl,hubUrl:d.hubUrl,count:d.rowCount,scope:d.id==='327'?'허브에 연결된 원출처 CSV':'과거 공개 미리보기',asOf:d.asOf,dateLabel:'자료 기준일'})),
  {id:'1304',name:'공공보건 문의처',url:health.dataset.sourceUrl,hubUrl:health.dataset.hubUrl,count:health.records.length,scope:'제주시 관할·소재지 등록정보',asOf:health.dataset.asOf,dateLabel:'자료 기준일'},
];
const towns=[...hospitals.records.map(r=>r.address),...health.records.map(r=>r.address),...support.providers.map(r=>`${r.region} ${r.address}`)].map(value=>value.match(/(제주시|서귀포시)\s+([가-힣0-9]+[읍면동])/)).filter(Boolean).map(match=>`${match[1]} ${match[2]}`);
export const JEJU_DATA_AREAS=[...new Set(['제주시','서귀포시','제주시 애월읍','제주시 조천읍','제주시 한림읍','제주시 한경면','제주시 구좌읍','서귀포시 대정읍','서귀포시 성산읍','서귀포시 남원읍','서귀포시 안덕면','서귀포시 표선면',...towns])].sort((a,b)=>a.localeCompare(b,'ko'));
export const JEJU_REGISTERED_DEPARTMENTS=[...new Set(hospitals.records.flatMap(r=>r.departments))].sort((a,b)=>a.localeCompare(b,'ko'));
export const JEJU_WISH_TIMES={unknown:'시간대 미선택',any:'시간대 무관',morning:'오전 희망',afternoon:'오후 희망',specific:'시각 직접 지정'};
const validTime=value=>typeof value==='string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
export const publicTimeLabel=plan=>plan.timeOfDay==='specific'?`${plan.time || '시각 미선택'} 희망`:JEJU_WISH_TIMES[plan.timeOfDay];
export const publicDoctorLabel=plan=>plan.doctorMode==='named'?`${plan.doctorName.trim() || '이름 미입력'} · 희망 의료진`:'의료진 무관';
export const koreanToday=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const validDate=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
const normalizeArea=area=>JEJU_DATA_AREAS.includes(area)?area:typeof area==='string'&&area.includes('서귀포')?'서귀포시':'제주시';
export function createJejuHospitalPlan(area='',today=koreanToday()) {
  return {area:normalizeArea(area).split(' ')[0],department:'',hospitalId:null,visitDepartment:'',today,month:today.slice(0,7),dateMode:'single',from:null,to:null,timeOfDay:'any',time:'',doctorMode:'any',doctorName:'',preferencesOpen:false,prepared:false};
}
export const publicHospital=state=>hospitals.records.find(r=>r.id===state?.jejuHospital?.hospitalId) || null;
export const publicHospitalCandidates=plan=>filterHospitals(hospitals.records,{area:plan.area,department:plan.department});
export const publicHospitalReady=plan=>Boolean(hospitals.records.find(r=>r.id===plan?.hospitalId)?.departments.includes(plan.visitDepartment));
export const publicWishReady=plan=>Boolean(publicHospitalReady(plan) && validDate(plan.from) && validDate(plan.to) && plan.from>=plan.today && plan.to>=plan.from && (plan.doctorMode==='any' || (plan.doctorMode==='named' && plan.doctorName.trim())) && Object.hasOwn(JEJU_WISH_TIMES,plan.timeOfDay) && plan.timeOfDay!=='unknown' && (plan.timeOfDay!=='specific' || validTime(plan.time)));
export function publicMonthLimit(plan) {return `${Number(plan.today.slice(0,4))+1}${plan.today.slice(4,7)}`;}
export function reduceJejuHospitalPlan(plan,action) {
  const value=action.value;
  switch(action.type) {
    case 'public_clear': {
      const patches={hospital:{hospitalId:null,visitDepartment:'',doctorMode:'any',doctorName:''},department:{visitDepartment:'',department:'',doctorMode:'any',doctorName:''},date:{from:null,to:null,timeOfDay:'unknown',time:''},time:{timeOfDay:'unknown',time:''}};
      return Object.hasOwn(patches,value)?{...plan,...patches[value],preferencesOpen:false,prepared:false}:plan;
    }
    case 'public_area':return (value==='' || JEJU_DATA_AREAS.includes(value)) && value!==plan.area?{...plan,area:value,hospitalId:null,visitDepartment:'',prepared:false}:plan;
    case 'public_department':return (value==='' || JEJU_REGISTERED_DEPARTMENTS.includes(value)) && value!==plan.department?{...plan,department:value,hospitalId:null,visitDepartment:'',prepared:false}:plan;
    case 'public_hospital': {
      const h=publicHospitalCandidates(plan).find(r=>r.id===value);
      if(!h || h.id===plan.hospitalId)return plan;
      return {...plan,hospitalId:value,visitDepartment:h.departments.includes(plan.department)?plan.department:h.departments.length===1?h.departments[0]:'',doctorMode:'any',doctorName:'',preferencesOpen:false,prepared:false};
    }
    case 'public_visit_department':return hospitals.records.find(r=>r.id===plan.hospitalId)?.departments.includes(value)?{...plan,visitDepartment:value,doctorMode:'any',doctorName:'',preferencesOpen:false,prepared:false}:plan;
    case 'public_date_mode':return ['single','range'].includes(value) && value!==plan.dateMode?{...plan,dateMode:value,to:value==='single'?plan.from:null,prepared:false}:plan;
    case 'public_month':return typeof value==='string' && /^\d{4}-\d{2}$/.test(value) && validDate(value+'-01') && value>=plan.today.slice(0,7) && value<=publicMonthLimit(plan)?{...plan,month:value}:plan;
    case 'public_date': {
      if(!validDate(value)||value<plan.today||value.slice(0,7)!==plan.month||value.slice(0,7)>publicMonthLimit(plan))return plan;
      const start=plan.dateMode==='single'||!plan.from||plan.to;
      const [from,to]=start?[value,plan.dateMode==='single'?value:null]:[plan.from,value].sort();
      return {...plan,from,to,prepared:false};
    }
    case 'public_show_preferences':return {...plan,preferencesOpen:true};
    case 'public_time':return Object.hasOwn(JEJU_WISH_TIMES,value)?{...plan,timeOfDay:value,preferencesOpen:true,prepared:false}:plan;
    case 'public_exact_time':return value==='' || validTime(value)?{...plan,time:value,preferencesOpen:true,prepared:false}:plan;
    case 'public_doctor_mode':return ['any','named'].includes(value)?{...plan,doctorMode:value,preferencesOpen:true,prepared:false}:plan;
    case 'public_doctor_name':return typeof value==='string' && value.length<=40 && !/[\r\n\x00-\x1f]/.test(value)?{...plan,doctorName:value,prepared:false}:plan;
    case 'public_prepare':return publicWishReady(plan)?{...plan,prepared:true}:plan;
    default:return plan;
  }
}
export function createJejuSupportPlan(area='') {return {area:normalizeArea(area),wheelchair:null,taxiId:null,companionId:null,healthId:null};}
export function taxiInquiryContacts(area,wheelchair) {
  const candidates=getSupportInquiryCandidates(support,{kind:'taxi',area,wheelchair});
  return candidates.filter(row=>wheelchair||
    row.serviceType!=='accessible_transport'&&['local','city'].includes(row.matchLevel)).slice(0,2);
}
export function jejuSupportEvidence(state,caseState={}) {
  const plan=state.jejuSupport || createJejuSupportPlan(caseState.patient?.area),wheelchair=plan.wheelchair ?? Boolean(caseState.visitSupport?.requirements?.wheelchair || state.travel?.jejuMode==='accessible');
  const taxi=getSupportCandidates(support,{kind:'taxi',area:plan.area,wheelchair});
  const companion=getSupportCandidates(support,{kind:'companion',area:plan.area,wheelchair});
  const contacts=getPublicHealthContacts(health,plan.area).map(r=>({...r,source:{datasetId:'1304',url:health.dataset.sourceUrl,hubUrl:health.dataset.hubUrl,asOf:health.dataset.asOf},matchLabel:r.matchLabel}));
  return {area:plan.area,wheelchair,taxi,companion,health:contacts,selected:{taxi:taxi.find(r=>r.id===plan.taxiId)||null,companion:companion.find(r=>r.id===plan.companionId)||null,health:contacts.find(r=>r.id===plan.healthId)||null}};
}
export function reduceJejuSupportPlan(state,action,caseState={}) {
  const plan=state.jejuSupport || createJejuSupportPlan(caseState.patient?.area);
  if(action.type==='jeju_support_area')return JEJU_DATA_AREAS.includes(action.value) && action.value!==plan.area?{...createJejuSupportPlan(action.value),wheelchair:plan.wheelchair}:plan;
  if(action.type==='jeju_support_wheelchair')return typeof action.value==='boolean'||action.value===null?{...plan,wheelchair:action.value,taxiId:null}:plan;
  if(action.type!=='jeju_support_pick')return plan;
  const {kind,id}=action.value||{};
  if(!['taxi','companion','health'].includes(kind))return plan;
  if(id===null)return {...plan,[`${kind}Id`]:null};
  return jejuSupportEvidence(state,caseState)[kind].some(r=>r.id===id)?{...plan,[`${kind}Id`]:id}:plan;
}
export function jejuDataSourceReport(state,caseState) {
  const evidence=jejuSupportEvidence(state,caseState);
  return ['## 제주 공개자료로 고른 문의처',`- 문의 지역: ${evidence.area}. 원래 사례의 주소를 바꾸거나 현재 운행·담당을 확인한 결과는 아닙니다.`,`- 휠체어 이동지원 우선 조회: ${evidence.wheelchair?'사용':'사용 안 함'}. 조회 조건이며 이용자격·차량 가능을 확인한 뜻이 아닙니다.`,
    ...Object.entries(evidence.selected).map(([kind,r])=>r?`- ${{taxi:'차량',companion:'동행·돌봄',health:'공공보건'}[kind]}: ${r.name} · ${r.phone || '전화 미수록'} · ${r.matchLabel}\n  - 출처: ${r.source.url} · 기준일 ${r.source.asOf || '미표시 (공식 안내)'} · 실제 제공·예약 미확인`:`- ${{taxi:'차량',companion:'동행·돌봄',health:'공공보건'}[kind]} 문의처: 미선택`),
    '## 활용 데이터와 범위',...JEJU_DATA_SOURCES.map(s=>`- 허브 ${s.id} ${s.name}: ${s.scope}; ${s.dateLabel} ${s.asOf}. ${s.hubUrl}${s.url!==s.hubUrl?` → ${s.url}`:''}`),
    '- 병원 13곳은 제주 전체 기관 목록이 아닌 과거 공개 표본입니다. 빈 결과는 해당 지역의 기관·서비스 부재가 아닙니다.',
    '- 돌봄 등록은 병원동행 가능을 뜻하지 않습니다. 공공보건 연락처는 등록 관할 문의용이며 예약 창구의 대체가 아닙니다.',
    '- 센터의 도로·이동시간 데이터는 명세만 확인했으며 원자료 미접근으로 거리 순위·ETA·항공/차량 가용성을 계산하지 않았습니다.',
  ];
}
export function buildPublicHospitalReport(state,caseState) {
  const h=publicHospital(state),plan=state.jejuHospital;
  return ['# 제주 병원 문의 준비표',
    '기관명·주소·등록 과목은 공개자료입니다. 희망 일정은 사용자 선택이며 실제 의료진·빈자리 조회·예약·전화·전송을 수행하지 않았습니다.',
    `- 병원: ${h?.companyName || '미선택'}`,`- 등록 주소: ${h?.address || '미수록'}`,`- 등록 진료과: ${h?.departments.join(', ') || '미수록'}`,
    `- 찾은 조건: ${plan.area || '제주 전체'} / ${plan.department || '등록 진료과 전체'}`,
    `- 선택 진료과: ${plan.visitDepartment || '미선택'}`,
    `- 희망 의료진: ${publicDoctorLabel(plan)} · 병원 소속·진료 가능 여부 미확인`,
    `- 희망 날짜: ${plan.from || '미선택'}${plan.to && plan.to!==plan.from?` ~ ${plan.to}`:''} · ${publicTimeLabel(plan)} · 사용자 희망이며 실제 빈자리 미확인`,
    `- 상태: ${plan.prepared?'문의 내용 정리됨':'문의 내용 준비 중'} · 예약 미확정`,
    ...(h?[`- 병원 출처: ${h.source.url} · 원자료 수집 ${h.collectedAt} · 해당 행 갱신 ${h.updatedAt} · 저장본 취득 ${h.source.retrievedAt}`]:[]),
    '## 병원에 물어볼 내용','- 현재 운영 여부, 해당 진료과의 외래 접수와 의료진·시간, 초진/재진 절차를 확인합니다.','- 희망 날짜와 시간대, 필요한 서류·의뢰서, 검사와 도착 시간을 확인합니다.','- 공개 병원 표본에는 전화번호·실시간 시간표가 없습니다. 기관 공식 창구를 별도로 확인해야 합니다.',
    ...jejuDataSourceReport(state,caseState),
  ];
}

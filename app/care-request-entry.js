import {reduceAppointmentDemo,regionHospitals,APPOINTMENT_MONTHS,REFERRAL_LABELS} from './appointment-demo.js';
import {requestClocks} from './care-request-times.js';
import {APPOINTMENT_DEPARTMENTS} from './appointment-departments.js';
import {reduceCoordination} from './care-coordination.js';
import {publicHospitalCandidates,publicHospital,publicHospitalReady,publicWishReady,JEJU_DATA_AREAS,koreanToday,publicTimeLabel} from './jeju-appointment-data.js';

const unique=values=>[...new Set(values)];
const validDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const key=(year,month,day)=>`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
function mentions(text,values) {
  // 부정·비교·복수 후보는 임의로 선택하지 않는다. 증상에서 진료과를 추론하지 않는다.
  return values.filter(value=>{
    const at=text.indexOf(value);if(at<0)return false;
    return !/^(?:은|는|이|가|을|를)?\s*(?:말고|아니|제외|취소|싫|안\s)/.test(text.slice(at+value.length,at+value.length+14));
  }).filter(value=>!values.some(other=>other!==value&&other.includes(value)&&text.includes(other)));
}
export function parseCareRequest(text,{region='jeju',today=koreanToday()}={}) {
  text=String(text||'').trim();
  const notices=[],hospitals=region==='jeju'?publicHospitalCandidates({area:'',department:''}).map(h=>({id:h.id,name:h.companyName})):regionHospitals(region);
  // 음성 전사·요약의 띄어쓰기 차이만 공개 기관의 정확한 이름으로 정규화한다.
  for(const {name} of hospitals){const pattern=[...name.replace(/\s/g,'')].map(c=>c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');text=text.replace(new RegExp(pattern,'g'),name);}
  const hospitalNames=mentions(text,hospitals.map(h=>h.name)),departmentNames=mentions(text,APPOINTMENT_DEPARTMENTS.map(d=>d.name));
  if(hospitalNames.length>1)notices.push('병원이 여러 곳 나와요. 이번에 준비할 병원을 선택해 주세요.');
  if(departmentNames.length>1)notices.push('진료과가 여러 개 나와요. 이번에 갈 과를 선택해 주세요.');
  const clear=[];
  const negated=values=>values.some(value=>text.includes(value)&&!mentions(text,[value]).length);
  const unknown='(?:미정|미확인|모르|취소|아직\\s*안\\s*정|정하지\\s*않)';
  const isUnknown=field=>new RegExp(`${field}(?:은|는|이|가|:)?\\s*(?:아직\\s*)?${unknown}`).test(text);
  if(hospitalNames.length>1||negated(hospitals.map(h=>h.name))||isUnknown('병원'))clear.push('hospital');
  if(departmentNames.length>1||negated(APPOINTMENT_DEPARTMENTS.map(d=>d.name))||isUnknown('진료과'))clear.push('department');
  if(isUnknown('(?:날짜|일정)'))clear.push('date');
  if(isUnknown('시간(?:대)?'))clear.push('time');
  const result={hospitalId:hospitalNames.length===1?hospitals.find(h=>h.name===hospitalNames[0]).id:null,department:departmentNames.length===1?departmentNames[0]:null,from:null,to:null,timeOfDay:null,time:null,area:null,wheelchair:null,clear,notices};
  const year=Number(today.slice(0,4));
  const dates=[...text.matchAll(/(20\d{2})-(\d{2})-(\d{2})/g)].map(m=>m[0]);
  if(!dates.length) {
    const range=text.match(/(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일?\s*(?:~|부터|에서|–|-)\s*(?:(\d{1,2})\s*월\s*)?(\d{1,2})\s*일/);
    if(range)dates.push(key(Number(range[1]||year),range[2],range[3]),key(Number(range[1]||year),range[4]||range[2],range[5]));
    else for(const m of text.matchAll(/(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월\s*(\d{1,2})\s*일/g))dates.push(key(Number(m[1]||year),m[2],m[3]));
  }
  const requested=unique(dates);
  const isRange=/(?:DATE|\d{1,2}\s*일?)\s*(?:~|부터|에서|–|-)\s*(?:DATE|\d{1,2})/.test(text.replace(/20\d{2}-\d{2}-\d{2}/g,'DATE'));
  const dateNegated=/(?:\d일|\d{4}-\d{2}-\d{2})\s*(?:은|는|을|를)?\s*(?:말고|아니|제외|취소)/.test(text);
  if(dateNegated&&!clear.includes('date'))clear.push('date');
  if(requested.length&&(!requested.every(validDate)||requested.some(d=>d<today)||clear.includes('date')||requested.length>2||(requested.length===2&&!isRange)||requested[1]<requested[0])){
    if(!clear.includes('date'))clear.push('date');
    notices.push('날짜를 하나로 정하지 않았어요. 달력에서 희망 날짜나 기간을 확인해 주세요.');
  }
  else if(requested.length){result.from=requested[0];result.to=requested.at(-1);}
  else if(/다음\s*주|이번\s*주|다음\s*달|내일|모레/.test(text))notices.push('상대 날짜는 달력에서 정확한 날짜로 선택해 주세요.');
  const clocks=requestClocks(text);
  if(clocks.visitUnclear){
    clear.push('time');
    notices.push('진료 시각을 하나로 정하기 어려워요. 의료진·시간에서 골라 주세요.');
  } else if(clocks.visit&&!clear.includes('time')){
    result.timeOfDay=clocks.visit.includes(':')?'specific':clocks.visit;
    if(result.timeOfDay==='specific')result.time=clocks.visit;
  }
  if(clocks.pickup)result.pickupTime=clocks.pickup;
  if(clocks.pickupUnclear){
    result.pickupTime='';
    notices.push('차량 출발 시각은 이동 조건에서 확인해 주세요.');
  }
  const referralClause=text.match(/의뢰서[^.\n,;!?]{0,30}/)?.[0];
  if(referralClause){
    if(/모르|있는지|없을|미확인|미정|여부/.test(referralClause))result.referral='unknown';
    else if(/없|미준비|준비\s*못|받지\s*않|못\s*받/.test(referralClause))result.referral='missing';
    else if(/있|가지고|보유|준비했|받았/.test(referralClause))result.referral='reported';
  }
  const areas=unique(JEJU_DATA_AREAS.filter(a=>text.includes(a)||a.includes(' ')&&text.includes(a.split(' ')[1])));
  const towns=areas.filter(a=>a.includes(' '));if(towns.length===1)result.area=towns[0];else if(!towns.length&&areas.length===1)result.area=areas[0];
  const wheelchair=text.match(/휠체어[^.\n,]{0,40}/g)?.at(-1);
  if(wheelchair){
    if(/[?？]|모르|필요한지|미확인|미정|여부|취소/.test(wheelchair))clear.push('wheelchair');
    else if(/안\s*써|안\s*이용|사용하지|필요\s*없|불필요|필요하지\s*않/.test(wheelchair))result.wheelchair=false;
    else if(/필요|사용|이용|타고|지원.*(?:원해|구해|알아)/.test(wheelchair))result.wheelchair=true;
  }
  // Only explicit support requests override the visible defaults. Questions stay unset.
  for(const [field,word] of [['companion','동행'],['taxi','택시']]) {
    const clause=text.match(new RegExp(`${word}[^.\\n,]{0,28}`,'g'))?.at(-1);
    if(!clause||/[?？]|모르|필요한지|미확인|미정|여부/.test(clause))continue;
    if(/필요\s*없|불필요|필요하지\s*않|이용하지\s*않|취소/.test(clause))result[field]=false;
    else if(/필요|원해|예약|구해|알아/.test(clause))result[field]=true;
  }
  if(region==='seoul'&&!result.hospitalId)notices.push('내륙 병원은 현재 가상 시간표 체험이에요. 원문의 실제 병원을 가상 병원으로 바꾸지 않았습니다.');
  return result;
}

export function applyCareRequest(state,text,{today=state.jejuHospital?.today||koreanToday()}={}) {
  const parsed=parseCareRequest(text,{region:state.region,today}),fields={...state.quickEntry?.fields};
  let next=state;
  const apply=(type,value)=>{next=reduceAppointmentDemo(next,{type,value});};
  for(const field of parsed.clear){
    if(field==='wheelchair')apply('jeju_support_wheelchair',null);
    else apply(state.usePublicData?'public_clear':'request_clear',field);
    delete fields[field];
    if(field==='hospital')delete fields.department;
    if(field==='date')delete fields.time;
  }
  if(state.usePublicData){
    if(parsed.hospitalId){apply('public_area','');apply('public_department','');apply('public_hospital',parsed.hospitalId);fields.hospital=Boolean(publicHospital(next));}
    if(parsed.department){if(publicHospital(next))apply('public_visit_department',parsed.department);else apply('public_department',parsed.department);fields.department=next.jejuHospital.visitDepartment===parsed.department;}
    if(parsed.from){apply('public_date_mode','single');apply('public_month',parsed.from.slice(0,7));apply('public_date',parsed.from);if(parsed.to!==parsed.from){apply('public_date_mode','range');apply('public_month',parsed.to.slice(0,7));apply('public_date',parsed.to);}fields.date=next.jejuHospital.from===parsed.from&&next.jejuHospital.to===parsed.to;}
    if(parsed.timeOfDay){apply('public_time',parsed.timeOfDay);if(parsed.time)apply('public_exact_time',parsed.time);fields.time=true;}
    else if(parsed.from&&!fields.time&&!state.jejuHospital.preferencesOpen&&!state.jejuHospital.prepared){
      apply('public_clear','time');
    }
  } else {
    if(parsed.hospitalId){apply('hospital',parsed.hospitalId);fields.hospital=true;}
    if(parsed.department){apply('department',parsed.department);fields.department=next.department===parsed.department;}
    if(parsed.from&&[parsed.from,parsed.to].every(d=>APPOINTMENT_MONTHS.includes(d.slice(0,7)))){apply('find_dates');apply('preferred_mode','single');apply('preferred_month',parsed.from.slice(0,7));apply('preferred_date',parsed.from);if(parsed.to!==parsed.from){apply('preferred_mode','range');apply('preferred_month',parsed.to.slice(0,7));apply('preferred_date',parsed.to);}fields.date=next.preferredFrom===parsed.from&&next.preferredTo===parsed.to;}
  }
  if(parsed.area){apply('jeju_support_area',parsed.area);fields.area=true;}
  if(parsed.wheelchair!==null){apply('jeju_support_wheelchair',parsed.wheelchair);fields.wheelchair=true;}
  if(parsed.from&&!fields.date)parsed.notices.push('입력한 날짜를 현재 달력에 적용하지 못했어요. 날짜를 다시 선택해 주세요.');
  const preferences={...next.coordination?.preferences};
  if(parsed.clear.includes('wheelchair'))delete preferences.wheelchair;
  next={...next,coordination:{...next.coordination,preferences}};
  for(const field of ['companion','taxi','wheelchair','pickupTime']){
    if(parsed[field]===undefined||parsed[field]===null)continue;
    next=reduceCoordination(next,{type:'coordination_option',value:{field,value:parsed[field]}});
    fields[field]=true;
  }
  if(parsed.area)next=reduceCoordination(next,{type:'coordination_option',value:{field:'pickup',value:parsed.area}});
  const reportedReferral=parsed.referral??state.quickEntry?.reportedReferral??null;
  return {...next,quickEntry:{text:String(text).trim(),fields,notices:parsed.notices,reportedReferral}};
}

export function careRequestReview(state) {
  const fields=state.quickEntry?.fields||{},p=state.jejuHospital,h=state.usePublicData?publicHospital(state):regionHospitals(state.region).find(h=>h.id===state.hospitalId);
  const from=state.usePublicData?p.from:state.preferredFrom,to=state.usePublicData?p.to:state.preferredTo;
  return [
    {id:'hospital',label:'병원',value:state.usePublicData?h?.companyName:fields.hospital?h?.name:null,action:'edit_intake'},
    {id:'department',label:'진료과',value:state.usePublicData?p.visitDepartment:fields.department?state.department:null,action:'edit_intake'},
    {id:'date',label:'희망 날짜',value:from&&to?`${from}${to!==from?` ~ ${to}`:''}`:null,action:state.usePublicData?'public_edit_dates':'find_dates'},
    {id:'time',label:state.usePublicData?'의료진·시간':'의료진·시각',value:state.usePublicData&&publicWishReady(p)?`${p.doctorMode==='named'?p.doctorName:'의료진 무관'} · ${publicTimeLabel(p)}`:!state.usePublicData&&state.time?`${state.date} ${state.time}`:null,action:state.usePublicData?'public_edit_dates':'find_dates'},
  ];
}

export function careRequestPreview(text,region,today=koreanToday()) {
  const p=parseCareRequest(text,{region,today});
  const hospital=(region==='jeju'?publicHospitalCandidates({area:'',department:''}).map(h=>({id:h.id,name:h.companyName})):regionHospitals(region)).find(h=>h.id===p.hospitalId)?.name;
  const referral=REFERRAL_LABELS[p.referral];
  const companion=p.companion===true?'동행 문의 희망':p.companion===false?'동행 요청 안 함':'';
  return [
    {id:'hospital',label:'병원·진료과',value:[hospital,p.department].filter(Boolean).join(' · '),complete:Boolean(hospital&&p.department)},
    {id:'schedule',label:'희망 일정',value:[p.from?`${p.from}${p.to!==p.from?` ~ ${p.to}`:''}`:null,p.time||({morning:'오전 희망',afternoon:'오후 희망',any:'시간 무관'})[p.timeOfDay]].filter(Boolean).join(' · '),complete:Boolean(p.from&&p.to&&p.timeOfDay)},
    {id:'records',label:'준비 서류',value:referral||'',complete:Boolean(referral)},
    {id:'support',label:'이동·동행',value:[p.area,p.taxi===false?'차량 요청 안 함':p.pickupTime?`${p.pickupTime} 출발`:null,p.wheelchair===true?'휠체어 지원 문의':p.wheelchair===false?'휠체어 불필요 응답':null,companion].filter(Boolean).join(' · '),complete:Boolean(p.taxi===false||p.area&&(p.pickupTime||p.wheelchair!==null||companion))},
  ];
}

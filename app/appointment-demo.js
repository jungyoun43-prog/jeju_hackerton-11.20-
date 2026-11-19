import supportData from './data/visit-support-providers.json' with {type:'json'};
import { getSupportCandidates } from './support-data.js';
import { createTravelPlan, invalidateTravel, updateTravel, travelReport } from './appointment-travel.js';
import { flightOutboundDate } from './appointment-booking-links.js';
import {needsWheelchairVehicle,plannedPickupDeadline} from './coordination-vehicles.js';
import { APPOINTMENT_DEPARTMENTS } from './appointment-departments.js';
import {createJejuHospitalPlan,createJejuSupportPlan,publicHospital,publicHospitalReady,publicWishReady,reduceJejuHospitalPlan,reduceJejuSupportPlan,jejuSupportEvidence,jejuDataSourceReport,buildPublicHospitalReport} from './jeju-appointment-data.js';

// 날짜·병원·의료진·슬롯은 고정 시연 자료이며 실제 대기기간 추정치가 아니다.
export const APPOINTMENT_REFERENCE_DATE='2026-11-15';
export const APPOINTMENT_MONTHS=['2026-11','2026-12','2027-01'];
export const APPOINTMENT_HOSPITALS=[
  {id:'hanbit',name:'서울 한빛대학교병원',region:'seoul'},
  {id:'nuri',name:'서울 누리대학교병원',region:'seoul'},
  {id:'baram',name:'제주 바람종합병원',region:'jeju'},
  {id:'onyu',name:'서귀포 온유병원',region:'jeju'},
];
export const appointmentRegion=state=>state?.region==='jeju'?'jeju':'seoul';
export const appointmentRegionLabel=state=>appointmentRegion(state)==='jeju'?'제주':'내륙';
export const regionHospitals=region=>APPOINTMENT_HOSPITALS.filter(hospital=>hospital.region===region);
const featuredDoctors=[
  {id:'hanbit-kim',hospitalId:'hanbit',name:'김도윤',department:'종양내과',description:'기존 치료 경과 확인 · 가상 의료진'},
  {id:'hanbit-lee',hospitalId:'hanbit',name:'이서연',department:'종양내과',description:'추적 진료 · 가상 의료진'},
  {id:'hanbit-park',hospitalId:'hanbit',name:'박지훈',department:'외과',description:'수술 후 외래 · 가상 의료진'},
  {id:'nuri-choi',hospitalId:'nuri',name:'최유진',department:'종양내과',description:'첫방문 상담 후 일정 안내 · 가상 의료진'},
  {id:'nuri-yoon',hospitalId:'nuri',name:'윤지호',department:'외과',description:'수술 후 외래 · 가상 의료진'},
  {id:'baram-kang',hospitalId:'baram',name:'강서진',department:'가정의학과',description:'외래 진료 · 가상 의료진'},
  {id:'baram-oh',hospitalId:'baram',name:'오지안',department:'가정의학과',description:'외래 진료 · 가상 의료진'},
  {id:'onyu-moon',hospitalId:'onyu',name:'문도현',department:'가정의학과',description:'외래 진료 · 가상 의료진'},
];
const demoNames=['서윤','지우','민서','하윤','준서','도현','서현','지민','유진','수빈','예린','민준','지호','하린','은우','수현','지안','태윤','소윤','준우','다은','시우','채원','도겸','세아','현우','수아'];
const extraDoctors=APPOINTMENT_HOSPITALS.flatMap((hospital,hospitalIndex)=>APPOINTMENT_DEPARTMENTS
  .filter(department=>!featuredDoctors.some(doctor=>doctor.hospitalId===hospital.id && doctor.department===department.name))
  .map((department,index)=>({id:`${hospital.id}-${department.id}`,hospitalId:hospital.id,name:`${hospitalIndex?'정':'한'}${demoNames[index]}`,department:department.name,description:'외래 진료 · 가상 의료진'})));
export const APPOINTMENT_DOCTORS=[...featuredDoctors,...extraDoctors];
const schedules={
  'hanbit-kim':{'2026-11-17':[['10:30',false]],'2026-11-24':[['10:30',false]],'2026-12-08':[['10:30',true],['11:20',false],['14:40',true]],'2026-12-15':[['14:40',true]],'2027-01-12':[['09:30',true]]},
  'hanbit-lee':{'2026-11-20':[['13:30',false]],'2026-12-01':[['13:30',true],['14:10',true]],'2026-12-22':[['13:30',false]],'2027-01-05':[['10:20',true]]},
  'hanbit-park':{'2026-12-03':[['09:00',false]],'2027-01-12':[['09:00',true]],'2027-01-19':[['10:00',true]]},
  'nuri-choi':{},
  'nuri-yoon':{'2026-11-26':[['09:20',false]],'2026-12-10':[['09:20',true]],'2027-01-14':[['10:00',true]]},
  'baram-kang':{'2026-11-18':[['09:30',true],['10:00',false],['14:00',true]],'2026-11-25':[['10:30',true]],'2026-12-02':[['09:30',true]],'2027-01-06':[['10:00',true]]},
  'baram-oh':{'2026-11-18':[['11:00',true]],'2026-11-20':[['14:30',true]],'2026-12-09':[['10:00',true]],'2027-01-13':[['14:00',true]]},
  'onyu-moon':{'2026-11-19':[['10:00',true]],'2026-11-26':[['14:00',true]],'2026-12-03':[['09:30',true]],'2027-01-07':[['11:00',true]]},
};
// 추가 진료과도 고정 fixture를 사용한다. 일부는 시간표 미공개로 상담까지 이어진다.
for(const [index,doctor] of extraDoctors.entries()) {
  schedules[doctor.id]=index%6===5?{}:{
    [index%2?'2026-11-19':'2026-11-24']:[['10:00',APPOINTMENT_HOSPITALS.find(h=>h.id===doctor.hospitalId).region==='jeju']],
    [['2026-12-02','2026-12-09','2026-12-17','2026-12-23'][index%4]]:[['10:00',true],['10:40',false],['14:00',true]],
    [['2027-01-06','2027-01-14','2027-01-20','2027-01-26'][index%4]]:[['09:30',true]],
  };
}
export const APPOINTMENT_BOUNDARY='가상 병원·의료진·시간표입니다. 실제 빈자리 조회·예약·전송은 하지 않아요.';
export const APPOINTMENT_SOURCES=[
  {label:'서울대병원 · 진료의뢰서 안내',url:'https://www.snuh.org/content/Q003012001.do'},
  {label:'서울아산병원 · 예약·의뢰 절차',url:'https://www.amc.seoul.kr/asan/outclinicguide/medicalprocedure/medicalProcedure.do?tabIndex=1'},
];
export const VISIT_TYPES={first:'처음 가는 병원·진료과',followup:'같은 병원·같은 과 재진',unknown:'초진·재진 확인 필요'};
export const REFERRAL_LABELS={reported:'의뢰서 보유 응답 · 병원 확인 전',submitted:'기존 제출 응답 · 이번 진료 적용 확인 전',missing:'의뢰서 미준비',unknown:'의뢰서 상태 미확인'};
export function reportedReferralLabel(state) {
  return REFERRAL_LABELS[state.referralStatus ?? state.quickEntry?.reportedReferral] ?? null;
}

export function appointmentSlots(doctorId,date) {
  const schedule=Object.hasOwn(schedules,doctorId)?schedules[doctorId]:{};
  return (Object.hasOwn(schedule,date)?schedule[date]:[]).map(([time,available])=>({time,available}));
}
export function nextAppointmentDate(doctorId) {
  return Object.keys(schedules[doctorId] || {}).sort().find(date=>date>=APPOINTMENT_REFERENCE_DATE && appointmentSlots(doctorId,date).some(slot=>slot.available)) || null;
}
export function appointmentDay(doctorId,date) {
  if(date<APPOINTMENT_REFERENCE_DATE)return 'past';
  const day=new Date(date+'T12:00:00Z').getUTCDay();
  if(day===0 || day===6)return 'closed';
  const slots=appointmentSlots(doctorId,date);
  return slots.some(slot=>slot.available)?'available':slots.length?'full':'unpublished';
}
export function appointmentCalendar(month) {
  if(!APPOINTMENT_MONTHS.includes(month))return [];
  const first=new Date(month+'-01T12:00:00Z'),offset=first.getUTCDay();
  const length=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0)).getUTCDate();
  return Array.from({length:Math.ceil((offset+length)/7)*7},(_,index)=>index<offset || index>=offset+length?null:`${month}-${String(index-offset+1).padStart(2,'0')}`);
}
export function createAppointmentDemo(region='seoul',options={}) {
  region=region==='jeju'?'jeju':'seoul';
  const usePublicData=region==='jeju' && options.usePublicData===true;
  return {region,usePublicData,...(options.today?{today:options.today}:{}),jejuHospital:region==='jeju'?createJejuHospitalPlan(options.area,options.today):null,jejuSupport:options.area?createJejuSupportPlan(options.area):null,screen:usePublicData?'public_find':'intake',hospitalId:region==='jeju'?'baram':'hanbit',department:region==='jeju'?'가정의학과':'종양내과',visitType:null,referralStatus:null,doctorId:null,month:APPOINTMENT_MONTHS[0],date:null,time:null,dateMode:'single',preferredFrom:null,preferredTo:null,dateFirst:false,requestMode:null,status:'draft',recheck:false,travel:createTravelPlan(region)};
}
export function matchingDoctors(state) {
  return APPOINTMENT_DOCTORS.filter(doctor=>doctor.hospitalId===state.hospitalId && doctor.department===state.department);
}
export function preferredDateReady(state) { return Boolean(state.preferredFrom && state.preferredTo); }
export function preferredDateIncludes(state,date) { return preferredDateReady(state) && date>=state.preferredFrom && date<=state.preferredTo; }
export function availabilityDay(state,date) {
  const statuses=matchingDoctors(state).map(doctor=>appointmentDay(doctor.id,date));
  return statuses.includes('available')?'available':statuses.includes('full')?'full':statuses[0] || 'unpublished';
}
export function availableAppointments(state) {
  if(!preferredDateReady(state))return [];
  return APPOINTMENT_MONTHS.flatMap(appointmentCalendar).filter(date=>date && preferredDateIncludes(state,date)).flatMap(date=>
    matchingDoctors(state).flatMap(doctor=>appointmentSlots(doctor.id,date).filter(slot=>slot.available).map(slot=>({date,doctor,time:slot.time,key:`${doctor.id}|${date}|${slot.time}`}))))
    .sort((a,b)=>a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.doctor.name.localeCompare(b.doctor.name,'ko'));
}
export function nextMatchingDate(state) {
  return APPOINTMENT_MONTHS.flatMap(appointmentCalendar).filter(Boolean).find(date=>date>(state.preferredTo || state.preferredFrom || APPOINTMENT_REFERENCE_DATE) && availabilityDay(state,date)==='available') || null;
}
export function appointmentSelection(state) {
  if(state.usePublicData) {const h=publicHospital(state);return {hospital:h?{...h,name:h.companyName,isPublic:true}:null,doctor:null,date:null,time:null,valid:false};}
  const hospital=APPOINTMENT_HOSPITALS.find(item=>item.id===state.hospitalId);
  const doctor=APPOINTMENT_DOCTORS.find(item=>item.id===state.doctorId && item.hospitalId===state.hospitalId && item.department===state.department);
  return {hospital,doctor,date:state.date,time:state.time,valid:Boolean(doctor && appointmentSlots(doctor.id,state.date).some(slot=>slot.time===state.time && slot.available))};
}
export function intakeComplete(state) {return Boolean(VISIT_TYPES[state.visitType] && (appointmentRegion(state)==='jeju' || REFERRAL_LABELS[state.referralStatus]));}
export function referralDisposition(state) {
  if(appointmentRegion(state)==='jeju')return {canConfirm:intakeComplete(state) && state.visitType!=='unknown',next:'희망 일정을 정한 뒤 선택한 병원에 초진·재진 접수 방법과 필요한 서류를 확인해요. 도외 진료를 의뢰받는 경우 의뢰서 발급은 담당 의료진에게 상담해요.',label:REFERRAL_LABELS[state.referralStatus] || '필요 서류는 선택한 병원에 확인'};
  const reported=['reported','submitted'].includes(state.referralStatus);
  const canConfirm=intakeComplete(state) && state.visitType!=='unknown' && reported;
  const next=state.referralStatus==='missing'
    ?'제주 담당 의료진에게 의뢰 필요성과 의뢰서 발급을 상담하고, 받을 병원·진료과와 제출 방법을 확인해요.'
    :state.visitType==='followup'
      ?'같은 병원·같은 과의 재진인지, 기존 의뢰서가 이번 진료에도 적용되는지 예약 창구에 확인해요.'
      :reported?'의뢰서의 수신 병원·진료과, 발급일과 최근 상태 반영 여부, 원본·제출 방법을 병원에 확인해요.'
        :'첫방문·진료협력 창구에 초진 여부와 진료의뢰서 준비·제출 요건부터 문의해요.';
  return {canConfirm,next,label:REFERRAL_LABELS[state.referralStatus] || '의뢰서 준비 여부부터 확인'};
}
export function canReviewAppointment(state,chosen=appointmentSelection(state)) {
  if(state.usePublicData)return publicWishReady(state.jejuHospital);
  return Boolean(chosen.hospital) && (state.requestMode==='consultation' || chosen.valid);
}
export function needsScheduleConsultation(state) {
  return !state.usePublicData && state.requestMode==='consultation' && !appointmentSelection(state).valid;
}
function clearSelection(state,patch) {
  return {...state,...patch,time:null,requestMode:null,status:'draft',recheck:state.recheck || state.status!=='draft',travel:invalidateTravel(state.travel)};
}
/** 시연의 자기보고·접수 준비와 실제 의뢰서/예약 상태를 분리한다. 기존 case와 저장소는 변경하지 않는다. */
function reduceAppointmentCore(state,action) {
  if(!state || !action)return state;
  if(action.type==='data_mode' && state.region==='jeju' && ['public','demo'].includes(action.value))return {...state,usePublicData:action.value==='public',travel:state.usePublicData===(action.value==='public')?state.travel:invalidateTravel(state.travel),screen:action.value==='public'?(state.jejuHospital.prepared?'public_review':publicHospitalReady(state.jejuHospital)?'public_dates':'public_find'):state.dateFirst?'availability':'intake'};
  const context={patient:{area:action.area},visitSupport:{requirements:{wheelchair:Boolean(action.wheelchair)}}};
  if(['jeju_support_area','jeju_support_pick','jeju_support_wheelchair'].includes(action.type)) {
    const jejuSupport=reduceJejuSupportPlan(state,action,context);
    return jejuSupport===state.jejuSupport?state:{...state,jejuSupport};
  }
  if(state.usePublicData) {
    if(['public_edit_dates','public_dates_next'].includes(action.type))return {...state,screen:publicHospitalReady(state.jejuHospital)?'public_dates':'public_find'};
    if(String(action.type).startsWith('public_')) {
      const jejuHospital=reduceJejuHospitalPlan(state.jejuHospital,action);if(jejuHospital===state.jejuHospital)return state;
      const screen=action.type==='public_prepare'?'public_review':['public_area','public_department'].includes(action.type)?'public_find':state.screen;
      return {...state,jejuHospital,screen,travel:['public_month','public_prepare','public_show_preferences'].includes(action.type)?state.travel:invalidateTravel(state.travel)};
    }
    if(action.type==='edit_intake')return {...state,screen:'public_find'};
    if(action.type==='resume')return {...state,screen:state.jejuHospital.prepared?'public_review':publicHospitalReady(state.jejuHospital)?'public_dates':'public_find'};
    if(action.type==='back')return {...state,screen:state.screen==='public_dates'?'public_find':'public_dates'};
    if(['hospital','department','visit_type','referral','continue','find_dates','preferred_mode','preferred_month','preferred_date','next_match','slot','doctor','month','next_available','date','time','review','consult','request','reply','edit','edit_referral'].includes(action.type))return state;
  }
  switch(action.type) {
    case 'request_clear': {
      const patches={hospital:{hospitalId:null,department:null,doctorId:null,date:null},department:{department:null,doctorId:null,date:null},date:{preferredFrom:null,preferredTo:null,date:null,doctorId:null},time:{time:null,doctorId:null,date:null}};
      return Object.hasOwn(patches,action.value)?clearSelection(state,patches[action.value]):state;
    }
    case 'travel_field':
    case 'flight_field':
    case 'flight_dates':
    case 'travel_check': {
      const travel=updateTravel(state.travel || createTravelPlan(),{...action,date:state.date},Boolean(action.wheelchair));
      return travel===state.travel?state:{...state,travel};
    }
    case 'hospital':
      if(!regionHospitals(appointmentRegion(state)).some(item=>item.id===action.value) || action.value===state.hospitalId)return state;
      return clearSelection(state,{hospitalId:action.value,doctorId:null,date:null,visitType:null,referralStatus:null,screen:'intake',month:APPOINTMENT_MONTHS[0]});
    case 'department':
      if(!APPOINTMENT_DOCTORS.some(item=>item.hospitalId===state.hospitalId && item.department===action.value) || action.value===state.department)return state;
      return clearSelection(state,{department:action.value,doctorId:null,date:null,visitType:null,referralStatus:null,screen:'intake'});
    case 'visit_type':
      if(!['intake','review'].includes(state.screen) || !Object.hasOwn(VISIT_TYPES,action.value) || action.value===state.visitType)return state;
      if(state.screen==='review')return {...state,visitType:action.value,referralStatus:null,status:'draft',recheck:state.recheck || state.status!=='draft',travel:invalidateTravel(state.travel)};
      return clearSelection(state,{visitType:action.value,referralStatus:null});
    case 'referral': {
      const allowed=state.visitType==='followup'?['submitted','reported','missing','unknown']:['reported','missing','unknown'];
      if(!['intake','review'].includes(state.screen) || !state.visitType || !allowed.includes(action.value) || action.value===state.referralStatus)return state;
      if(state.screen==='review')return {...state,referralStatus:action.value,status:'draft',recheck:state.recheck || state.status!=='draft',travel:invalidateTravel(state.travel)};
      return clearSelection(state,{referralStatus:action.value});
    }
    case 'continue':return state.screen==='intake' && intakeComplete(state)?{...state,screen:'doctors'}:state;
    case 'find_dates':return appointmentSelection(state).hospital && matchingDoctors(state).length?{...state,screen:'availability',dateFirst:true}:state;
    case 'preferred_mode': {
      if(state.screen!=='availability' || !['single','range'].includes(action.value) || action.value===state.dateMode)return state;
      return clearSelection(state,{dateMode:action.value,preferredTo:action.value==='single'?state.preferredFrom:null,doctorId:null,date:null});
    }
    case 'preferred_month':
      return state.screen==='availability' && APPOINTMENT_MONTHS.includes(action.value)?{...state,month:action.value}:state;
    case 'preferred_date': {
      if(state.screen!=='availability' || !appointmentCalendar(state.month).includes(action.value) || action.value<APPOINTMENT_REFERENCE_DATE)return state;
      const starting=state.dateMode==='single' || !state.preferredFrom || state.preferredTo;
      const [from,to]=starting?[action.value,state.dateMode==='single'?action.value:null]:[state.preferredFrom,action.value].sort();
      return clearSelection(state,{preferredFrom:from,preferredTo:to,doctorId:null,date:null});
    }
    case 'next_match': {
      const date=nextMatchingDate(state);
      return state.screen==='availability' && date?clearSelection(state,{preferredFrom:date,preferredTo:date,month:date.slice(0,7),doctorId:null,date:null}):state;
    }
    case 'slot': {
      if(state.screen!=='availability')return state;
      const slot=availableAppointments(state).find(item=>item.key===action.value);
      if(!slot || (state.doctorId===slot.doctor.id && state.date===slot.date && state.time===slot.time))return state;
      return {...clearSelection(state,{doctorId:slot.doctor.id,date:slot.date}),time:slot.time};
    }
    case 'edit_intake':return {...state,screen:'intake'};
    case 'edit_referral':return {...state,screen:'review',requestMode:state.requestMode || (appointmentSelection(state).valid?'slot':'consultation')};
    case 'doctor': {
      const doctor=APPOINTMENT_DOCTORS.find(item=>item.id===action.value && item.hospitalId===state.hospitalId && item.department===state.department);
      if(!doctor)return state;
      return clearSelection(state,{doctorId:doctor.id,date:null,month:APPOINTMENT_MONTHS[0],screen:'schedule'});
    }
    case 'month':
      if(state.screen!=='schedule' || !APPOINTMENT_MONTHS.includes(action.value) || state.month===action.value)return state;
      return clearSelection(state,{month:action.value,date:null});
    case 'next_available': {
      const date=nextAppointmentDate(state.doctorId);
      return state.screen==='schedule' && date?clearSelection(state,{month:date.slice(0,7),date}):state;
    }
    case 'date':
      if(state.screen!=='schedule' || !appointmentCalendar(state.month).includes(action.value) || ['past','closed'].includes(appointmentDay(state.doctorId,action.value)) || action.value===state.date)return state;
      return clearSelection(state,{date:action.value});
    case 'time':
      if(state.screen!=='schedule' || !appointmentSlots(state.doctorId,state.date).some(slot=>slot.time===action.value && slot.available))return state;
      return {...state,time:action.value,status:'draft',travel:state.time===action.value?state.travel:invalidateTravel(state.travel)};
    case 'review':
      return ['schedule','availability'].includes(state.screen) && appointmentSelection(state).valid?{...state,screen:state.status==='draft'?'review':'result',requestMode:'slot'}:state;
    case 'consult':
      return appointmentSelection(state).hospital?{...state,screen:'review',requestMode:'consultation',status:'draft',preferredFrom:state.preferredFrom||state.date,preferredTo:state.preferredTo||state.date,date:null,time:null,doctorId:null}:state;
    case 'request':
      if(state.screen!=='review' || state.status!=='draft' || !intakeComplete(state) || !canReviewAppointment(state))return state;
      return {...state,screen:'result',status:state.requestMode==='slot' && referralDisposition(state).canConfirm?'requested_demo':'consultation_requested_demo'};
    case 'reply':
      if(state.screen!=='result' || !['requested_demo','consultation_requested_demo'].includes(state.status))return state;
      if(action.value==='confirm')return state.status==='requested_demo' && appointmentSelection(state).valid && referralDisposition(state).canConfirm?{...state,status:'confirmed_demo'}:state;
      if(action.value==='documents')return {...state,status:'documents_needed_demo'};
      if(action.value==='change')return {...state,status:'change_requested_demo',recheck:true};
      return state;
    case 'edit':return clearSelection(state,{screen:state.dateFirst?'availability':state.doctorId?'schedule':'intake'});
    case 'back':
      if(state.screen==='availability')return {...state,screen:'intake'};
      if(state.screen==='doctors')return {...state,screen:'intake'};
      if(state.screen==='schedule')return {...state,screen:'doctors'};
      if(state.screen==='review')return {...state,screen:state.dateFirst?'availability':state.doctorId?'schedule':'intake'};
      return state;
    case 'view':return ['records','support'].includes(action.value)?{...state,screen:action.value}:state;
    case 'resume':return {...state,screen:state.status!=='draft'?'result':state.requestMode?'review':state.dateFirst?'availability':state.doctorId?'schedule':'intake'};
    default:return state;
  }
}
// Changed conditions permanently invalidate receipts. Returning to an old value
// does not resurrect a booking from a previous simulation run.
export function reduceAppointmentDemo(state,action) {
  let next=reduceAppointmentCore(state,action);
  if(next===state||!state?.coordination)return next;
  const appointmentKey=s=>JSON.stringify(s.usePublicData?[s.region,s.usePublicData,s.jejuHospital.hospitalId,s.jejuHospital.visitDepartment,s.jejuHospital.from,s.jejuHospital.to,s.jejuHospital.doctorMode,s.jejuHospital.doctorName,s.jejuHospital.timeOfDay,s.jejuHospital.time]:[s.region,s.usePublicData,s.hospitalId,s.department,s.doctorId,s.preferredFrom,s.preferredTo,s.date,s.time,s.visitType,s.referralStatus]);
  const appointmentChanged=appointmentKey(state)!==appointmentKey(next);
  const outboundChanged=state.region==='seoul'&&flightOutboundDate(state)!==flightOutboundDate(next);
  const wheelchairChanged=needsWheelchairVehicle(state,action.wheelchair)!==needsWheelchairVehicle(next,action.wheelchair);
  if(!appointmentChanged&&(outboundChanged||wheelchairChanged||plannedPickupDeadline(state)!==plannedPickupDeadline(next))){
    const results={...state.coordination.results};
    if(!results.taxi&&!state.coordination.vehicleChoice&&!(wheelchairChanged&&results.companion))return next;
    delete results.taxi;
    if(wheelchairChanged)delete results.companion;
    return {...next,coordination:{...state.coordination,vehicleChoice:null,results,active:null,status:'idle',resultOpen:false,invalidated:true}};
  }
  if(!appointmentChanged)return next;
  return {...next,coordination:{...state.coordination,vehicleChoice:null,results:{},status:'idle',active:null,resultOpen:false,
    invalidated:Boolean(Object.keys(state.coordination.results||{}).length)||state.coordination.invalidated}};
}
export function appointmentStatus(state) {
  if(state.usePublicData)return state.jejuHospital.prepared?'공개자료로 문의 내용 정리됨 · 예약 미확정':'공개 병원·희망 일정 확인 중';
  return ({draft:'희망 일정·접수 요건 준비 중',requested_demo:'희망 일정 접수 시연 · 병원 확인 대기',consultation_requested_demo:'예약 상담 접수 시연 · 서류·진료과 확인 대기',documents_needed_demo:appointmentRegion(state)==='jeju'?'서류 보완 안내 시연 · 병원 요청 자료 확인 필요':'서류 보완 안내 시연 · 의뢰서 확인 필요',confirmed_demo:'예약 확정 회신 시연',change_requested_demo:'다른 일정 안내 시연 · 다시 확인 필요'})[state.status];
}
export function appointmentPreparation(caseState,state) {
  const requirements=caseState.visitSupport?.requirements || {};
  const evidence=state?jejuSupportEvidence(state,caseState):null;
  const candidate=evidence?.selected.taxi || (evidence?evidence.taxi[0]:getSupportCandidates(supportData,{kind:'taxi',area:caseState.patient.area,wheelchair:Boolean(requirements.wheelchair)})[0]);
  const documents=[['referral','진료의뢰서'],['history','치료 이력'],['report','최근 검사 판독문']].map(([id,label])=>{
    const document=caseState.documents.find(doc=>doc.id===id);
    return {id,label,ready:document?.status==='ready',source:document?.source || ''};
  });
  return {documents,candidate,wheelchair:Boolean(requirements.wheelchair),legs:appointmentRegion(state)==='jeju'?[
    {id:'jeju',title:`${caseState.patient.area} → ${appointmentSelection(state).hospital?.name || '제주 병원'}`,detail:'접수·검사와 병원 도착 시각, 버스 노선 또는 차량 픽업·승하차 지원을 확인해요.'},
    {id:'return',title:'진료·검사 후 → 집',detail:'검사 종료와 귀가 차량·막차, 동행·휠체어 지원 및 추가 방문을 확인해요.'},
  ]:[
    {id:'jeju',title:`${caseState.patient.area} → 제주공항`,detail:requirements.wheelchair?'공항 운행 범위·이용자격·회원등록·앉은 채 탑승·승하차 지원을 문의해요.':'병원의 확정 일정과 접수 시각을 확인한 뒤 공항 이동 시각·운행 범위·요금·동행인 탑승을 문의해요.'},
    {id:'flight',title:'제주 → 서울 · 항공편',detail:'의뢰서 접수·영상 등록·검사 일정과 공항 이동 여유를 확인한 뒤 항공편을 맞춰요. 항공편·운항 시간·항공권은 아직 확인하지 않았어요.'},
    {id:'seoul',title:'도착 공항 → 서울 병원',detail:'서울 이동·병원 동행과 필요 시 전날 도착·숙박을 별도로 확인해요. 제주 문의처는 이 구간의 공급자가 아니에요.'},
    {id:'return',title:'진료·검사 후 → 제주 귀가',detail:'검사가 다른 날이면 추가 왕복·숙박도 검토해요. 귀가편을 먼저 확정하지 않고, 제주에서 이어갈 진료와 전달할 결과는 의료진 안내를 받아 정리해요.'},
  ]};
}
export function buildAppointmentReport(state,caseState) {
  if(state.usePublicData)return [...buildPublicHospitalReport(state,caseState),...travelReport(state,Boolean(caseState.visitSupport?.requirements?.wheelchair))].join('\n\n');
  const {hospital,doctor,date,time}=appointmentSelection(state),prep=appointmentPreparation(caseState,state),referral=referralDisposition(state);
  return [`# ${appointmentRegionLabel(state)} 병원 진료 준비 · 합성 체험`,APPOINTMENT_BOUNDARY,
    `- 시연 기준일: ${APPOINTMENT_REFERENCE_DATE}. 표시 일정은 실제 병원의 대기기간 통계가 아닙니다.`,
    `- 대상: ${caseState.patient.name} (가상) · ${caseState.patient.area}`,
    `- 병원/의료진: ${hospital?.name || '미선택'} / ${doctor?`${doctor.department} ${doctor.name} (가상)`:'상담 후 확인'}`,
    `- 방문 유형: ${VISIT_TYPES[state.visitType] || '미확인'}`,
    `- 진료의뢰서: ${referral.label}. 시연 자기보고이며 실제 문서·접수 검증 아님`,
    `- 먼저 할 일: ${referral.next}`,
    `- 희망 일정: ${date || '상담 후 조율'} ${time || ''} (한국 시각, 고정 시연 일정)`,
    ...(state.preferredFrom?[`- 검색한 희망 날짜: ${state.preferredFrom}${state.dateMode==='range'?` ~ ${state.preferredTo || '종료일 미선택'}`:''}. 가능한 의료진 비교용이며 예약 확정이 아닙니다.`]:[]),
    `- 상태: ${appointmentStatus(state)}. 실제 예약 미확정 · 전송 없음`,
    ...(state.recheck?[`- 조건 변경: ${appointmentRegion(state)==='jeju'?'접수·이동·동행':'접수·이동·동행·항공·숙박'} 조건 재확인 필요`]:[]),
    '## 기존 자료와 보완 자료',...prep.documents.map(item=>`- ${item.label}: ${item.ready?'기존 합성 자료 보유':'기존 준비에서 미확보'}${item.source?` · 출처: ${item.source}`:''}`),
    '- 판독문·영상은 진료 참고 자료이며 진료의뢰서를 대신하지 않습니다. 발급·제출 요건, 적용 예외와 의료급여 등은 병원에 확인합니다. 진찰·의뢰서를 자동 생성하지 않습니다.',
    '## 왕복 이동과 제주 후속 진료',...prep.legs.map(leg=>`- ${leg.title}: ${leg.detail}`),
    ...(prep.candidate?[`- 제주 구간 문의 후보: ${prep.candidate.name} · ${prep.candidate.phone} · 차량/운행/예약 미확인`,`- 공개 출처: ${prep.candidate.source.url} · 자료 시점 ${prep.candidate.source.asOf || '공식 안내, 기준일 미표시'}`]:[]),
    ...travelReport(state,prep.wheelchair),
    ...jejuDataSourceReport(state,caseState),
    '## 절차를 참고한 공식 안내',...APPOINTMENT_SOURCES.map(source=>`- ${source.label}: ${source.url} (2026-11-15 확인; 가상 병원의 정책을 뜻하지 않음)`),
    '## 실제 실행 범위','진료 지역의 선택은 보호자의 희망이며 의료진의 의뢰·전원 결정이 아닙니다. 진료 필요성·진료과·의료진 적합성을 판단하지 않았습니다. 실제 병원 확인·본인인증·위임·개인정보 전송·진료 수락·예약·배차는 수행하지 않았습니다.',
  ].join('\n\n');
}

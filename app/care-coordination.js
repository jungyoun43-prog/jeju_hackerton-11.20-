import {appointmentSelection,canReviewAppointment,reportedReferralLabel} from './appointment-demo.js';
import {jejuDataSourceReport,taxiInquiryContacts} from './jeju-appointment-data.js';
import {flightOutboundDate,outboundDateIssue,shiftFlightDate} from './appointment-booking-links.js';
import {invalidateTravel,updateTravel} from './appointment-travel.js';
import {findVehicleAlternatives,needsWheelchairVehicle,plannedPickupDeadline,selectedVehicleService} from './coordination-vehicles.js';

const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
const defaultVehicle='가상 이동지원센터';
const handoffDetails={
  hospital_identity:'예약 창구에서 환자 본인확인을 요청했어요.',
  hospital_pending:'병원 일정을 확정한 뒤 다시 요청해 주세요.',
  vehicle_unavailable:'요청한 시간에 차량이 없어 다른 시간이나 업체 확인이 필요해요.',
};
const shift=(date,time,minutes)=>{
  const instant=new Date(`${date}T${time}:00Z`);
  instant.setUTCMinutes(instant.getUTCMinutes()+minutes);
  const [day,clock]=instant.toISOString().split('T');
  return {date:day,time:clock.slice(0,5)};
};

function pickupIssue({ready,local,date,time,pickupDate,options,latestPickup,meetingAt,today}) {
  if(!ready)return {issue:'병원과 진료 날짜·시간을 먼저 골라 주세요.'};
  if(!options.taxi)return {};
  if(!local) {
    const dateIssue=outboundDateIssue(pickupDate,today);
    if(dateIssue||pickupDate>date)return {issue:dateIssue||'진료일 또는 그 이전으로 항공권 가는 날을 골라 주세요.',issueControl:'flight-outbound'};
  }
  if(!options.pickup.trim())return {issue:'차량이 출발할 장소를 입력해 주세요.',issueControl:'coordination-pickup'};
  const pickup=`${pickupDate}T${options.pickupTime}`;
  if(!timePattern.test(options.pickupTime)||pickup>=`${date}T${time}`)return {issue:'차량 출발 시간을 진료 시각보다 앞서 정해 주세요.',issueControl:'coordination-pickup-time'};
  if(pickup>=latestPickup){
    const issue=latestPickup===meetingAt
      ?`병원 동행 약속(${meetingAt.replace('T',' ')})보다 앞서 출발해야 해요. 출발 날짜와 시각을 확인해 주세요.`
      :'차량 출발이 입력한 도착·항공 일정과 겹쳐요. 출발 시각이나 이동 계획을 확인해 주세요.';
    return {issue,issueControl:'coordination-pickup-time'};
  }
  return {};
}

export function coordinationPlan(state,caseState={}) {
  const chosen=appointmentSelection(state),p=state.jejuHospital,local=state.region==='jeju';
  const date=state.usePublicData?p.from:chosen.date;
  const time=state.usePublicData?(p.timeOfDay==='specific'?p.time:p.timeOfDay==='afternoon'?'14:00':'10:00'):chosen.time;
  const ready=Boolean(canReviewAppointment(state,chosen)&&date&&timePattern.test(time));
  const suggested=ready?shift(date,time,-60):{date:'',time:''};
  const meeting=ready?shift(date,time,-30):{date:'',time:''};
  const requirements=caseState.visitSupport?.requirements||{},pref=state.coordination?.preferences||{};
  const options={
    taxi:pref.taxi??requirements.transportNeeded??true,
    companion:pref.companion??requirements.companionNeeded??true,
    wheelchair:needsWheelchairVehicle(state,requirements.wheelchair),
    pickup:pref.pickup??caseState.patient?.area??'제주시',
    pickupTime:pref.pickupTime??(local?suggested.time:'09:00'),
  };
  const canChoosePickupDay=Boolean(local&&ready&&(suggested.date!==date||pref.pickupDay==='previous'||(timePattern.test(options.pickupTime)&&options.pickupTime>=time)));
  const pickupDay=pref.pickupDay??(ready&&pref.pickupTime===undefined&&suggested.date!==date?'previous':'same');
  const pickupDate=local?(date&&pickupDay==='previous'?shiftFlightDate(date,-1):date):flightOutboundDate(state);
  const plannedDeadline=plannedPickupDeadline(state);
  const routeDeadline=[ready?`${date}T${time}`:null,plannedDeadline].filter(Boolean).sort()[0];
  const meetingAt=ready&&options.companion?`${meeting.date}T${meeting.time}`:null;
  const latestPickup=meetingAt&&meetingAt<routeDeadline?meetingAt:routeDeadline;
  const {issue=null,issueControl=null}=pickupIssue({ready,local,date,time,pickupDate,options,latestPickup,meetingAt,today:state.today});
  const hospitalName=state.usePublicData?'가상 제주 병원':`${chosen.hospital?.name||'가상 병원'} (가상)`;
  const selectedName=chosen.hospital?.name;
  const doctor=state.usePublicData?(p.doctorMode==='named'?`희망 의료진 ${p.doctorName}`:null):chosen.doctor?.name;
  const department=state.usePublicData?p.visitDepartment:state.department;
  const hospitalSignature=JSON.stringify([state.region,state.usePublicData,selectedName,department,state.usePublicData?[p.from,p.to,p.doctorMode,p.doctorName,p.timeOfDay,p.time]:[chosen.doctor?.id,date,time],state.visitType,state.referralStatus]);
  const visitDetail=[`${date||'날짜 선택'} ${time||''}`.trim(),department,doctor].filter(Boolean).join(' · ');
  // 기존 차량이 동행 약속 전에 출발할 수 있으면, 동행만 추가하거나 제외해도 같은 회신을 보존한다.
  const vehicleRoute=JSON.stringify([hospitalSignature,options.pickup,options.wheelchair,pickupDate,routeDeadline]);
  const choice=state.coordination?.vehicleChoice;
  const service=issue?null:selectedVehicleService(choice,vehicleRoute,options.pickupTime,options.wheelchair);
  const taxiKey=[hospitalSignature,options.taxi,options.wheelchair,options.pickup,options.pickupTime];
  if(!local||pickupDate!==date)taxiKey.push(pickupDate);
  if(plannedDeadline)taxiKey.push(plannedDeadline);
  if(service)taxiKey.push(service.id);
  const pickupLabel=local?`${options.pickup} → 병원 · ${pickupDate&&pickupDate!==date?pickupDate+' ':''}${options.pickupTime} 출발`:
    `${pickupDate} ${options.pickupTime} ${options.pickup} → 제주공항 · 도착 공항에서 병원까지는 별도`;
  const adjustment=service?(choice.originalTime===options.pickupTime?' · 같은 시각에 대체 차량으로 변경':` · ${choice.originalTime}에서 변경`):'';
  const jobs=[
    {id:'hospital',title:'병원 예약',provider:hospitalName,date,time,detail:visitDetail,signature:hospitalSignature,enabled:true},
    {id:'taxi',title:options.wheelchair?'휠체어 차량 · 가는 편':'가는 편 차량',provider:service?.name||defaultVehicle,
      date:pickupDate,time:options.pickupTime,detail:pickupLabel+adjustment,signature:JSON.stringify(taxiKey),enabled:options.taxi,blocked:Boolean(issue)},
    {id:'companion',title:'병원 동행',provider:'가상 병원동행센터',date:meeting.date,time:meeting.time,
      detail:ready?`${meeting.date!==date?meeting.date+' ':''}${meeting.time} 병원에서 만나 접수·진료 동행`:'진료 시각에 맞춰 동행',
      signature:JSON.stringify([hospitalSignature,options.companion,options.wheelchair]),enabled:options.companion},
  ];
  const signature=JSON.stringify(jobs.filter(job=>job.enabled).map(job=>job.signature));
  return {mode:'simulation',local,ready:!issue,issue,issueControl,date,time,pickupDate,selectedName,hospitalName,department,doctor,options,jobs,signature,
    vehicleRoute,vehicleChoice:service?choice:null,latestPickup,canChoosePickupDay,pickupDay};
}

function matchingReceipt(job,result) {
  return job.enabled&&!job.blocked&&result?.kind==='synthetic_booking_receipt'&&result.mode==='simulation'&&
    result.jobId===job.id&&result.signature===job.signature&&result.provider===job.provider&&
    result.date===job.date&&result.time===job.time&&['confirmed','handoff'].includes(result.status)&&
    typeof result.reference==='string'&&result.reference.startsWith('DEMO-');
}

export function retainedCoordinationResults(jobs,results={}) {
  return Object.fromEntries(jobs.filter(job=>matchingReceipt(job,results[job.id])).map(job=>[job.id,results[job.id]]));
}
export function coordinationView(state,caseState={}) {
  const plan=coordinationPlan(state,caseState),saved=state.coordination||{};
  const running=saved.status==='running'&&saved.signature===plan.signature;
  const results=retainedCoordinationResults(plan.jobs,saved.results);
  const rows=plan.jobs.map(job=>{
    const result=results[job.id]||null;
    const status=job.enabled?(result?.status||(running&&saved.active===job.id?saved.phase:'queued')):'not_needed';
    return {...job,result,status};
  });
  const requested=rows.filter(row=>row.enabled);
  const confirmed=requested.filter(row=>row.status==='confirmed').length,handoffs=requested.filter(row=>row.status==='handoff').length;
  const done=requested.length>0&&confirmed+handoffs===requested.length;
  const stopped=!done&&!running&&saved.status==='stopped';
  const changed=Boolean((Object.keys(saved.results||{}).length||saved.invalidated)&&!done&&!running&&!stopped);
  const title=running?'혼디가 예약을 조율하고 있어요':done?handoffs?`${confirmed}건 예약 · ${handoffs}건 직접 확인이 필요해요`:'맡기신 예약 조율을 마쳤어요':stopped?'예약 조율을 멈췄어요':changed?'바뀐 조건으로 다시 조율해요':'이 내용으로 혼디에게 맡길까요?';
  let vehicleRecovery=null;
  const taxi=results.taxi;
  if(done&&taxi?.status==='handoff'&&results.hospital?.status==='confirmed'&&
    (taxi.reason==='vehicle_unavailable'||(!taxi.reason&&saved.scenario==='taxi_unavailable'))) {
    vehicleRecovery={
      requestedTime:taxi.time,
      offers:plan.ready?findVehicleAlternatives(plan,taxi.reference,plan.latestPickup):[],
      contacts:taxiInquiryContacts(plan.options.pickup,plan.options.wheelchair),
    };
  }
  return {...plan,rows,confirmed,handoffs,total:requested.length,done,running,stopped,changed,title,runId:saved.runId,vehicleRecovery};
}

function beginCoordination(state,view,runId) {
  if(!view.ready||view.running||view.done||typeof runId!=='string'||!runId.trim())return state;
  const current=state.coordination||{};
  const preferences={...current.preferences,...view.options};
  // 출발 시각을 직접 정하지 않았다면 다음 편집에서도 진료 시각에 맞춰 제안한다.
  if(current.preferences?.pickupTime===undefined)delete preferences.pickupTime;
  if(state.travel?.jejuMode==='accessible'){
    if(current.preferences?.wheelchair===undefined)delete preferences.wheelchair;
    else preferences.wheelchair=current.preferences.wheelchair;
  }
  return {...state,coordination:{...current,runId,signature:view.signature,status:'running',active:null,phase:'queued',
    results:retainedCoordinationResults(view.jobs,current.results),preferences,editing:false,resultOpen:false}};
}

function receiveCoordinationEvent(state,view,event) {
  const current=state.coordination;
  if(!event||!view.running||event.runId!==current.runId||event.signature!==view.signature)return state;
  const job=view.rows.find(row=>row.enabled&&!row.result);
  if(!job||job.id!==event.jobId)return state;
  const update=patch=>({...state,coordination:{...current,...patch}});
  if(event.phase==='contacting'&&!current.active)return update({active:job.id,phase:'contacting'});
  if(current.active!==job.id)return state;
  if(event.phase==='waiting'&&current.phase==='contacting')return update({phase:'waiting'});
  const receipt=event.receipt;
  if(event.phase!=='result'||current.phase!=='waiting'||!matchingReceipt(job,receipt)||
    receipt.reference!==`DEMO-${event.runId}-${job.id}`)return state;
  const results={...current.results,[job.id]:receipt};
  const done=view.rows.every(row=>!row.enabled||row.id===job.id||row.result);
  return update({results,status:done?'finished':'running',active:null,phase:'queued',resultOpen:done});
}

function changeCoordinationPreference(state,field,value,view,caseState,pickupDay) {
  const current=state.coordination||{};
  const deselectAccessible=field==='wheelchair'&&!value&&state.travel?.jejuMode==='accessible';
  if(current.preferences?.[field]===value&&!deselectAccessible)return state;
  const preferences={...current.preferences,[field]:value};
  if(field==='pickupTime'&&view.canChoosePickupDay&&pickupDay===view.pickupDay)preferences.pickupDay=pickupDay;
  const changed=(field==='pickupDay'?view.pickupDay:view.options[field])!==value;
  const travel=deselectAccessible?updateTravel(state.travel,{type:'travel_field',value:{field:'jejuMode',value:'taxi'}}):
    changed?invalidateTravel(state.travel):state.travel;
  const next={...state,coordination:{...current,preferences},travel};
  const plan=coordinationPlan(next,caseState);
  const results=retainedCoordinationResults(plan.jobs,current.results);
  const invalidated=Object.keys(results).length<Object.keys(current.results||{}).length;
  return {...next,coordination:{...next.coordination,vehicleChoice:plan.vehicleChoice,results,invalidated:current.invalidated||invalidated,
    ...(changed?{status:'idle',active:null,resultOpen:false}:{})}};
}

function retryVehicle(state,view,action,caseState) {
  // Re-derive the offer from the current handoff. A stale button cannot replace a newer booking.
  const offer=view.vehicleRecovery?.offers.find(item=>item.key===action.value);
  if(!offer||typeof action.runId!=='string'||!action.runId.trim())return state;
  const current=state.coordination;
  const next={...state,travel:invalidateTravel(state.travel),coordination:{...current,
    preferences:{...current.preferences,pickupTime:offer.time,...(view.local&&view.pickupDay==='previous'?{pickupDay:'previous'}:{})},
    vehicleChoice:{route:view.vehicleRoute,providerId:offer.providerId,time:offer.time,originalTime:view.vehicleRecovery.requestedTime},
  }};
  const changedView=coordinationView(next,caseState);
  if(!changedView.vehicleChoice)return state;
  const started=beginCoordination(next,changedView,action.runId);
  return started===next?state:started;
}

export function reduceCoordination(state,action,caseState={}) {
  const current=state.coordination||{},view=coordinationView(state,caseState);
  const set=patch=>({...state,coordination:{...current,...patch}});
  switch(action.type) {
    case 'coordination_result_open':return view.done?set({resultOpen:true}):state;
    case 'coordination_result_close':return current.resultOpen?set({resultOpen:false}):state;
    case 'coordination_edit':return view.running?state:set({editing:!current.editing});
    case 'coordination_option': {
      if(view.running)return state;
      const {field,value}=action.value||{};
      const valid=['taxi','companion','wheelchair'].includes(field)?typeof value==='boolean':
        field==='pickup'?typeof value==='string'&&value.length<=80:
        field==='pickupDay'?view.canChoosePickupDay&&['same','previous'].includes(value):
        field==='pickupTime'&&(value===''||timePattern.test(value));
      return valid?changeCoordinationPreference(state,field,value,view,caseState,action.value.pickupDay):state;
    }
    case 'coordination_scenario':
      return !view.running&&['success','taxi_unavailable','hospital_identity'].includes(action.value)?
        set({scenario:action.value,vehicleChoice:null,results:{},status:'idle',resultOpen:false}):state;
    case 'coordination_start':return beginCoordination(state,view,action.runId);
    case 'coordination_vehicle_retry':return retryVehicle(state,view,action,caseState);
    case 'coordination_stop':return current.status==='running'?set({status:'stopped',active:null}):state;
    case 'coordination_event':return receiveCoordinationEvent(state,view,action.value);
    default:return state;
  }
}
const waitFor=(ms,signal)=>new Promise((resolve,reject)=>{
  const stop=()=>{clearTimeout(timer);reject(new DOMException('Stopped','AbortError'));};
  const timer=setTimeout(()=>{signal?.removeEventListener('abort',stop);resolve();},ms);
  if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
});
/** Deterministic fixture adapter. No network, telephone, model, payment or real dispatch. */
export async function runCoordinationDemo(state,caseState,{signal,onEvent,wait=waitFor}={}) {
  const view=coordinationView(state,caseState),scenario=state.coordination?.scenario||'success';
  if(!view.running)return;
  let hospitalAccepted=view.rows.find(r=>r.id==='hospital')?.result?.status==='confirmed';
  for(const job of view.rows.filter(j=>j.enabled&&!j.result)) {
    const emit=event=>{if(!signal?.aborted)onEvent({runId:view.runId,signature:view.signature,jobId:job.id,...event});};
    if(signal?.aborted)return;
    emit({phase:'contacting'});await wait(650,signal);
    emit({phase:'waiting'});await wait(750,signal);
    let reason=null;
    if(job.id==='hospital'){
      hospitalAccepted=scenario!=='hospital_identity';
      if(!hospitalAccepted)reason='hospital_identity';
    }else if(!hospitalAccepted)reason='hospital_pending';
    else if(job.id==='taxi'&&scenario==='taxi_unavailable'&&!view.vehicleChoice)reason='vehicle_unavailable';
    const detail=reason?handoffDetails[reason]:job.detail;
    emit({phase:'result',receipt:{kind:'synthetic_booking_receipt',mode:'simulation',jobId:job.id,signature:job.signature,
      status:reason?'handoff':'confirmed',reason,provider:job.provider,date:job.date,time:job.time,reference:`DEMO-${view.runId}-${job.id}`,detail}});
  }
}
export function coordinationReport(state,caseState={}) {
  const v=coordinationView(state,caseState);
  return [`# 혼디 예약 조율 결과 · 시연`,`실제 전화·예약·배차 없음. 가상 창구의 고정 응답입니다. 실제 방문 준비 완료나 진료 수락을 뜻하지 않습니다.`,
    `선택한 문의 대상: ${v.selectedName||'미선택'}${state.usePublicData?' (공개 등록자료, 실제 회신 없음)':''}`,`예약 결과의 가상 병원: ${v.hospitalName}`,`상태: ${v.title}`,
    ...v.rows.map(r=>r.status==='not_needed'?`- ${r.title}: 이번 요청에 없음`:`- ${r.title}: ${r.status==='confirmed'?'예약 확정 (시연)':r.status==='handoff'?'직접 확인 필요':'미완료'} · ${r.result?.detail||r.detail}${r.result?` · ${r.result.provider} · ${r.result.date} ${r.result.time} · ${r.result.reference}`:''}`),
    ...(v.vehicleRecovery?[
      '## 다시 조율할 차량',`원래 요청 ${v.pickupDate} ${v.vehicleRecovery.requestedTime} · ${v.options.pickup} 출발`,
      ...(v.vehicleRecovery.offers.length?v.vehicleRecovery.offers.map(offer=>`- ${offer.time} ${offer.provider} · 시연 제안, 선택 전`):['- 요청 전후 1시간에 맞는 대체 차량 없음 · 출발 조건 또는 직접 문의']),
      ...v.vehicleRecovery.contacts.map(contact=>`- 공개 문의처 ${contact.name} · ${contact.phone} · ${contact.source.url} · 실제 배차 확인 필요`),
    ]:[]),
    ...(reportedReferralLabel(state)?[`입력한 서류 상태 · ${reportedReferralLabel(state)}`]:[]),
    `## 출발 전 직접 챙길 일`,`- 의뢰서·영상 등 병원이 요구하는 서류의 보유·발급·제출은 따로 확인하세요. 이 시연은 서류를 발급하거나 검증하지 않았습니다.`,
    ...(!v.local?['- 항공권 가격 비교·결제는 별도로 진행하세요. 도착 공항에서 병원 접수까지 제시간에 갈 수 있는지도 확인하세요.']:[]),
    '- 귀가 차량은 검사 종료 시각을 확인한 뒤 별도로 요청하세요.',
    '- 시연 시간은 흐름을 보여주는 예시이며 실제 경로 소요시간 계산이 아닙니다.',
    ...jejuDataSourceReport(state,caseState)
  ].join('\n\n');
}

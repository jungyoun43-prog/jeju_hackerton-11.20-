import {reduceAppointmentDemo} from './appointment-demo.js';
import {coordinationPlan,retainedCoordinationResults} from './care-coordination.js';
import {bookingSelectionLabel} from './appointment-flow.js';

export const RESERVATION_EDIT_SECTIONS=[['hospital','병원·진료과'],['schedule','날짜·의료진'],['support','이동·동행']];
export function reservationEditTarget(state,section='schedule') {
  if(!RESERVATION_EDIT_SECTIONS.some(([id])=>id===section))return state;
  const action=section==='hospital'?{type:'edit_intake'}:section==='support'?{type:'view',value:'support'}:{type:state.usePublicData?'public_edit_dates':'find_dates'};
  const next=reduceAppointmentDemo(state,action);
  return {...next,coordination:{...next.coordination,resultOpen:false,editing:true},...(next.usePublicData&&section==='schedule'?{jejuHospital:{...next.jejuHospital,preferencesOpen:true}}:{})};
}
export function reservationEditSummary(original,current,caseState={}) {
  const before=coordinationPlan(original,caseState);
  const choice=current.coordination?.vehicleChoice??before.vehicleChoice;
  const after=coordinationPlan({...current,coordination:{...current.coordination,vehicleChoice:choice}},caseState);
  const describe=(state,plan,job)=>!job.enabled?'요청하지 않음':job.id==='hospital'?bookingSelectionLabel(state):`${job.detail}${job.id==='taxi'&&plan.options.wheelchair?' · 휠체어 탑승':''}`;
  const changes=after.jobs.flatMap(job=>{
    const previous=before.jobs.find(j=>j.id===job.id);
    if(!job.enabled&&!previous.enabled)return [];
    if(job.enabled===previous.enabled&&job.signature===previous.signature)return [];
    return [{id:job.id,title:job.title,before:describe(original,before,previous),after:describe(current,after,job),enabled:job.enabled}];
  });
  const originalResults=retainedCoordinationResults(before.jobs,original.coordination?.results);
  const results=retainedCoordinationResults(after.jobs,originalResults);
  const preserved=Object.values(results).filter(receipt=>receipt.status==='confirmed').length;
  return {changed:changes.length>0,changes,preserved,ready:after.ready,issue:after.issue,issueControl:after.issueControl,results,vehicleChoice:after.vehicleChoice};
}
export function applyReservationEdit(original,current,caseState={}) {
  const summary=reservationEditSummary(original,current,caseState);
  if(!summary.changed)return {...original,coordination:{...original.coordination,resultOpen:false,editing:false}};
  if(!summary.ready)return null;
  return {...current,screen:'support',coordination:{...current.coordination,results:summary.results,
    vehicleChoice:summary.vehicleChoice,resultOpen:false,editing:false,status:'idle',active:null,invalidated:true}};
}

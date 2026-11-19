import {coordinationView} from './care-coordination.js';
import {needsScheduleConsultation} from './appointment-demo.js';

function visitStatus(view,consultation) {
  if(consultation)return '일정 상담 · 예약 미정';
  if(view.running)return '조율 중 · 시연';
  if(view.done)return view.handoffs?'직접 확인 필요':'조율 완료 · 시연';
  if(view.stopped)return '조율 중지 · 시연';
  return view.changed?'조건 변경 · 재확인':'준비 중';
}

// Read only: opening a dashboard never starts coordination or invents a reservation.
export function reservationOverview(drafts={},caseState={}) {
  const visits=['jeju','seoul'].flatMap(region=>{
    const state=drafts[region];if(!state)return [];
    const view=coordinationView(state,caseState);
    const consultation=needsScheduleConsultation(state);
    return [{region,label:region==='jeju'?'제주 진료':'내륙 진료',state,view,consultation,
      status:visitStatus(view,consultation),
      date:view.date||null,time:view.time||null,confirmed:view.confirmed,handoffs:view.handoffs,
      selectedName:view.selectedName||'병원을 선택해 주세요'}];
  });
  return {visits,confirmed:visits.reduce((n,v)=>n+v.confirmed,0),handoffs:visits.reduce((n,v)=>n+v.handoffs,0)};
}

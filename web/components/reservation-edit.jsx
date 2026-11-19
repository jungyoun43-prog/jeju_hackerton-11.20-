'use client';
import {ArrowLeft,ArrowRight,Check,Pencil} from 'lucide-react';
import {useAppointment,Action} from './appointment-context';
import {RESERVATION_EDIT_SECTIONS} from '../../app/reservation-edit.js';
import {bookingSelectionLabel} from '../../app/appointment-flow.js';

export function ReservationEditHeader() {
  const {edit,state}=useAppointment();
  if(state.screen==='reservation_review')return null;
  return <div className="reservation-edit-header"><p>변경을 적용하기 전까지 기존 예약은 유지돼요.</p><nav className="reservation-edit-tabs" aria-label="예약 수정 항목">{RESERVATION_EDIT_SECTIONS.map(([section,label])=><Action key={section} action="reservation_edit_section" value={section} variant="ghost" selected={edit.section===section} aria-current={edit.section===section?'page':undefined}>{label}</Action>)}</nav></div>;
}
export function ReservationEditReview() {
  const {editSummary:summary}=useAppointment();
  return <section className="reservation-edit-review" aria-label="예약 변경 전후"><div className="reservation-change-list">{summary.changes.map(row=><section key={row.id} data-edit-change={row.id}><h3>{row.title}<span>{row.enabled?'다시 조율':'요청에서 제외'}</span></h3>{row.before===row.after?<p className="appointment-note">{row.after} · 진료 일정 변경으로 다시 확인해요.</p>:<dl><div><dt>변경 전</dt><dd>{row.before}</dd></div><div><dt>변경 후</dt><dd>{row.after}</dd></div></dl>}</section>)}</div><p>변경한 예약과 연결된 차량·동행만 다시 조율해요.{summary.preserved>0&&` 기존 ${summary.preserved}건은 그대로 유지합니다.`}</p><p className="appointment-note">가상 예약을 변경하는 시연입니다. 실제 기관 예약이나 취소는 실행하지 않아요.</p></section>;
}
export function ReservationEditFooter() {
  const {state,edit,editSummary:summary,coordination}=useAppointment();
  const review=state.screen==='reservation_review';
  const correction=summary.changed&&summary.issueControl;
  const action=correction?'coordination_fix_issue':review?'reservation_edit_apply':'reservation_edit_review';
  const label=correction?(summary.issueControl==='flight-outbound'?'가는 날 수정':'출발 조건 수정'):review?(coordination.done?'변경 적용':'변경 적용·다시 조율'):'변경 내용 확인';
  return <div className="hondi-react booking-footer reservation-edit-footer"><div className="booking-footer-context"><span className="booking-footer-step"><Pencil/>예약 수정 중</span><p className="booking-footer-selection">{bookingSelectionLabel(state)}</p><p id="booking-next-hint" className="booking-footer-hint" role="status">{!summary.changed?'수정할 항목을 위에서 골라 주세요.':summary.issue||`${summary.changes.length}개 항목 변경 · 적용 전까지 기존 예약 유지`}</p></div><div className="booking-footer-buttons"><Action action={review?'reservation_edit_section':'reservation_edit_cancel'} value={review?edit.section:undefined} variant="ghost"><ArrowLeft/>{review?'수정 계속':'수정 취소'}</Action><Action action={action} primary disabled={!summary.changed||(!summary.ready&&!correction)} data-book-primary="true" aria-describedby="booking-next-hint">{label}{review?<Check/>:<ArrowRight/>}</Action></div></div>;
}

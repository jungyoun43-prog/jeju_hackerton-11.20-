'use client';
import { useEffect, useRef } from 'react';
import { ko } from 'date-fns/locale';
import { Calendar } from './ui/calendar';
import { Button } from './ui/button';
import { useAppointment, Action, Note } from './appointment-context';
import { APPOINTMENT_MONTHS, APPOINTMENT_REFERENCE_DATE, appointmentCalendar, appointmentDay, appointmentSlots, appointmentSelection, nextAppointmentDate, referralDisposition, availabilityDay, availableAppointments, preferredDateReady, nextMatchingDate } from '../../app/appointment-demo.js';
export const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const parseDay=value=>value?new Date(`${value}T12:00:00`):undefined;
export const dateLabel=value=>value?new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short'}).format(parseDay(value)):'';
const labels={available:'빈자리 있음',full:'마감',unpublished:'일정 미공개',past:'지난 날짜',closed:'시연 휴진일'};
function DayButton({day,modifiers,children,...props}) {
  const {state}=useAppointment(),date=dateKey(day.date),status=state.screen==='availability'?availabilityDay(state,date):appointmentDay(state.doctorId,date),ref=useRef(null);
  useEffect(()=>{if(modifiers.focused)ref.current?.focus({preventScroll:true});},[modifiers.focused]);
  return <Button {...props} ref={ref} type="button" variant="ghost" className={`appointment-day is-${status}`} data-book-action={state.screen==='availability'?'preferred_date':'date'} data-book-value={date} data-range-middle={Boolean(modifiers.range_middle)} aria-label={`${date} ${labels[status]}`} aria-pressed={Boolean(modifiers.selected)}><span>{day.date.getDate()}</span><small aria-hidden="true">{status==='available'?'가능':status==='full'?'마감':status==='unpublished'?'—':''}</small></Button>;
}
export function AppointmentAvailability() {
  const {state,onAction}=useAppointment(),results=availableAppointments(state),ready=preferredDateReady(state),next=nextMatchingDate(state);
  const days=[...new Set(results.map(item=>item.date))],doctors=new Set(results.map(item=>item.doctor.id)).size;
  const selection=appointmentSelection(state),range=state.dateMode==='range';
  const selected=range?(state.preferredFrom?{from:parseDay(state.preferredFrom),to:parseDay(state.preferredTo)}:undefined):parseDay(state.preferredFrom);
  const summary=!state.preferredFrom?'가능한 의료진·시간':!ready?'종료 날짜를 선택해 주세요':range&&state.preferredFrom!==state.preferredTo?`${dateLabel(state.preferredFrom)} – ${dateLabel(state.preferredTo)}`:dateLabel(state.preferredFrom);
  const monthHasTime=appointmentCalendar(state.month).some(date=>date&&availabilityDay(state,date)==='available');
  return <section className="appointment-section appointment-availability" aria-label="희망 날짜로 의료진 찾기">
    <div className="availability-controls">
      <div className="availability-context"><span>{selection.hospital?.name} · {state.department}</span><Action action="back" variant="link">병원·진료과 변경</Action></div>
      <div className="date-preference-toolbar"><div className="date-mode" role="group" aria-label="희망 날짜 선택 방식">
        <Action action="preferred_mode" value="single" selected={!range} variant="ghost">하루 선택</Action>
        <Action action="preferred_mode" value="range" selected={range} variant="ghost">기간 선택</Action>
      </div></div>
      {range&&<p className="range-instruction" role="status">{state.preferredFrom&&!state.preferredTo?`${dateLabel(state.preferredFrom)}부터 갈 수 있어요. 종료일을 눌러 주세요.`:'시작일과 종료일을 차례로 눌러 주세요.'}</p>}
    </div>
    <div className="availability-layout"><div className="availability-calendar-panel">
    <Calendar className="appointment-calendar preference-calendar" mode={range?'range':'single'} locale={ko} weekStartsOn={0} showOutsideDays={false} today={parseDay(APPOINTMENT_REFERENCE_DATE)} month={parseDay(`${state.month}-01`)} selected={selected} startMonth={parseDay(`${APPOINTMENT_MONTHS[0]}-01`)} endMonth={parseDay(`${APPOINTMENT_MONTHS.at(-1)}-01`)} onMonthChange={date=>onAction('preferred_month',dateKey(date).slice(0,7))} onSelect={(_,day)=>onAction('preferred_date',dateKey(day),document.activeElement)} disabled={{before:parseDay(APPOINTMENT_REFERENCE_DATE)}} components={{DayButton}} labels={{labelPrevious:()=> '이전 달',labelNext:()=> '다음 달'}} />
    <p className="availability-legend">가능: 공개된 시간 있음 · 마감: 공개된 시간 마감 · —: 일정 미공개</p>
    {!monthHasTime&&!state.preferredFrom&&<p className="appointment-month-empty">이달에는 공개된 빈자리가 없어요.</p>}
    </div><section className="availability-results" aria-labelledby="availability-result-title">
      <div className="availability-result-heading"><h3 id="availability-result-title" tabIndex={-1}>{summary}</h3><p role="status" aria-live="polite">{ready?`${doctors}명 · ${results.length}개 시간`:'달력에서 희망 날짜를 고르면 시간표가 열려요.'}</p></div>
      {!state.preferredFrom&&next&&<div className="availability-first-date"><Action action="next_match" variant="outline">{dateLabel(next)} 첫 빈자리 보기</Action></div>}
      {ready&&results.length===0&&<div className="appointment-empty"><strong>이 날짜에는 공개된 빈자리가 없어요</strong><p>미공개 일정은 병원에 확인이 필요해요. 날짜나 기간을 바꿔 다시 볼 수 있어요.</p>{next&&<Action action="next_match" variant="link">{dateLabel(next)} 다음 빈자리 보기</Action>}</div>}
      {days.map(date=><section key={date} className="availability-date" aria-label={dateLabel(date)}>{days.length>1&&<h4>{dateLabel(date)}</h4>}{[...new Set(results.filter(item=>item.date===date).map(item=>item.doctor.id))].map(id=>{
        const slots=results.filter(item=>item.date===date&&item.doctor.id===id),doctor=slots[0].doctor;
        return <div key={id} className="availability-doctor"><div><strong>{doctor.name}</strong><span>{doctor.department} · 가상</span></div><div className="availability-slots">{slots.map(slot=><Action key={slot.key} action="slot" value={slot.key} selected={state.doctorId===id&&state.date===date&&state.time===slot.time} aria-label={`${dateLabel(date)} ${doctor.name} ${slot.time}`}><time>{slot.time}</time></Action>)}</div></div>;
      })}</section>)}
    </section>
    </div>
    <Action action="consult" variant="link" className="appointment-consult">원하는 일정이 없어요 · 예약 상담 준비</Action>
    <Note>2026년 11월 15일 기준의 고정 시연 시간표입니다. 실제 빈자리나 의료진 추천 순위가 아니며, 진료 적합성·접수 가능 여부는 병원에 확인해요.</Note>
  </section>;
}
export function AppointmentCalendar() {
  const {state,onAction}=useAppointment(),slots=appointmentSlots(state.doctorId,state.date),next=nextAppointmentDate(state.doctorId);
  const available=appointmentCalendar(state.month).some(date=>date && appointmentDay(state.doctorId,date)==='available');
  return <section className="appointment-section" aria-label="월별 진료 일정"><div className="appointment-schedule-layout"><div className="appointment-month-panel"><Calendar className="appointment-calendar" mode="single" locale={ko} weekStartsOn={0} showOutsideDays={false} today={parseDay(APPOINTMENT_REFERENCE_DATE)} month={parseDay(`${state.month}-01`)} selected={parseDay(state.date)} startMonth={parseDay(`${APPOINTMENT_MONTHS[0]}-01`)} endMonth={parseDay(`${APPOINTMENT_MONTHS.at(-1)}-01`)} onMonthChange={date=>onAction('month',dateKey(date).slice(0,7))} onSelect={date=>{if(date)onAction('date',dateKey(date),document.activeElement);}} disabled={date=>['past','closed'].includes(appointmentDay(state.doctorId,dateKey(date)))} components={{DayButton}} labels={{labelPrevious:()=> '이전 달',labelNext:()=> '다음 달'}} />
    <div className="appointment-calendar-legend"><span>● 빈자리</span><span>× 마감</span><span>— 미공개</span></div>
    {!available&&<div className="appointment-month-empty"><strong>이달에는 공개된 빈자리가 없어요</strong><p>다른 달을 보거나 예약 창구에 취소 자리·다른 의료진의 일정을 문의해요.</p>{next&&<Action action="next_available" variant="secondary">{dateLabel(next)} 첫 시연 빈자리 보기</Action>}</div>}
  </div><div className="appointment-time-panel"><h3>{state.date?dateLabel(state.date):'진료받을 날짜를 골라 주세요'}</h3><Note>한국 시각 · 선택 가능한 시연 시간</Note><div className="appointment-times">{slots.length?['오전','오후'].map((period,index)=>{
    const items=slots.filter(slot=>(Number(slot.time.slice(0,2))<12)===(index===0));
    return <fieldset key={period}><legend>{period}</legend><div>{items.length?items.map(slot=><Action key={slot.time} action="time" value={slot.time} disabled={!slot.available} selected={state.time===slot.time}>{slot.time}<span>{slot.available?'선택 가능':'마감'}</span></Action>):<span className="appointment-note">공개 시간 없음</span>}</div></fieldset>;
  }):<div className="appointment-empty"><strong>{state.date?'이 날짜의 공개된 시간이 없어요':'날짜를 선택하면 시간이 보여요'}</strong><p>미공개 일정은 예약 창구에서 확인해 주세요.</p></div>}</div></div></div>
  <p className="appointment-calendar-scope">2026년 11월 15일 기준의 고정 체험입니다. 실제 병원의 대기기간 통계·빈자리를 보여주는 화면은 아니에요.</p>
  <Action action="consult" variant="link" className="appointment-consult">원하는 시간이 없어요 · 예약 상담 준비</Action><Note>취소 자리 안내·대기 접수 가능 여부를 문의할 수 있어요. 이 화면에서 실제 대기 명단에 등록되지는 않아요.</Note>
  </section>;
}

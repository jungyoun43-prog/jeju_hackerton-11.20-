'use client';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ArrowRight, ArrowLeft, ArrowDown, Hospital, FileText, CalendarDays, Check, Circle, CircleAlert, Download, ChevronRight } from 'lucide-react';
import { SearchPicker } from './search-picker';
import { AppointmentContext, useAppointment, Action, Note } from './appointment-context';
import { AppointmentCalendar, AppointmentAvailability, dateLabel } from './appointment-calendar';

import { DepartmentPicker } from './department-picker';
import { PublicDataMode, PublicHospitalFinder, PublicHospitalDates, PublicHospitalReview } from './jeju-public-booking';
import { APPOINTMENT_DOCTORS, APPOINTMENT_BOUNDARY, APPOINTMENT_SOURCES, VISIT_TYPES, intakeComplete, referralDisposition, appointmentSelection, appointmentPreparation, nextAppointmentDate, appointmentStatus, canReviewAppointment, regionHospitals, appointmentRegion, appointmentRegionLabel, needsScheduleConsultation } from '../../app/appointment-demo.js';
import {bookingSteps,bookingStep,bookingNext,bookingSelectionLabel} from '../../app/appointment-flow.js';
import {publicHospitalReady} from '../../app/jeju-appointment-data.js';
import {Coordination} from './care-coordination';
import {coordinationView} from '../../app/care-coordination.js';
import {reservationEditSummary} from '../../app/reservation-edit.js';
import {ReservationEditHeader,ReservationEditReview,ReservationEditFooter} from './reservation-edit';


function Policy() {
  const {state}=useAppointment();
  return <details className="appointment-policy"><summary>{state.region==='jeju'?'상급종합병원으로 의뢰받을 때 참고':'진료의뢰서와 예약 절차 안내'}</summary><Note>처음 가는 상급종합병원·진료과의 접수와 건강보험 적용 요건을 확인해요. 판독문·영상은 진료의뢰서를 대신하지 않습니다. 예약 가능 여부와 의뢰서 제출·급여 요건은 별개이며, 재진·예외·의료급여 등은 병원에 확인해요.</Note>{APPOINTMENT_SOURCES.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label}<ChevronRight aria-hidden="true"/></a>)}<Note>실제 병원의 공개 절차를 참고한 안내입니다. 가상 병원의 정책이나 개인별 적용을 확인한 결과는 아니에요.</Note></details>;
}
function Referral() {
  const {state}=useAppointment(),referral=referralDisposition(state),local=appointmentRegion(state)==='jeju';
  return <section className="appointment-referral"><div><strong>{local?'접수·준비 서류':'진료의뢰서'}</strong><span className="appointment-referral-state">{referral.label}</span>{state.screen!=='review'&&<Action action="edit_referral" variant="ghost">응답 수정</Action>}</div><p>{referral.next}</p><small>보유·제출 응답은 실제 문서나 병원 접수를 확인한 뜻이 아니에요.</small></section>;
}
function Records() {
  const {caseState,state}=useAppointment(),prep=appointmentPreparation(caseState,state);
  return <section className="appointment-section">{state.usePublicData?<Note>선택한 병원에 초진·재진 접수와 준비 서류를 확인해 주세요. 아래 기록은 기존 합성 사례의 자료입니다.</Note>:<Referral/>}<h3>기존 준비에 등록된 자료</h3><dl className="appointment-records">{prep.documents.map(doc=><div key={doc.id}><dt>{doc.label}</dt><dd>{doc.ready?'합성 자료 보유':'기존 준비에서 미확보'}</dd></div>)}</dl><Note>이 화면의 보유 응답으로 문서를 발급하거나 등록하지 않아요. 영상·판독문·치료 이력은 진료 참고 자료로 따로 챙겨요.</Note><Policy/></section>;
}
function Filters() {
  const {state,onAction}=useAppointment();
  return <div className="appointment-filters"><SearchPicker id="appointment-hospital" label="진료받을 병원" value={state.hospitalId} options={regionHospitals(appointmentRegion(state)).map(h=>({value:h.id,label:`${h.name} (가상)`}))} onChange={value=>onAction('hospital',value,document.getElementById('appointment-hospital'))}/><DepartmentPicker/></div>;
}
function OptionGroup({legend,action,options,selected}) {
  return <fieldset className="appointment-intake-group"><legend>{legend}</legend><div>{options.map(([value,label])=><Action key={value} action={action} value={value} selected={selected===value} className="appointment-option">{selected===value?<Check aria-hidden="true"/>:<Circle aria-hidden="true"/>}<span>{label}</span></Action>)}</div></fieldset>;
}
function Intake() {
  return <div className="appointment-intake"><p className="booking-stage-intro">진료받을 병원과 진료과를 고르세요.</p><Filters/><Note>다음 단계에서 희망 날짜에 가능한 의료진과 시간을 비교해요. 초진·재진과 진료의뢰서는 일정을 고른 뒤 확인합니다.</Note></div>;
}
function IntakeQuestions() {
  const {state}=useAppointment(),local=state.region==='jeju',followup=state.visitType==='followup';
  const answers=followup?[['submitted','전에 의뢰서를 제출했어요'],['missing','새 의뢰서가 필요한데 없어요'],['unknown','이번에도 필요한지 모르겠어요']]:[['reported','진료의뢰서를 가지고 있어요'],['missing','아직 진료의뢰서가 없어요'],['unknown','준비 여부를 확인해야 해요']];
  return <section className="booking-intake-questions"><OptionGroup legend="이번 병원·진료과 방문은 어떤 경우인가요?" action="visit_type" selected={state.visitType} options={Object.entries(VISIT_TYPES)}/>{state.visitType&&(local?<details className="appointment-policy"><summary>의뢰받은 진료인가요? · 서류 상태 남기기</summary><OptionGroup legend="진료의뢰서 보유 상태 · 선택" action="referral" selected={state.referralStatus} options={answers}/></details>:<OptionGroup legend={followup?'기존 의뢰서 제출 상태는 어떤가요?':'진료의뢰서(요양급여의뢰서)를 준비하셨나요?'} action="referral" selected={state.referralStatus} options={answers}/>)}{intakeComplete(state)&&<Referral/>}<Policy/></section>;
}
function Doctors() {
  const {state}=useAppointment();
  return <><Filters/><div className="appointment-doctors">{APPOINTMENT_DOCTORS.filter(doctor=>doctor.hospitalId===state.hospitalId && doctor.department===state.department).map(doctor=>{
    const next=nextAppointmentDate(doctor.id);
    return <article key={doctor.id} className="appointment-doctor"><div><span className="doctor-department-label">{doctor.department}</span><h3>{doctor.name} <span>의료진</span></h3><p>{doctor.description}</p></div><div className="appointment-doctor-time"><span>{next?'첫 시연 빈자리':'일정 미공개'}</span><strong>{next?dateLabel(next):'예약 상담 후 안내'}</strong><Action action="doctor" value={doctor.id} variant="secondary">월별 일정<ChevronRight/></Action></div></article>;
  })}</div><Note>가상 의료진입니다. 진료과·의료진의 적합성과 실제 진료 수락은 병원·의료진에게 확인해요.</Note><div className="appointment-action-line"><Action action="back" variant="ghost"><ArrowLeft/>접수 조건 다시 확인</Action><Action action="consult" variant="outline">첫방문 예약 상담 준비</Action></div></>;
}
function Selection() {
  const {state}=useAppointment(),{hospital,doctor,date,time}=appointmentSelection(state);
  return <div className="appointment-selection"><div><Hospital aria-hidden="true"/><div><strong>{hospital?.name}</strong><span>{doctor?`${doctor.department} · ${doctor.name}`:'의료진은 상담 후 확인'} · 가상</span></div></div>{date&&time&&<p><CalendarDays aria-hidden="true"/><strong>{dateLabel(date)} {time}</strong><span>희망 시각 · 한국 시각</span></p>}</div>;
}
function Review() {
  const {state}=useAppointment();
  if(needsScheduleConsultation(state)){
    const from=state.preferredFrom, to=state.preferredTo;
    return <section className="appointment-section" aria-label="일정 상담 메모">
      <h3>{appointmentSelection(state).hospital.name} · {state.department}</h3>
      <p>희망 날짜 <strong>{from?dateLabel(from):'미정'}{to&&to!==from&&` – ${dateLabel(to)}`}</strong></p>
      <p>예약 창구에 이 날짜의 추가 진료 시간이나 대기 접수가 가능한지 문의하세요. 진료 시각이 정해지면 차량과 동행을 맞출 수 있어요.</p>
      <div className="appointment-action-line"><Action action="find_dates" variant="outline"><CalendarDays/>다른 날짜·의료진 찾기</Action><Action action="save" variant="ghost"><Download/>상담 준비표 저장</Action></div>
      <details className="compact-disclosure"><summary>접수·서류 조건 남기기</summary><IntakeQuestions/></details>
    </section>;
  }
  return <><Selection/><section className="appointment-section"><h3>예약 창구 확인은 혼디에게 맡기세요</h3><Note>접수 방법·필요 서류·희망 일정을 함께 확인하는 흐름을 체험해요. 다음 화면에서 차량과 동행도 함께 맡길 수 있어요.</Note><details className="compact-disclosure"><summary>알고 있는 접수·서류 조건 남기기 · 선택</summary><IntakeQuestions/></details></section></>;
}
function Result() {
  const {state}=useAppointment(),pending=['requested_demo','consultation_requested_demo'].includes(state.status),consult=state.status==='consultation_requested_demo',local=appointmentRegion(state)==='jeju';
  return <><div className="appointment-result-state" role="status"><CircleAlert aria-hidden="true"/><div><strong>{appointmentStatus(state)}</strong><p>{pending?'병원에 실제 전송하지 않았어요. 아래에서 회신 상황을 체험할 수 있어요.':'병원 회신 상황의 합성 시연입니다. 실제 병원 예약은 만들어지지 않았어요.'}</p></div></div><Selection/>{pending&&<div className="appointment-replies">{!consult&&<Action action="reply" value="confirm">확정 회신 체험</Action>}<Action action="reply" value="documents">{local?'서류':'의뢰서'} 보완 안내 체험</Action><Action action="reply" value="change">다른 일정 안내 체험</Action></div>}<div className="appointment-action-line"><Action action={state.status==='documents_needed_demo'?'edit_referral':'edit'} variant="ghost">{state.status==='documents_needed_demo'?(local?'서류 준비 다시 확인':'의뢰서 준비 다시 확인'):'일정 다시 확인'}</Action></div><div className="appointment-completion-links"><Action action="view" value="records" variant="outline"><FileText/>의뢰서·자료 확인</Action><Action action="save" variant="outline"><Download/>{appointmentRegionLabel(state)} 진료 준비표 저장</Action></div>{local&&<section className="appointment-next-region"><h3>내륙 진료도 준비해야 하나요?</h3><Note>의료진과 도외 진료·의뢰를 상의했다면 내륙 예약 준비를 이어가세요. 제주 일정은 이 탭에 남아 있어요.</Note><Action action="region" value="seoul" variant="outline">내륙 예약 준비 열기<ArrowRight/></Action></section>}</>;
}
function Workspace() {
  const {state,edit}=useAppointment(),local=appointmentRegion(state)==='jeju';
  const titles={intake:`${appointmentRegionLabel(state)} 병원·진료과 선택`,public_find:'제주 병원·진료과 선택',public_dates:'희망 의료진·시간 선택',public_review:'병원에 문의할 내용 확인',doctors:`${state.department} 의료진`,schedule:'진료 일정',availability:'의료진·시간 선택',review:'선택한 진료·접수 조건 확인',result:'예약 접수와 다음 준비',records:'진료의뢰서·참고 자료',support:'AI 예약·결과'};
  const View={intake:Intake,public_find:PublicHospitalFinder,public_dates:PublicHospitalDates,public_review:PublicHospitalReview,doctors:Doctors,schedule:AppointmentCalendar,availability:AppointmentAvailability,review:Review,result:Result,records:Records,support:Coordination,reservation_review:ReservationEditReview}[state.screen];
  if(needsScheduleConsultation(state))titles.review='일정 상담 메모';
  if(edit)return <div className="hondi-react reservation-edit-workspace" data-appointment-screen={state.screen}><div className="appointment-topline"><h2 id="appointment-title" tabIndex={-1}>{state.screen==='reservation_review'?'변경 내용 확인':'예약 수정'}</h2><Action action="reservation_edit_cancel" variant="ghost">수정 취소</Action></div><ReservationEditHeader/><View/></div>;
  const findingHospital=state.screen==='public_find';
  let boundary=APPOINTMENT_BOUNDARY;
  if(state.screen==='support') boundary='예약 시연 · 실제 전화·예약·배차는 하지 않아요.';
  else if(findingHospital) boundary='제주 공개자료로 진료를 준비하는 시연입니다.';
  else if(state.usePublicData) boundary='제주 공개자료로 병원과 희망 일정을 골라요. 실제 예약은 아직 없어요.';
  return <div className="hondi-react" data-appointment-screen={state.screen}>
    <div className="appointment-topline">
      <h2 id="appointment-title" tabIndex={-1}>{titles[state.screen]}</h2>
      <div className="appointment-back-actions">
        {!findingHospital&&<Action action="home" variant="ghost"><ArrowLeft/>병원 지역 선택</Action>}
        {state.quickEntry
          ? <Action action="entry_summary" variant="ghost">요청 요약·빠진 내용</Action>
          : <Action action="methods" variant="ghost" aria-label="준비 방식 바꾸기">{findingHospital?'방식 변경':'준비 방식 바꾸기'}</Action>}
      </div>
    </div>
    <p className="appointment-boundary">{boundary}</p>
    {state.recheck&&state.screen!=='support'&&<p className="appointment-recheck" role="status">일정 변경 · {local?'접수·이동·동행':'접수·항공·이동·동행'}을 다시 확인해 주세요.</p>}
    {state.screen==='schedule'&&<Selection/>}
    <View/>
  </div>;
}
function Navigation() {
  const {state,edit,coordination:coord}=useAppointment();
  if(edit)return null;
  const step=bookingStep(state),steps=bookingSteps(state),consultation=needsScheduleConsultation(state);
  let supportDetail='병원·차량·동행을 한 번에 맡기기';
  if(consultation)supportDetail='진료 시각을 고른 뒤 조율';
  else if(coord.done)supportDetail=`${coord.confirmed}건 예약 완료 · 시연${coord.handoffs?` · ${coord.handoffs}건 직접 확인`:''}`;
  else if(coord.running)supportDetail='혼디가 예약 조율 중';
  else if(coord.stopped)supportDetail='중지한 조율 이어보기';
  const rows=[
    {action:'edit_intake',detail:coord.selectedName || '병원을 선택해 주세요'},
    {action:state.usePublicData?'public_edit_dates':'find_dates',detail:state.usePublicData?(state.jejuHospital.from || '하루 또는 희망 기간 선택'):state.time?`${dateLabel(state.date)} ${state.time}`:'날짜별 의료진·빈자리 비교',disabled:state.usePublicData&&!publicHospitalReady(state.jejuHospital)},
    {action:'summary',detail:coord.done?'요청한 내용 보기':'병원·서류 조건 확인',disabled:!canReviewAppointment(state)},
    {action:'view',value:'support',disabled:consultation,detail:supportDetail}
  ];
  return <div className="hondi-react"><div className="preparation-heading"><h2>{appointmentRegionLabel(state)} 진료 준비</h2><p className="preparation-note">조건 선택 → 혼디가 조율 → 결과</p></div><nav className="appointment-nav" aria-label={`${appointmentRegionLabel(state)} 진료 준비 단계`}>{rows.map((row,index)=><Action key={index} action={row.action} value={row.value} selected={step===index+1&&state.screen!=='records'} aria-current={step===index+1&&state.screen!=='records'?'step':undefined} variant="ghost" disabled={row.disabled}><i className="booking-nav-number">{index+1}</i><span><strong>{steps[index]}</strong><small>{row.detail}</small></span><ChevronRight aria-hidden="true"/></Action>)}</nav><Action action="view" value="records" variant="link" className="booking-records-link"><FileText/>준비 서류 보기</Action><details className="appointment-utility"><summary>이용 안내·다른 준비 방식</summary>{state.region==='jeju'&&step===1&&<PublicDataMode/>}<p>선택한 내용은 이 탭에서 이어볼 수 있어요. 새로고침하면 응답과 계획은 사라집니다.</p><Action action="close" variant="ghost">대화·자료 준비 열기</Action></details><p className="preparation-boundary">결과에 체크되면 맡긴 시연이 끝나요.<br/>실제 예약은 별도 기관 연결이 필요해요.</p></div>;
}
function Footer() {
  const {state,caseState,edit,coordination}=useAppointment();
  if(edit)return <ReservationEditFooter/>;
  const next=bookingNext(state,caseState,coordination),step=bookingStep(state),summary=bookingSelectionLabel(state),steps=bookingSteps(state);
  const withinStep=['public_show_preferences','show_times'].includes(next.action);
  const back=state.screen==='records'?'resume':state.screen==='support'?(canReviewAppointment(state)?'summary':'resume'):step===1?'home':state.screen==='public_review'?'public_edit_dates':state.screen==='result'?'find_dates':'back';
  return <div className="hondi-react booking-footer"><div className="booking-footer-context"><span className="booking-footer-step">{step} / 4 · {steps[step-1]}</span><p className="booking-footer-selection">{summary || '아직 선택한 병원이 없어요'}</p><p id="booking-next-hint" className="booking-footer-hint" role="status">{next.hint}</p></div><div className="booking-footer-buttons"><Action action={back} variant="ghost" aria-label={step===1?'병원 지역 선택으로':'이전 단계'}><ArrowLeft/><span>{state.screen==='public_find'?'지역 선택':'이전'}</span></Action><Action action={next.action} value={next.value} primary={!withinStep} variant="outline" data-role={withinStep?'within-step':'next-step'} disabled={next.disabled} aria-describedby="booking-next-hint" data-book-primary="true">{withinStep?(next.action==='show_times'?'의료진·시간 목록 보기':'시간 조건 선택하기'):next.label}{withinStep?<ArrowDown/>:['save','coordination_save'].includes(next.action)?<Download/>:<ArrowRight/>}</Action></div></div>;
}
const roots=new WeakMap();
export function renderAppointment(state,caseState,onAction,edit=null) {
  const needsCoordination=!edit||state.screen==='support'||state.screen==='reservation_review';
  const context={
    state,caseState,onAction,edit,
    coordination:needsCoordination?coordinationView(state,caseState):null,
    editSummary:edit?reservationEditSummary(edit.original,state,caseState):null,
  };
  flushSync(()=>{
    for(const [id,Component] of [['appointment-workspace',Workspace],['appointment-navigation',Navigation],['appointment-actions',Footer]]) {
      const host=document.getElementById(id);
      if(!host)continue;
      if(!roots.has(host))roots.set(host,createRoot(host));
      roots.get(host).render(<AppointmentContext.Provider value={context}><Component/></AppointmentContext.Provider>);
    }
  });
}

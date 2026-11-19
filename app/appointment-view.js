import { APPOINTMENT_HOSPITALS, APPOINTMENT_DOCTORS, APPOINTMENT_MONTHS, APPOINTMENT_REFERENCE_DATE, APPOINTMENT_BOUNDARY, APPOINTMENT_SOURCES, VISIT_TYPES, appointmentSlots, appointmentSelection, appointmentStatus, appointmentPreparation, appointmentCalendar, appointmentDay, nextAppointmentDate, intakeComplete, referralDisposition, canReviewAppointment } from './appointment-demo.js';
import { escapeHtml as escape } from './message-format.js';
import { icon } from './icons.js';
import { APPOINTMENT_DEPARTMENTS } from './appointment-departments.js';

const dateLabel=date=>new Intl.DateTimeFormat('ko-KR',{month:'long',day:'numeric',weekday:'short',timeZone:'Asia/Seoul'}).format(new Date(date+'T12:00:00+09:00'));
const button=(action,label,{value='',className='',disabled=false,pressed,ariaLabel}={})=>`<button type="button" data-book-action="${action}" data-book-value="${escape(value)}" class="${className}" ${disabled?'disabled':''} ${ariaLabel?`aria-label="${escape(ariaLabel)}"`:''} ${pressed===undefined?'':`aria-pressed="${pressed}"`}>${label}</button>`;
const primary=(action,label,options={})=>button(action,label,{...options,className:'appointment-primary'});
const note=text=>`<p class="appointment-note">${escape(text)}</p>`;

function policyMarkup() {
  return `<details class="appointment-source appointment-policy"><summary>진료의뢰서·첫방문 안내${icon('chevron')}</summary><p>상급종합병원 건강보험 진료에서는 진료의뢰서 준비를 먼저 확인해요. 의뢰서 미준비가 모든 예약의 불가를 뜻하지는 않으며, 예외·의료급여·제출 시점은 병원에 확인해야 해요.</p><p>같은 병원의 재진과 새 병원·다른 진료과의 초진을 구분해요. 판독문·영상은 진료 참고 자료이며 진료의뢰서를 대신하지 않아요.</p>${APPOINTMENT_SOURCES.map(source=>`<a href="${escape(source.url)}" target="_blank" rel="noopener noreferrer">${escape(source.label)}${icon('external')}</a>`).join('')}<p>2026-11-15 공식 안내 확인 · 아래 가상 기관의 개별 정책을 검증한 것은 아니에요.</p></details>`;
}
function referralMarkup(state) {
  const referral=referralDisposition(state);
  return `<section class="appointment-referral" aria-label="진료의뢰서와 접수 준비"><div><strong>진료의뢰서 · ${escape(referral.label)}</strong>${button('edit_intake','응답 수정')}</div><p>${escape(referral.next)}</p><small>보유·기존 제출 응답은 실제 문서·병원 접수를 검증한 뜻이 아니에요.</small></section>`;
}
function recordsMarkup(state,caseState) {
  const {documents}=appointmentPreparation(caseState);
  return `<section class="appointment-section" aria-label="내륙 진료 접수와 자료"><h3>진료의뢰서와 접수 조건을 먼저 챙겨요</h3>${referralMarkup(state)}<h3>기존 준비에 등록된 자료</h3><dl class="appointment-records">${documents.map(doc=>`<div><dt>${escape(doc.label)}</dt><dd>${doc.ready?'합성 자료 보유':'기존 준비에서 미확보'}</dd></div>`).join('')}</dl>${note('이 화면의 보유 응답으로 기존 문서를 새로 만들거나 등록하지 않아요. 판독문·영상, 치료 이력은 진료 참고용으로 따로 준비하고, 제출 항목·영상 등록 시점은 병원에 확인해요.')}${policyMarkup()}</section>`;
}
function filtersMarkup(state) {
  return `<div class="appointment-filters"><label for="appointment-hospital">진료받을 병원<select id="appointment-hospital">${APPOINTMENT_HOSPITALS.map(hospital=>`<option value="${hospital.id}" ${state.hospitalId===hospital.id?'selected':''}>${escape(hospital.name)} (가상)</option>`).join('')}</select></label><label for="appointment-department">진료과<select id="appointment-department">${APPOINTMENT_DEPARTMENTS.map(department=>`<option ${state.department===department.name?'selected':''}>${escape(department.name)}</option>`).join('')}</select></label></div>`;
}
function intakeMarkup(state) {
  const followup=state.visitType==='followup',ready=intakeComplete(state),referral=referralDisposition(state);
  const types=[['first','처음 가는 병원·진료과예요'],['followup','같은 병원·같은 과 재진이에요'],['unknown','초진·재진을 확인해야 해요']];
  const answers=followup?[['submitted','전에 의뢰서를 제출했어요'],['missing','새 의뢰서가 필요한데 없어요'],['unknown','이번에도 필요한지 모르겠어요']]:[['reported','진료의뢰서를 가지고 있어요'],['missing','아직 진료의뢰서가 없어요'],['unknown','준비 여부를 확인해야 해요']];
  return `${filtersMarkup(state)}<fieldset class="appointment-intake-group"><legend>이번 병원·진료과 방문은 어떤 경우인가요?</legend><div>${types.map(([value,label])=>button('visit_type',label,{value,pressed:state.visitType===value})).join('')}</div></fieldset>${state.visitType?`<fieldset class="appointment-intake-group"><legend>${followup?'기존 의뢰서 제출 상태는 어떤가요?':'진료의뢰서(요양급여의뢰서)를 준비하셨나요?'}</legend><div>${answers.map(([value,label])=>button('referral',label,{value,pressed:state.referralStatus===value})).join('')}</div></fieldset>`:''}${ready?referralMarkup(state):''}<div class="appointment-action-line">${ready&&!referral.canConfirm?primary('consult','발급·예약 상담 준비'+icon('arrow')):''}${ready&&!referral.canConfirm?button('continue','월별 일정 먼저 둘러보기'):primary('continue','병원·일정 살펴보기'+icon('arrow'),{disabled:!ready})}</div>${policyMarkup()}`;
}

function travelMarkup(caseState,recheck) {
  const prep=appointmentPreparation(caseState),candidate=prep.candidate;
  return `<section class="appointment-section" aria-label="왕복 이동과 후속 진료"><h3>${recheck?'바뀐 일정에 맞춰 다시 확인해요':'진료 앞뒤 이동도 함께 챙겨요'}</h3>${note('아래 구간은 준비할 일입니다. 항공권·차량·동행·숙박을 확보한 상태가 아니에요.')}<ol class="appointment-route">${prep.legs.map(leg=>`<li><strong>${escape(leg.title)}</strong><p>${escape(leg.detail)}</p>${leg.id==='jeju' && candidate?`<details class="appointment-source"><summary>제주 구간 문의처 보기${icon('chevron')}</summary><p><strong>${escape(candidate.name)}</strong> · ${escape(candidate.phone)}</p><p>${escape(candidate.matchLabel)} · 현재 배차 미확인</p><a href="${escape(candidate.source.url)}" target="_blank" rel="noopener noreferrer">공개 출처 · ${escape(candidate.source.asOf || '공식 서비스 안내')}${icon('external')}</a><p>기존 제주 병원행 응답이 있어도 공항행 조건은 다시 확인합니다.</p></details>`:''}</li>`).join('')}</ol></section>`;
}
function selectionMarkup(state,withChange=false) {
  const {hospital,doctor,date,time}=appointmentSelection(state);
  return `<div class="appointment-selection"><div>${icon('hospital')}<div><strong>${escape(hospital.name)}</strong><span>${escape(doctor?.department || state.department)}${doctor?` · ${escape(doctor.name)} 교수`:''} · 가상</span></div></div>${withChange?button('back','의료진 변경'):''}${date?`<p>${icon('calendar')}<strong>${escape(dateLabel(date))}${time?` · ${escape(time)}`:''}</strong><span>한국 시각 · 시연</span></p>`:''}</div>`;
}
function doctorsMarkup(state) {
  const doctors=APPOINTMENT_DOCTORS.filter(doctor=>doctor.hospitalId===state.hospitalId && doctor.department===state.department);
  return `${filtersMarkup(state)}<p class="appointment-person">${escape(VISIT_TYPES[state.visitType])} · ${escape(referralDisposition(state).label)} ${button('edit_intake','접수 준비 수정')}</p><div class="appointment-doctors">${doctors.map(doctor=>{
    const next=nextAppointmentDate(doctor.id);
    return `<article class="appointment-doctor"><div><h3>${escape(doctor.name)} <span>교수</span></h3><p>${escape(doctor.description)}</p></div><div class="appointment-doctor-time"><span>${next?'가장 가까운 시연 일정':'공개된 시연 시간 없음'}</span><strong>${next?escape(dateLabel(next)):'첫방문 상담 필요'}</strong>${button('doctor',`월별 일정${icon('arrow')}`,{value:doctor.id,ariaLabel:`${doctor.name} 교수 월별 일정 보기`})}</div></article>`;
  }).join('')}</div>${note('표시 날짜는 대기 상황을 설명하는 시연 값이며 실제 대기기간 통계가 아니에요. 의료진 순서는 추천 순위가 아니고 진료과·의료진은 기존 의료진 안내와 병원 상담으로 확인해요.')}`;
}

function scheduleMarkup(state) {
  const slots=appointmentSlots(state.doctorId,state.date),monthIndex=APPOINTMENT_MONTHS.indexOf(state.month),next=nextAppointmentDate(state.doctorId);
  const cells=appointmentCalendar(state.month),hasMonthTime=cells.some(date=>date && appointmentDay(state.doctorId,date)==='available');
  const dayLabels={past:'지난 날짜',closed:'시연 휴진',available:'선택할 시연 시간 있음',full:'공개 시연 시간 마감',unpublished:'시연 일정 미공개'};
  const monthLabel=`${state.month.slice(0,4)}년 ${Number(state.month.slice(5))}월`;
  const selectedStatus=state.date?appointmentDay(state.doctorId,state.date):null;
  return `${selectionMarkup(state,true)}<section class="appointment-section" aria-label="월별 진료 날짜와 시간 선택"><div class="appointment-month-heading"><h3 id="appointment-month">${monthLabel}</h3><div>${button('month',icon('chevron')+'<span class="sr-only">이전 달</span>',{value:APPOINTMENT_MONTHS[monthIndex-1] || '',disabled:monthIndex===0,className:'appointment-prev'})}${button('month',icon('chevron')+'<span class="sr-only">다음 달</span>',{value:APPOINTMENT_MONTHS[monthIndex+1] || '',disabled:monthIndex===APPOINTMENT_MONTHS.length-1})}</div></div><div class="appointment-calendar" role="group" aria-labelledby="appointment-month"><div class="appointment-weekdays" aria-hidden="true">${['일','월','화','수','목','금','토'].map(day=>`<span>${day}</span>`).join('')}</div><div class="appointment-month-grid">${cells.map(date=>{
    if(!date)return '<span class="calendar-blank" aria-hidden="true"></span>';
    const status=appointmentDay(state.doctorId,date),marker=({available:'●',full:'×',unpublished:'—'})[status] || '';
    return button('date',`<strong>${Number(date.slice(-2))}</strong><span class="calendar-day-marker" aria-hidden="true">${marker}</span>`,{value:date,pressed:state.date===date,disabled:['past','closed'].includes(status),className:'appointment-day is-'+status,ariaLabel:`${dateLabel(date)}, ${dayLabels[status]}`});
  }).join('')}</div></div><p class="appointment-calendar-legend"><span>● 시간 있음</span><span>× 마감</span><span>— 미공개</span><span>흐린 날짜: 지난 날·휴진</span></p>${!hasMonthTime?`<div class="appointment-month-empty"><strong>이달에는 선택할 시연 시간이 없어요.</strong><p>미공개 날짜는 휴진·마감으로 단정하지 않고 병원에 확인해요.</p>${next?button('next_available',`${escape(dateLabel(next))} 시연 일정 보기${icon('arrow')}`):button('consult','첫방문 예약 상담 준비'+icon('arrow'))}</div>`:''}<p class="appointment-calendar-scope">시연 기준 ${APPOINTMENT_REFERENCE_DATE} · 실제 예약 현황과 대기기간이 아닙니다.</p><div class="appointment-time-heading"><h3>${state.date?escape(dateLabel(state.date))+' · 진료 시간':'날짜를 선택해 주세요'}</h3></div><div class="appointment-times" aria-label="시연 진료 시간">${slots.length?['오전','오후'].map((label,index)=>{const group=slots.filter(slot=>index===0?slot.time<'12:00':slot.time>='12:00');return `<fieldset><legend>${label}</legend>${group.length?`<div>${group.map(slot=>button('time',`${slot.time}${slot.available?'':'<span>마감</span>'}`,{value:slot.time,disabled:!slot.available,pressed:state.time===slot.time})).join('')}</div>`:'<p class="appointment-note">공개된 시연 시간 없음</p>'}</fieldset>`;}).join(''):`<div class="appointment-empty"><strong>${selectedStatus==='unpublished'?'아직 공개되지 않은 날짜예요.':state.date?'선택 가능한 시연 시간이 없어요.':'날짜를 고르면 오전·오후 시간을 확인할 수 있어요.'}</strong><p>${selectedStatus==='unpublished'?'예약 창구에 공개 일정과 다른 의료진의 가능 일정을 문의해요.':'다른 달의 일정 또는 예약 상담으로 이어갈 수 있어요.'}</p></div>`}</div><div class="appointment-action-line"><span>${state.time?`${escape(dateLabel(state.date))} ${state.time} 선택`:'날짜 선택만으로 예약되지 않아요.'}</span>${primary('review',referralDisposition(state).canConfirm?'선택한 일정 확인'+icon('arrow'):'선택한 일정으로 상담 준비'+icon('arrow'),{disabled:!appointmentSelection(state).valid})}</div>${button('consult','원하는 시간이 없어요 · 취소 자리·다른 일정 상담 준비',{className:'appointment-consult'})}${note('취소 자리 알림·대기 등록은 병원에 가능 여부를 문의할 항목이며, 이 버튼으로 등록되지는 않아요. 접수·검사 일정이 확인된 뒤 항공·귀가 계획을 맞춰요.')}</section>`;
}

function reviewMarkup(state,caseState) {
  const consultation=state.requestMode==='consultation';
  return `${selectionMarkup(state)}<p class="appointment-person">${escape(caseState.patient.name)} 님 · ${escape(VISIT_TYPES[state.visitType])} · 가상 사례</p>${referralMarkup(state)}<section class="appointment-section"><h3>${consultation?'첫방문·예약 창구에 확인할 내용':'병원 확인을 기다릴 내용'}</h3><ul class="appointment-checks"><li>의뢰서 수신 병원·진료과와 제출 시점, 이번 진료에 적용되는 접수 요건</li><li>${state.time?'선택한 희망 시간의 실제 가능 여부와 병원 회신':'공개 일정·다른 의료진·취소 자리 안내나 대기 접수 가능 여부'}</li><li>외부 영상 등록·진료 전 검사와 별도 검사일, 도착 시각·귀가 일정</li></ul>${consultation?note('의뢰서·초진 조건이나 일정이 미확인인 상태로 상담을 준비해요. 상담 요청을 예약 확정으로 바꾸지 않아요.'):note('보유 응답만으로 의뢰서 접수·진료 수락이 확인되지는 않아요. 실제 본인인증·위임·정보 전송은 없습니다.')}</section><div class="appointment-action-line">${button('back','이전으로')}${primary('request',consultation?'예약 상담 요청 체험'+icon('arrow'):'희망 일정 요청 체험'+icon('arrow'))}</div><details class="appointment-source"><summary>참고 자료 보유 상태 보기${icon('chevron')}</summary>${recordsMarkup(state,caseState)}</details>`;
}

function resultMarkup(state,caseState) {
  const pending=['requested_demo','consultation_requested_demo'].includes(state.status),changed=state.status==='change_requested_demo',documents=state.status==='documents_needed_demo',consultation=state.status==='consultation_requested_demo';
  const explanation=documents?'제주 담당 의료진에게 의뢰 필요성·발급을 상담하고 수신 병원의 제출 요건을 다시 확인할 상황이에요.':changed?'다른 의료진·다른 달의 공개 일정과 취소 자리 안내 여부를 병원에 확인하는 상황이에요.':pending?'기관 회신 전이에요. 요청 내용은 병원에 실제로 전송되지 않았어요.':'확정 회신을 받은 상황의 시연입니다. 실제 병원 예약은 만들어지지 않았어요.';
  return `<div class="appointment-result-state" role="status">${icon(changed||documents?'refresh':pending?'clock':'check')}<div><strong>${escape(appointmentStatus(state))}</strong><p>${explanation}</p></div></div>${selectionMarkup(state)}${pending?`<div class="appointment-replies" aria-label="병원 회신 체험">${!consultation?button('reply','확정 회신 체험',{value:'confirm'}):''}${button('reply','의뢰서 보완 안내 체험',{value:'documents'})}${button('reply','다른 일정 안내 체험',{value:'change'})}</div>`:''}${documents||consultation?referralMarkup(state):''}<div class="appointment-action-line">${documents?button('edit_intake','의뢰서 준비 다시 확인'):button('edit',changed?'다른 달·의료진 확인':'일정 다시 확인')}${primary('save','내륙 진료 준비표 저장'+icon('download'))}</div>${travelMarkup(caseState,state.recheck)}${recordsMarkup(state,caseState)}`;
}

export function appointmentMarkup(state,caseState) {
  const title=({intake:'진료의뢰서와 첫방문 조건부터 확인해요',doctors:'내륙 진료, 누구에게 받을까요?',schedule:'월별 진료 일정을 살펴보세요',review:state.requestMode==='consultation'?'예약 상담을 이렇게 준비할까요?':'이 희망 일정으로 요청할까요?',result:state.status==='documents_needed_demo'?'진료의뢰서 준비부터 이어가요':state.status==='change_requested_demo'?'다른 진료 일정을 확인해 주세요':'내륙 진료 준비를 이어가요',records:'진료의뢰서와 참고 자료를 구분해요',support:'접수·검사 일정에 맞춰 왕복을 준비해요'})[state.screen];
  const step=state.screen==='intake'?1:['doctors','schedule'].includes(state.screen)?2:3;
  const body=state.screen==='intake'?intakeMarkup(state):state.screen==='doctors'?doctorsMarkup(state):state.screen==='schedule'?scheduleMarkup(state):state.screen==='review'?reviewMarkup(state,caseState):state.screen==='result'?resultMarkup(state,caseState):state.screen==='records'?recordsMarkup(state,caseState):travelMarkup(caseState,state.recheck);
  return `<div class="appointment-topline"><span>${icon('hospital')}내륙 병원 예약 준비</span>${button('close','기존 준비로 돌아가기')}</div><p class="appointment-route-caption">제주에서 의뢰 준비 <span>→</span> 내륙 진료 <span>→</span> 제주 후속 진료</p><h2 id="appointment-title" tabindex="-1">${title}</h2><p class="appointment-boundary">${APPOINTMENT_BOUNDARY}</p>${['records','support'].includes(state.screen)?'':`<ol class="appointment-progress" aria-label="예약 준비 순서"><li ${step===1?'aria-current="step"':''}>1. 접수 준비</li><li ${step===2?'aria-current="step"':''}>2. 병원·일정</li><li ${step===3?'aria-current="step"':''}>3. 요청·회신</li></ol>`}${state.recheck && state.screen!=='result'?'<p class="appointment-recheck" role="status">조건이 바뀌었어요. 이전 시연 요청의 접수·이동·동행 조건을 재확인해 주세요.</p>':''}${body}${['records','support'].includes(state.screen)?primary('resume','예약 준비로 돌아가기'+icon('arrow')):''}<p class="appointment-storage-note">이 탭에서만 체험해요. 새로고침하면 준비 응답과 희망 일정은 사라집니다.</p>`;
}

export function appointmentNavigationMarkup(state) {
  const hospitalStage=['doctors','schedule'].includes(state.screen);
  const rows=[['view','records','folder','초진·진료의뢰서',referralDisposition(state).label,['intake','records'].includes(state.screen)],['resume','','hospital','병원·월별 일정',state.time?`${dateLabel(state.date)} ${state.time}`:'빈자리·마감·미공개 구분',hospitalStage],['view','support','car','왕복 이동·동행','접수·검사 일정 확인 후 준비',state.screen==='support'],['summary','','calendar','예약 상담·준비표',appointmentStatus(state),['review','result'].includes(state.screen)]];
  return `<div class="preparation-heading"><h2>내륙 진료 준비</h2><p class="preparation-note">의뢰 준비에서 병원 회신까지</p></div><nav class="appointment-nav" aria-label="내륙 진료 준비 단계">${rows.map(([action,value,topic,title,detail,selected])=>button(action,`${icon(topic)}<span><strong>${title}</strong><small>${escape(detail)}</small></span>${icon('chevron')}`,{value,disabled:action==='summary'&&!canReviewAppointment(state),pressed:selected})).join('')}</nav><p class="preparation-boundary">${state.status==='confirmed_demo'?'확정 회신도 합성 시연입니다.':'상담 접수·희망 일정·예약 확정은 달라요.'}<br>실제 예약·전송·배차는 없습니다.</p>`;
}

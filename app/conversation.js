import { createDemoCase, getProgress, getTasks, buildReport, DOCUMENT_DEFINITIONS } from './domain.js';
import { getVisitSupportSummary } from './visit-support.js';
import { icon } from './icons.js';
import { DEFAULT_CARE_PREFERENCES, normalizeCarePreferences, getTaxiPreferenceOptions } from './care-preferences.js';
import { formatMessage } from './message-format.js';
import { buildCallPlan, CALL_TARGETS } from './call-policy.js';
import { getCareJourneySummary, JOURNEY_SCENARIOS, CALL_RECOVERY_SCENARIOS } from './care-journey.js';

const API = '/api/agent';
const MAX_MESSAGE = 1600;
const MAX_HISTORY = 8;
const MAX_HISTORY_TEXT = 2000;
const PREFERENCES_STORAGE_KEY = 'jeju-care-preferences-v1';
const mobileRail = window.matchMedia('(max-width:1050px)');
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const micIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg>';
const stopIcon = '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
const makeId = () => crypto.randomUUID();
const timeLabel = date => new Intl.DateTimeFormat('ko-KR', {hour:'2-digit',minute:'2-digit',hour12:false}).format(date);

let caseState = createDemoCase();
let sessionId;
let history = [];
let pending = false;
let activeRequest;
let failedPreviewRequest;
let conversationVersion = 0;
let layoutFrame;
let capabilityState = 'checking';
let capabilities = {llm:null,model:'',phone:'not_connected',healthRecords:'not_connected',voiceInput:'browser'};
let latestActions = [];
let latestEvents = [];
let responseCount = 0;
let previewMode = false;
let activeRecognition;
let recognitionCancelled = false;
let recognitionFailed = false;
let finalTranscript = '';
let voiceBase = '';
let composing = false;
let preferencesStored = false;
let preferencesStorageAvailable = true;
let carePreferences = loadCarePreferences();
let preferencesNeedApply = true;
let drawerOpen = false;
let drawerReturnFocus;
let patientRecordsReturnFocus;
let contactPlanReturnFocus;
let careJourneyReturnFocus;
const failedRequests = new Map();

function loadCarePreferences() {
  try {
    const raw=localStorage.getItem(PREFERENCES_STORAGE_KEY);
    if(raw===null)return {...DEFAULT_CARE_PREFERENCES};
    const normalized=normalizeCarePreferences(JSON.parse(raw),{strict:true});
    preferencesStored=true;
    return normalized;
  } catch {
    try {localStorage.removeItem(PREFERENCES_STORAGE_KEY);} catch {preferencesStorageAvailable=false;}
    return {...DEFAULT_CARE_PREFERENCES};
  }
}

function preferencesEqual(left,right) {
  return left?.taxiProviderId===right?.taxiProviderId && left?.wheelchair===right?.wheelchair && left?.companionNeeded===right?.companionNeeded;
}

function preferenceFeedback() {
  const status=document.getElementById('preferences-status');
  status.textContent=previewMode ? '고정 미리보기에는 설정을 적용하지 않아요.' : !preferencesStorageAvailable ? '이 기기에 저장하지 못했어요. 이번 화면의 다음 요청에는 반영해요.' : preferencesNeedApply ? preferencesStored ? '이 기기에 저장 · 다음 요청부터 반영' : '기본값 · 다음 요청에 반영' : '현재 대화에 반영됨 · 변경하면 다음 요청부터 적용';
}

function renderPreferences() {
  const options=getTaxiPreferenceOptions(caseState.patient.area);
  if(!options.some(item=>item.value===carePreferences.taxiProviderId)) {
    const selected=getTaxiPreferenceOptions('').find(item=>item.value===carePreferences.taxiProviderId);
    if(selected)options.push({...selected,label:`${selected.label} · 지역 확인 필요`});
  }
  document.getElementById('pref-taxi').innerHTML=options.map(item=>`<option value="${escape(item.value)}"${item.value===carePreferences.taxiProviderId?' selected':''}>${escape(item.label)}</option>`).join('');
  document.getElementById('pref-wheelchair').checked=carePreferences.wheelchair;
  document.getElementById('pref-companion').checked=carePreferences.companionNeeded;
  preferenceFeedback();
}

function changePreferences() {
  carePreferences=normalizeCarePreferences({taxiProviderId:document.getElementById('pref-taxi').value,wheelchair:document.getElementById('pref-wheelchair').checked,companionNeeded:document.getElementById('pref-companion').checked});
  preferencesNeedApply=true;
  try {localStorage.setItem(PREFERENCES_STORAGE_KEY,JSON.stringify(carePreferences));preferencesStored=true;preferencesStorageAvailable=true;}
  catch {preferencesStored=false;preferencesStorageAvailable=false;}
  preferenceFeedback();
}

function closeCareMenu({restoreFocus=true}={}) {
  drawerOpen=false;document.body.classList.remove('drawer-open');
  const rail=document.getElementById('care-rail');
  rail.removeAttribute('role');rail.removeAttribute('aria-modal');rail.inert=mobileRail.matches;
  document.getElementById('workspace-shell').inert=false;
  document.getElementById('mobile-app-header').inert=false;
  document.getElementById('drawer-backdrop').hidden=true;
  document.getElementById('open-care-menu').setAttribute('aria-expanded','false');
  if(restoreFocus && mobileRail.matches)(drawerReturnFocus?.isConnected?drawerReturnFocus:document.getElementById('open-care-menu')).focus({preventScroll:true});
}

function openCareMenu() {
  if(!mobileRail.matches)return;
  drawerReturnFocus=document.activeElement;drawerOpen=true;
  const rail=document.getElementById('care-rail');rail.inert=false;rail.setAttribute('role','dialog');rail.setAttribute('aria-modal','true');
  document.body.classList.add('drawer-open');
  document.getElementById('drawer-backdrop').hidden=false;
  document.getElementById('open-care-menu').setAttribute('aria-expanded','true');
  document.getElementById('close-care-menu').focus({preventScroll:true});
  document.getElementById('workspace-shell').inert=true;
  document.getElementById('mobile-app-header').inert=true;
}

function renderPatientRecords() {
  const patient=caseState.patient || {};
  const provided=value=>typeof value==='string' && value.trim()?value:'현재 사례에 정보가 제공되지 않았습니다.';
  const fields=[
    ['name','이름',provided(patient.name)],
    ['age','나이',Number.isFinite(patient.age)?`${patient.age}세`:'현재 사례에 정보가 제공되지 않았습니다.'],
    ['area','지역',provided(patient.area)],
    ['caregiver','보호자',provided(patient.caregiver)],
    ['existingHospital','기존 도외 병원',provided(patient.existingHospital)],
    ['localHospital','제주 병원',provided(patient.localHospital)],
    ['nextVisit','방문일 · 시연 일정',provided(patient.nextVisit)],
    ['purpose','준비 목적',provided(patient.purpose)],
  ];
  document.getElementById('patient-basics').innerHTML=fields.map(([key,label,value])=>`<div data-patient-field="${key}" class="${['existingHospital','localHospital','purpose'].includes(key)?'wide':''}"><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('');
  for(const definition of DOCUMENT_DEFINITIONS) {
    const record=caseState.documents?.find(item=>item.id===definition.id);
    const node=document.querySelector(`[data-record-document-id="${definition.id}"]`);
    const source=typeof record?.source==='string'?record.source:'';
    const content=typeof record?.content==='string'?record.content:'';
    const status=record?.status==='ready' ? source.trim()?'준비됨 표시 · 합성 자료':'준비됨 표시 · 출처 미확인' : record?.status==='missing'?'사례 자료 미준비':record?.status==='not_performed'?'사례상 시행 전':'상태가 제공되지 않았습니다.';
    node.querySelector('[data-record-label]').textContent=record?.label || definition.label;
    node.querySelector('[data-record-status]').textContent=status;
    node.querySelector('[data-record-status]').dataset.status=record?.status || 'unknown';
    node.querySelector('[data-record-status]').classList.toggle('unverified',record?.status==='ready' && !source.trim());
    node.querySelector('[data-record-source]').textContent=source.trim()?source:'출처가 제공되지 않았습니다.';
    node.querySelector('[data-record-content]').textContent=content.trim()?content:'이 사례에 표시할 내용이 제공되지 않았습니다.';
  }
}

function openPatientRecords() {
  const dialog=document.getElementById('patient-records-dialog');
  if(dialog.open)return;
  patientRecordsReturnFocus=document.getElementById(mobileRail.matches?'open-care-menu':'nav-patient-records');
  closeCareMenu({restoreFocus:false});
  renderPatientRecords();
  dialog.showModal();
  document.body.classList.add('records-dialog-open');
  document.getElementById('patient-records-body').scrollTop=0;
  document.getElementById('patient-records-title').focus({preventScroll:true});
}

function renderContactPlans() {
  const host=document.getElementById('contact-plans');
  const openTargets=[...host.querySelectorAll('[data-contact-target][open]')].map(node=>node.dataset.contactTarget);
  const focused=document.activeElement;
  const focusTarget=focused?.closest('[data-contact-target]')?.dataset.contactTarget;
  const focusSelector=focused?.closest('[data-contact-draft]')?'[data-contact-draft]':focused?.matches('summary')?'summary':null;
  const labels={mainland:'기존 도외 병원',jeju:'제주 병원',taxi:'택시·휠체어 이동',companion:'병원 동행'};
  const checkLabels={missing:'누락',unverified:'미확인',simulation:'합성 사례'};
  const list=items=>`<ul>${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  const recordLabel=value=>value==='not_configured'?'미설정':value==='not_verified'?'미확인':'확인 필요';
  host.innerHTML=CALL_TARGETS.map(target=>{
    const plan=buildCallPlan(caseState,target);
    return `<details class="contact-plan" data-contact-target="${target}" ${openTargets.includes(target)?'open':''}>
      <summary><span class="contact-recipient"><strong>${escape(plan.recipient.name)}</strong><span>${labels[target]}</span></span><span class="contact-status">${escape(plan.simulation.label)}</span>${icon('chevron')}</summary>
      <div class="contact-plan-content">
        <dl class="contact-facts"><div><dt>문의 목적</dt><dd data-contact-purpose>${escape(plan.purpose)}</dd></div><div><dt>문의처</dt><dd data-contact-recipient>${escape(plan.recipient.phone || '공개 대표번호 미확인')}<span class="contact-meta">실제 상대·연결 여부 미확인</span>${plan.recipient.source?`<span class="contact-meta">${escape(plan.recipient.source)}</span>`:''}${plan.recipient.sourceUrl?`<span class="contact-source">${safeSource(plan.recipient.sourceUrl)}</span>`:''}</dd></div><div><dt>전달 범위</dt><dd data-contact-disclosure><p>허용 범위를 확인할 최소 전달 항목</p>${plan.minimumDisclosure.length?list(plan.minimumDisclosure.map(item=>`${item.label} · ${item.value}`)):'전달 항목 확인 필요'}</dd></div><div><dt>자동 제외</dt><dd data-contact-excluded>${escape(plan.excludedInformation.join(' · '))}</dd></div></dl>
        <section class="contact-section"><h4>확인할 질문</h4><div data-contact-questions>${list(plan.questions)}</div></section>
        <section class="contact-section"><h4>AI가 먼저 알릴 예정 문구</h4><p data-contact-opening>${escape(plan.openingScript)}</p><p class="contact-meta">위임·고지·기록 처리 조건을 확인한 뒤 사용할 계획입니다. 실제 통화에서 고지한 기록이 아닙니다.</p></section>
        <section class="contact-section" data-contact-records><h4>통화 기록 처리</h4><dl class="contact-records"><div><dt>녹음</dt><dd>${recordLabel(plan.recordHandling.recording)}</dd></div><div><dt>전사</dt><dd>${recordLabel(plan.recordHandling.transcription)}</dd></div><div><dt>보관</dt><dd>${recordLabel(plan.recordHandling.retention)}</dd></div><div><dt>국외 이전</dt><dd>${recordLabel(plan.recordHandling.overseasTransfer)}</dd></div></dl><p>${escape(plan.recordHandling.notice)}</p></section>
        <section class="contact-section"><h4>실제 발신 전에 필요한 확인</h4><ul class="contact-checks" data-contact-checks>${plan.preCallChecks.map(check=>`<li><strong>${checkLabels[check.status] || '확인 필요'} · ${escape(check.label)}</strong><span>${escape(check.detail)}</span></li>`).join('')}</ul></section>
        <section class="contact-section" data-contact-simulation><h4>합성 진행 결과</h4><p><strong>${escape(plan.simulation.label)}</strong> · ${escape(plan.simulation.detail)}</p></section>
        <section class="contact-section"><h4>다음 행동과 담당</h4><div data-contact-next-actions>${list(plan.nextActions)}</div></section>
        <div class="contact-draft"><p data-contact-request-draft>${escape(plan.requestDraft)}</p><button type="button" class="contact-draft-button" data-contact-draft="${target}" ${pending || activeRecognition?'disabled':''}>이 내용으로 문의 준비${icon('arrow')}</button><p class="contact-meta">입력창에서 확인·수정한 뒤 직접 보내세요. 이 버튼은 발신하거나 요청을 전송하지 않습니다.</p></div>
      </div>
    </details>`;
  }).join('');
  renderCallRecovery();
  if(focusTarget && focusSelector && document.getElementById('contact-plan-dialog').open)host.querySelector(`[data-contact-target="${focusTarget}"] ${focusSelector}`)?.focus({preventScroll:true});
}

function openContactPlan() {
  const dialog=document.getElementById('contact-plan-dialog');
  if(dialog.open)return;
  contactPlanReturnFocus=document.getElementById(mobileRail.matches?'open-care-menu':'nav-contact-plan');
  closeCareMenu({restoreFocus:false});renderContactPlans();
  dialog.returnValue='';dialog.showModal();
  document.body.classList.add('records-dialog-open');
  document.getElementById('contact-plan-body').scrollTop=0;
  document.getElementById('contact-plan-title').focus({preventScroll:true});
}

function journeyEvidenceMarkup(items=[]) {
  if(!items.length)return '<p class="journey-note">근거가 제공되지 않았습니다. 확인 전에는 준비 완료나 진료 경로를 확정하지 않습니다.</p>';
  return `<ul class="journey-evidence">${items.map(item=>`<li data-journey-evidence="${escape(item.documentId)}"><strong>${escape(item.label || '근거 자료')} · ${item.isSimulation===true?'합성 자료':'출처 확인 필요'}</strong><blockquote>${escape(item.excerpt || '원문 발췌가 제공되지 않았습니다.')}</blockquote><dl><div><dt>작성일</dt><dd>${escape(item.authoredAt || '작성일 미상')}</dd></div><div><dt>확인 여부</dt><dd>${item.confirmation==='demo_confirmed'?'합성 시연에서 확인':'미확인'} · ${escape(item.confirmedAt || '확인일 없음')}</dd></div></dl>${item.sourceUrl?`<div class="journey-source">${safeSource(item.sourceUrl)}</div>`:''}</li>`).join('')}</ul>`;
}

function callHandoffsMarkup(handoffs=[]) {
  const reasonLabels={no_answer:'무응답',unreachable:'연결되지 않음',ai_declined:'AI 응대 거절',identity_required:'환자 본인 확인 필요',missing_documents:'필요 서류 부족',no_slots:'요청 일정 예약 불가',not_participating:'이번 요청 접수 미참여',answered:'응답 확인 · 합성'};
  const statusLabels={policy_required:'재시도 정책 미설정',retry_allowed:'허용 범위 내 합성 재시도 가능',retry_exhausted:'허용 횟수 도달 · 인계 필요',retry_expired:'허용 시간 종료 · 인계 필요',handed_off:'자동 반복 문의 중단 · 사람 인계',blocked:'선행 작업 필요 · 문의 중단',waiting_user:'보호자 허용 범위 확인',followup_required:'이전 실패 후 남은 일 확인'};
  const list=items=>`<ul class="journey-list">${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  return handoffs.map(item=>{
    const policy=item.retryPolicy,attempts=item.attempts;
    return `<article class="call-handoff" data-call-recovery="${escape(item.id)}" data-call-handoff="${escape(item.id)}" data-status="${escape(item.status)}" data-owner="${escape(item.owner)}" data-target="${escape(item.target)}" data-stop-automatic="${item.stopAutomatic===true}" data-actual-call-placed="false">
      <div class="call-handoff-heading"><h4>${escape(item.title)}</h4><span>${escape(statusLabels[item.status] || item.status)}</span></div>
      <dl class="call-handoff-facts"><div><dt>실패 이유</dt><dd>${escape(reasonLabels[item.reason] || item.reason)}</dd></div><div><dt>인계 담당</dt><dd>${escape(item.owner)}</dd></div><div><dt>공개 문의처</dt><dd>${escape(item.contact.name || '담당 문의처 확인 필요')}<span class="contact-meta">${escape(item.contact.phone || '공개 번호 미확인')} · 실제 연결 확인 전</span>${item.contact.sourceUrl?`<span class="journey-source">${safeSource(item.contact.sourceUrl)}</span>`:''}</dd></div></dl>
      <p class="journey-detail">${escape(item.detail)}</p>
      <h5>합성 시도 내역</h5>${attempts.length?`<ol class="call-attempts">${attempts.map(attempt=>`<li data-call-attempt="${escape(attempt.number)}" data-outcome="${escape(attempt.outcome)}" data-at="${escape(attempt.at)}"><strong>${escape(attempt.number)}차 · ${escape(reasonLabels[attempt.outcome] || attempt.outcome)}</strong><span>${escape(attempt.at || '시도 시각 미상')}</span><span>${attempt.isSimulation===true?'합성 시도 기록':'기록 출처 확인 필요'} · 실제 발신 없음</span></li>`).join('')}</ol>`:'<p class="journey-note">이 사례에 시도 내역이 제공되지 않았습니다. 실제 통화를 시도했다고 표시하지 않습니다.</p>'}
      <div class="call-retry-policy" data-call-retry-policy><h5>재시도 정책과 현재 시도</h5><p>${policy.configured?`최초 시도 포함 최대 ${escape(policy.maxAttempts)}회 · ${escape(policy.windowMinutes)}분 이내`:'미설정 · 자동 재시도하지 않음'}</p><p>누적 ${escape(attempts.length)}건${attempts.length?` · 마지막 ${escape(attempts.at(-1).number)}차`:''}의 합성 기록</p>${policy.configured?`<dl><div><dt>허용 시작</dt><dd>${escape(policy.startsAt || '시작 시각 미설정')}</dd></div><div><dt>허용 종료</dt><dd>${escape(policy.expiresAt || '종료 시각 미설정')}</dd></div></dl>`:''}<p class="journey-note">${item.stopAutomatic?'자동 반복 문의는 중단 상태입니다. 담당자가 다음 절차를 확인해야 합니다.':'표시된 허용 범위를 넘겨 반복 문의하지 않습니다.'} 실제 자동 재시도 예약·발신은 없습니다.</p></div>
      ${item.questions.length?`<h5>사람이 이어서 물을 질문</h5>${list(item.questions)}`:''}<h5>남은 일과 인계 내용</h5>${item.remainingTasks.length?list(item.remainingTasks):'<p class="journey-note">다음 담당자에게 남은 절차를 확인해 주세요.</p>'}
      ${item.requestDraft?`<div class="journey-draft"><p>${escape(item.requestDraft)}</p><button type="button" class="contact-draft-button" data-call-handoff-draft="${escape(item.id)}" data-journey-draft="${escape(item.id)}" ${pending || activeRecognition?'disabled':''}>인계 요청을 입력창에 넣기${icon('arrow')}</button><p class="journey-note">내용을 확인·수정한 뒤 직접 보내세요. 이 버튼은 기관에 연락하거나 동의를 확인하지 않습니다.</p></div>`:''}
    </article>`;
  }).join('');
}

function renderCallRecovery() {
  let handoffs=[];
  try {handoffs=getCareJourneySummary(caseState).handoffs || [];} catch { /* 현재 대화는 유지하고 확인되지 않은 실패 기록을 만들지 않는다. */ }
  document.getElementById('call-handoffs').innerHTML=handoffs.length?`<h3>연결되지 않은 문의와 사람 인계</h3><p class="journey-note">실패 이유·시도·남은 일을 보존한 합성 기록입니다. 실제 발신·예약·본인 확인·위임 검증은 수행하지 않았습니다.</p>${callHandoffsMarkup(handoffs)}`:'<p class="journey-note">현재 대화에 실패·인계 기록은 없습니다. 문의가 막히면 이유와 시도 내역, 남은 일과 담당자를 함께 남깁니다.</p>';
  document.getElementById('call-recovery-options').innerHTML=CALL_RECOVERY_SCENARIOS.map(item=>`<button type="button" data-call-recovery-scenario="${escape(item.id)}" ${pending || activeRecognition?'disabled':''}><span><strong>${escape(item.label)}</strong><span>${escape(item.description)}</span></span>${icon('chevron')}</button>`).join('');
}

function renderCareJourney() {
  const host=document.getElementById('care-journey-content');
  let journey;
  try {journey=getCareJourneySummary(caseState);} catch { /* 기존 상태도 안전하게 읽고, 실패를 완료로 바꾸지 않는다. */ }
  document.getElementById('care-journey-current').textContent=journey?.pathway?.label || '진료 연결 미확인';
  const next=journey?.nextActions?.[0];
  document.getElementById('care-journey-next').textContent=next?.title || '대화에서 필요한 준비를 확인해 주세요.';
  if(!journey){host.innerHTML='<p class="journey-note">진료 여정을 읽지 못했어요. 현재 대화는 유지됩니다. 대화에서 준비 상태를 다시 확인해 주세요.</p>';return;}
  const openItems=new Set([...host.querySelectorAll('details[data-journey-task][open],details[data-journey-data][open]')].map(node=>node.dataset.journeyTask || node.dataset.journeyData));
  const focused=document.activeElement;
  const focusId=focused?.closest('[data-journey-task],[data-journey-data]')?.dataset;
  const focusItem=focusId?.journeyTask || focusId?.journeyData;
  const focusSelector=focused?.closest('[data-journey-draft]')?'[data-journey-draft]':focused?.matches('summary')?'summary':null;
  const statusLabels={todo:'할 일',blocked:'선행 확인 필요',ready:'합성 준비됨',recheck:'재확인 필요'};
  const disabled=pending || Boolean(activeRecognition);
  const list=items=>`<ul class="journey-list">${items.map(item=>`<li>${escape(item)}</li>`).join('')}</ul>`;
  const draftButton=item=>item.requestDraft?`<div class="journey-draft"><p data-journey-request-draft>${escape(item.requestDraft)}</p><button type="button" class="contact-draft-button" data-journey-draft="${escape(item.id)}" ${disabled?'disabled':''}>입력창에 초안 넣기${icon('arrow')}</button></div>`:'';
  const schedule=journey.schedule;
  const scheduleStatus=value=>({not_requested:'문의 전',not_contacted:'문의 전',not_selected:'문의처 선택 전',selected:'공개 문의처 선택',prepared:'문의 준비 · 응답 전',available_demo:'합성 가능 응답 · 예약 미확정',unavailable_demo:'합성 불가 응답',unreachable_demo:'합성 연락 실패',needs_recheck:'조건 변경 · 재확인 필요',pending:'확인 필요',unconfirmed:'미확인',recheck:'재확인 필요',recheck_required:'재확인 필요',confirmed:'합성 가능 응답 · 예약 미확정',ready:'합성 가능 응답 · 예약 미확정'}[value] || value || '미확인');
  host.innerHTML=`
    <section class="journey-section journey-outcome" aria-labelledby="journey-outcome-title"><h3 id="journey-outcome-title">${escape(journey.pathway.label)}</h3><p class="journey-detail">${escape(journey.pathway.detail)}</p>${journey.activeScenario?`<p class="journey-active-scenario" data-journey-active-scenario="${escape(journey.activeScenario.id)}"><strong>합성 상황 · ${escape(journey.activeScenario.label)}</strong><span>${escape(journey.activeScenario.summary)}</span></p>`:''}<p class="journey-note">자료 준비 → 두 병원 문의 → 이동·동행 후속 확인을 이어갑니다. 실제 통화·예약·배차·진료 수락·외부 기록 연결은 수행하지 않습니다.</p></section>
    <section class="journey-section" aria-labelledby="journey-pathways-title"><h3 id="journey-pathways-title">의료진이 확인할 세 가지 진료 경로</h3><p class="journey-note">환자별 진료 경로는 제주·기존 도외 의료진과 기관이 확인합니다. 접수 창구의 거절만으로 진료 경로를 결정하지 않습니다.</p><ul class="journey-pathways">${journey.pathways.map(item=>`<li data-journey-pathway="${escape(item.id)}" data-selected="${item.selected===true}"><div><strong>${escape(item.label)}</strong><span class="journey-pathway-state">${item.selected && journey.pathway.status==='demo_confirmed'?'합성 근거로 확인':'미확인'}</span></div><p>${escape(item.detail)}</p></li>`).join('')}</ul><details class="journey-proof"><summary>진료 경로 판단의 근거${icon('chevron')}</summary>${journeyEvidenceMarkup(journey.pathway.evidence)}</details></section>
    <section class="journey-section" aria-labelledby="journey-tasks-title"><h3 id="journey-tasks-title">이어지는 할 일과 담당</h3><p class="journey-note">선행 자료와 문의 결과를 확인한 뒤 다음 일을 준비합니다. 아래 초안은 입력창에서 고친 뒤 직접 보내세요.</p><div class="journey-tasks">${journey.tasks.map((item,index)=>`<details class="journey-task" data-journey-task="${escape(item.id)}" data-status="${escape(item.status)}" ${openItems.has(item.id) || (!host.children.length && index===0)?'open':''}><summary><span class="journey-task-heading"><strong>${escape(item.title)}</strong><span>${escape(item.owner)}</span></span><span class="journey-task-state" data-status="${escape(item.status)}">${statusLabels[item.status] || '확인 필요'}</span>${icon('chevron')}</summary><div class="journey-task-content"><p class="journey-detail">${escape(item.detail)}</p><h4>요청의 근거와 원문</h4>${journeyEvidenceMarkup(item.evidence)}${draftButton(item)}</div></details>`).join('')}</div></section>
    <section class="journey-section" aria-labelledby="journey-findings-title"><h3 id="journey-findings-title">합성 전화 응답과 후속 질문</h3>${journey.findings.length?`<ol class="journey-findings">${journey.findings.map(item=>`<li data-journey-finding="${escape(item.id)}"><strong>${escape(item.label)}</strong><span class="journey-note">${item.isSimulation===true?'합성 응답':'출처 확인 필요'} · ${escape(item.at || '응답일 미상')}</span><p class="journey-detail">${escape(item.detail)}</p></li>`).join('')}</ol>`:'<p class="journey-note">아직 이 사례에 합성 문의 응답이 없습니다. 문의에서 확인된 조건은 후속 할 일과 질문에 반영합니다.</p>'}</section>
    ${(journey.handoffs || []).length?`<section class="journey-section journey-handoffs" aria-labelledby="journey-handoffs-title"><h3 id="journey-handoffs-title">실패한 문의와 사람에게 남긴 일</h3><p class="journey-note">실패를 성공으로 바꾸지 않고 인계 이유·시도 내역·담당과 남은 일을 보존합니다.</p>${callHandoffsMarkup(journey.handoffs)}</section>`:''}
    <section class="journey-section" aria-labelledby="journey-schedule-title"><h3 id="journey-schedule-title">일정과 이동·동행 재확인</h3><dl class="journey-schedule"><div><dt>시연 일정</dt><dd>${escape(schedule.date || '날짜 미정')} · ${escape(schedule.time || '시각 미정')} <span>(변경 ${escape(schedule.revision ?? 0)}회)</span></dd></div><div><dt>택시 이동</dt><dd data-journey-taxi-status>${escape(scheduleStatus(schedule.taxiStatus))}</dd></div><div><dt>병원 동행</dt><dd data-journey-companion-status>${escape(scheduleStatus(schedule.companionStatus))}</dd></div></dl>${schedule.recheckReasons.length?`<div class="journey-recheck" data-journey-recheck><h4>이전 조건으로 진행할 수 없는 이유</h4>${list(schedule.recheckReasons)}</div>`:'<p class="journey-note">일정·기관·출발 지역·휠체어 조건이 바뀌면 이전 이동·동행 문의 결과를 다시 확인합니다.</p>'}</section>
    <section class="journey-section" aria-labelledby="journey-data-title"><h3 id="journey-data-title">공공자료가 바꾼 문의 후보와 질문</h3><p class="journey-note">공개 등록 자료로 문의 후보를 좁힙니다. 현재 진료 수용·임상 적합성·차량·동행 인력의 확보 여부는 별도 확인입니다.</p><div class="journey-data">${journey.dataImpact.map(item=>`<details class="journey-data-item" data-journey-data="${escape(item.id)}" ${openItems.has(item.id)?'open':''}><summary><span><strong>${escape(item.title)}</strong><span>${escape(item.datasetId || '별도 공식 안내')}${Number.isFinite(item.candidateCount)?` · 공개 후보 ${escape(item.candidateCount)}곳`:''}</span></span>${icon('chevron')}</summary><div class="journey-data-content"><p class="journey-detail">${escape(item.detail)}</p>${item.questions.length?`<h4>이 자료로 더 확인할 질문</h4>${list(item.questions)}`:''}<div class="journey-source">${safeSource(item.sourceUrl)}</div></div></details>`).join('')}</div></section>
    <section class="journey-section" aria-labelledby="journey-next-title"><h3 id="journey-next-title">다음 요청으로 이어가기</h3><ul class="journey-next-actions">${journey.nextActions.map(item=>`<li><strong>${escape(item.title)}</strong><p class="journey-note">${escape(item.detail)}</p>${draftButton(item)}</li>`).join('')}</ul><p class="journey-note">초안 버튼은 대화를 전송하거나 기관에 연락하지 않습니다.</p></section>
    <section class="journey-section" aria-labelledby="journey-scenarios-title"><h3 id="journey-scenarios-title">세 가지 상황 미리보기</h3><p class="journey-note">작성된 합성 예시로 현재 대화를 바꾸어 봅니다. 실제 모델·환자 기록 조회·전화는 실행하지 않습니다.</p><div class="journey-scenarios">${JOURNEY_SCENARIOS.map(item=>`<button type="button" data-journey-scenario="${escape(item.id)}" ${disabled?'disabled':''}><span><strong>${escape(item.label)}</strong><span>${escape(item.description)}</span></span>${icon('chevron')}</button>`).join('')}</div></section>`;
  if(focusItem && focusSelector && document.getElementById('care-journey-dialog').open)host.querySelector(`[data-journey-task="${CSS.escape(focusItem)}"], [data-journey-data="${CSS.escape(focusItem)}"]`)?.querySelector(focusSelector)?.focus({preventScroll:true});
}

function openCareJourney() {
  const dialog=document.getElementById('care-journey-dialog');
  if(dialog.open)return;
  careJourneyReturnFocus=mobileRail.matches && document.getElementById('care-rail').contains(document.activeElement)?document.getElementById('open-care-menu'):document.activeElement;
  closeCareMenu({restoreFocus:false});renderCareJourney();
  dialog.returnValue='';dialog.showModal();
  document.body.classList.add('records-dialog-open');
  document.getElementById('care-journey-content').scrollTop=0;
  document.getElementById('care-journey-title').focus({preventScroll:true});
}

function trapDialogFocus(event,dialog) {
  if(event.key!=='Tab')return;
  const items=[...dialog.querySelectorAll('a[href],button:not(:disabled),summary,[tabindex]:not([tabindex="-1"])')].filter(node=>{
    if(!node.getClientRects().length || getComputedStyle(node).visibility==='hidden')return false;
    for(let ancestor=node.parentElement;ancestor && ancestor!==dialog;ancestor=ancestor.parentElement) {
      if(ancestor.tagName==='DETAILS' && !ancestor.open && !ancestor.querySelector(':scope > summary')?.contains(node))return false;
    }
    return true;
  });
  const first=items[0],last=items.at(-1);
  if(event.shiftKey && (document.activeElement===first || !items.includes(document.activeElement))){event.preventDefault();last?.focus();}
  else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
}

function hasConversationWork() {
  return Boolean(document.getElementById('request-input')?.value.trim() || document.querySelector('.message.user') || responseCount);
}

function dateLabel(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return !value || Number.isNaN(date.valueOf()) ? '방문일 확인 필요' : new Intl.DateTimeFormat('ko-KR', {month:'long',day:'numeric',weekday:'short',timeZone:'UTC'}).format(date);
}

function safeSource(value) {
  const text = String(value ?? '').slice(0,600);
  try {
    const url = new URL(text);
    if (url.protocol === 'https:' && !url.username && !url.password) return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">출처 · ${escape(url.hostname)}${icon('external')}</a>`;
  } catch { /* 출처 설명 문자열은 링크로 바꾸지 않는다. */ }
  return text ? `<span>출처 · ${escape(text)}</span>` : '';
}

function publicHospitalLocation(hospital) {
  if (!hospital?.companyName || !hospital.address) return '';
  const query = encodeURIComponent(`${hospital.companyName} ${hospital.address}`);
  return `<div class="hospital-location"><span>공개 주소 · ${escape(hospital.address)}</span><a href="https://www.google.com/maps/search/?api=1&amp;query=${query}" target="_blank" rel="noopener noreferrer">지도에서 기관 보기${icon('external')}</a></div>`;
}

function normalizeHistory(items) {
  return items.slice(-MAX_HISTORY).map(item=>({role:item.role,text:item.text.slice(0,MAX_HISTORY_TEXT)}));
}

function safeSummary() {
  try { return {progress:getProgress(caseState),support:getVisitSupportSummary(caseState),tasks:getTasks(caseState)}; }
  catch { return null; }
}

function capabilityCopy() {
  const phone = capabilities.phone === 'connected' ? '통화 서비스 설정됨' : capabilities.phone === 'simulation' ? '병원·이동 문의는 시연' : '실제 전화 미연결';
  const records = capabilities.healthRecords === 'connected' ? '기록 연계 서비스 설정됨' : capabilities.healthRecords === 'demo' ? '합성 진료기록 사용' : '공단 진료기록 미연계';
  return {phone,records};
}

function updateCapabilities(next) {
  if (next && typeof next === 'object') {
    capabilities = {
      llm: typeof next.llm === 'boolean' ? next.llm : capabilities.llm,
      model: typeof next.model === 'string' ? next.model.slice(0,160) : capabilities.model,
      phone: ['simulation','not_connected','connected'].includes(next.phone) ? next.phone : capabilities.phone,
      healthRecords: ['demo','not_connected','connected'].includes(next.healthRecords) ? next.healthRecords : capabilities.healthRecords,
      voiceInput:'browser',
    };
  }
  if (capabilities.llm !== null) capabilityState = capabilities.llm === true ? 'connected' : 'unavailable';
  const connection = document.getElementById('connection-state');
  connection.className = `connection-state ${capabilityState}`;
  connection.textContent = capabilityState === 'connected' ? '대화 연결 설정됨' : capabilityState === 'checking' ? '연결 확인 중' : 'AI 모델 미연결';
  const copy = capabilityCopy();
  document.getElementById('mode-label').textContent = `가상 사례 · ${capabilities.phone === 'connected' ? '연결 상태 확인' : '실제 발신 없음'}`;
  document.getElementById('connection-details').innerHTML = `<dl><div><dt>대화</dt><dd>${capabilities.llm === true ? '모델 연결을 설정했습니다. 실제 응답은 요청을 보낼 때 확인합니다.' : capabilityState === 'checking' ? '대화 API 연결 상태를 확인하고 있습니다.' : 'AI 모델은 아직 연결하지 않았습니다. 자유 입력은 대화 API로 전송하며, 모델 연결 뒤 작동합니다.'}</dd></div><div><dt>기록</dt><dd>${escape(copy.records)}</dd></div><div><dt>문의</dt><dd>${escape(copy.phone)}</dd></div><div><dt>음성</dt><dd>${SpeechRecognition ? '브라우저에서 한국어 요청을 텍스트로 바꿉니다.' : '이 브라우저는 음성 입력을 지원하지 않습니다. 텍스트로 요청하세요.'}</dd></div></dl><p>실제 기록 조회에는 본인인증·동의와 연계 서비스가 필요합니다. 연결 설정과 실제 처리 완료는 구분합니다.</p>`;
  const notice = document.getElementById('mode-notice');
  notice.hidden = !previewMode && capabilities.llm === true;
  notice.classList.toggle('is-preview',previewMode);
  notice.textContent = previewMode ? '고정 시나리오 미리보기 · 환자·회신은 합성, LLM·실제 발신 없음' : capabilityState === 'checking' ? '연결 범위를 확인하고 있어요.' : '자유 대화는 AI 모델 연결 후 작동합니다. 지금은 고정 예시를 미리 볼 수 있어요.';
}

function renderSnapshot() {
  renderPatientRecords();
  renderContactPlans();
  renderCareJourney();
  const snapshot = safeSummary();
  if (!snapshot) {
    document.getElementById('case-content').innerHTML = '<p class="quiet">준비 상태를 확인하지 못했어요. 대화에서 다시 확인을 요청해 주세요.</p>';
    return;
  }
  const {progress,support,tasks} = snapshot;
  const patient = caseState.patient;
  const confirmed = Object.values(caseState.inquiries).filter(item => item.status === 'confirmed').length;
  const time = caseState.visitSupport?.requirements?.appointmentTime;
  document.getElementById('case-heading').textContent = `${patient.name} 님의 진료 준비`;
  document.getElementById('case-caption').textContent = `${patient.area} · 보호자 ${patient.caregiver} · 합성 사례`;
  document.getElementById('rail-patient').textContent = `${patient.name} 님`;
  document.getElementById('rail-caregiver').textContent = `보호자 ${patient.caregiver}의 가상 가족 사례`;
  document.getElementById('rail-area').textContent = patient.area;
  renderPreferences();
  const items = [
    {name:'병원 문의',value:`${confirmed}/2곳 절차 확인${confirmed?' · 합성':''}`,detail:caseState.selectedHospital?.companyName || '제주 기관 확인 필요',ready:confirmed===2,symbol:'hospital',location:publicHospitalLocation(caseState.selectedHospital)},
    {name:'진료 자료',value:`${progress.prepared}/${progress.total}개 준비`,detail:progress.prepared===progress.total?'요청 자료 준비됨':'요청된 자료를 확인합니다.',ready:progress.prepared===progress.total,symbol:'folder'},
    {name:'택시 이동',value:support.taxi.label,detail:support.taxi.providerName || '지역 문의처 확인',ready:support.taxi.ready,symbol:'car'},
    {name:'병원 동행',value:support.companion.label,detail:support.companion.providerName || '필요한 지원 확인',ready:support.companion.ready,symbol:'users'},
  ];
  document.getElementById('mobile-case-summary').innerHTML = `<div class="mobile-summary-date"><strong>${escape(dateLabel(patient.nextVisit))}${time?` · ${escape(time)}`:''}</strong><span>시연 일정 · 예약 미확정</span></div><div class="mobile-summary-states"><span>병원 ${confirmed}/2${confirmed?'(합성)':''}</span><span>자료 ${progress.prepared}/${progress.total}</span><span>택시 ${support.taxi.ready?'시연 가능':'확인 필요'}</span><span>동행 ${support.companion.ready?'시연 가능':'확인 필요'}</span></div>`;
  const pendingItems = latestActions.length ? latestActions.map(item => ({title:item.label || '확인할 내용',reason:item.reason || ''})) : tasks.slice(0,2).map(task => ({title:task.title,reason:task.owner}));
  document.getElementById('case-content').innerHTML = `<div class="visit-date">${icon('calendar')}<div><span>이번 방문 · 시연 일정</span><strong>${escape(dateLabel(patient.nextVisit))}</strong><small>${time?`${escape(time)} 시각 가정`:'진료 시각 미정'} · ${escape(patient.area)} 출발</small></div></div><div class="read-only-statuses">${items.map(item => `<div class="read-only-status ${item.ready?'ready':''}" data-case-status="${escape(item.name)}">${icon(item.symbol)}<div><span>${escape(item.name)}</span><strong>${escape(item.value)}</strong><small>${escape(item.detail)}</small>${item.location || ''}</div>${item.ready?icon('check'):''}</div>`).join('')}</div><div class="next-confirmation"><h3>${responseCount?'다음 확인':'함께 확인할 내용'}</h3>${pendingItems.length ? `<ul>${pendingItems.map(item => `<li><strong>${escape(item.title)}</strong>${item.reason?`<span>${escape(item.reason)}</span>`:''}</li>`).join('')}</ul>` : '<p>현재 응답의 준비 내역을 확인해 주세요. 실제 예약·배정은 제공기관의 확인이 필요합니다.</p>'}</div><p class="snapshot-note">${icon('info')}이곳은 대화에서 준비한 내용을 보여줍니다. 수정할 내용도 말로 알려주세요.</p>`;
  const sourceItems = [];
  if (caseState.selectedHospital?.source) sourceItems.push({label:'제주 기관',source:caseState.selectedHospital.source.url});
  for (const kind of ['taxi','companion']) {
    const provider = caseState.visitSupport?.[kind]?.provider;
    if (provider) sourceItems.push({label:kind==='taxi'?'이동 문의처':'동행 문의처',source:provider.source?.url});
  }
  document.getElementById('case-sources').innerHTML = sourceItems.length ? sourceItems.map(item=>`<div><strong>${escape(item.label)}</strong>${safeSource(item.source)}</div>`).join('') : '<p>Agent가 자료를 조회하면 사용한 출처를 처리 기록과 함께 보여드립니다.</p>';
  document.getElementById('save-report').disabled = responseCount === 0;
}

function eventsMarkup(events) {
  if (!events.length) return '';
  const labels = {completed:'처리됨',needs_input:'확인 필요',not_connected:'미연결',error:'확인 실패'};
  return `<details class="tool-records"><summary>${icon('file')}이번 요청에서 확인한 일 <span>${events.length}건</span>${icon('chevron')}</summary><ol>${events.map(event => `<li class="tool-record ${escape(event.status)}" data-tool-status="${escape(event.status)}"><span class="tool-state-dot"></span><div><div class="tool-record-heading"><strong>${escape(event.label)}</strong><span>${labels[event.status] || '상태 확인'}${event.isSimulation?' · 합성':''}</span></div>${event.detail?`<p>${escape(event.detail)}</p>`:''}${event.source?`<div class="tool-source">${safeSource(event.source)}</div>`:''}</div></li>`).join('')}</ol></details>`;
}

function appendMessage({role,text,id=makeId(),events=[],greeting=false,isExample=false}) {
  const node = document.createElement('article');
  node.className = `message ${role} ${greeting?'greeting':''}`;
  node.dataset.messageId = id;
  const body=greeting?`<div class="welcome-content"><h2>이번 진료에 필요한 일,<br>편하게 말씀해 주세요.</h2><div class="welcome-copy">${formatMessage(text)}</div></div>`:formatMessage(text);
  node.innerHTML = `<div class="message-meta">${role==='assistant'?'<img src="/assets/hondi-mark-v1.png" alt="" width="23" height="23"/>':''}<strong>${role==='user'?'보호자':'혼디'}</strong>${isExample?'<span class="example-label">작성된 예시</span>':greeting?'':`<time>${escape(timeLabel(new Date()))}</time>`}</div><div class="message-body">${body}</div>${eventsMarkup(events)}`;
  document.getElementById('message-list').append(node);
  return node;
}

function scrollToLatest() {
  const scroll = document.getElementById('conversation-scroll');
  const request=activeRequest;
  requestAnimationFrame(()=>{
    if(request && activeRequest!==request)return;
    if(document.querySelector('.chat-workspace').classList.contains('flow-layout'))document.getElementById('pending-message').scrollIntoView({block:'nearest',behavior:'instant'});
    else scroll.scrollTop=scroll.scrollHeight;
  });
}

function scrollToMessage(node) {
  if(!node)return;
  requestAnimationFrame(()=>{
    if(!node.isConnected)return;
    const scroll=document.getElementById('conversation-scroll');
    if(document.querySelector('.chat-workspace').classList.contains('flow-layout'))node.scrollIntoView({block:'start',behavior:'instant'});
    else scroll.scrollTop+=node.getBoundingClientRect().top-scroll.getBoundingClientRect().top-22;
  });
}

function resizeInput() {
  const input = document.getElementById('request-input');
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight,160)}px`;
  document.getElementById('send-request').disabled = pending || Boolean(activeRecognition) || !input.value.trim();
  document.getElementById('character-count').textContent = `${input.value.length}/${MAX_MESSAGE}`;
  for(const button of document.querySelectorAll('[data-contact-draft],[data-journey-draft],[data-journey-scenario],[data-call-recovery-scenario]'))button.disabled=pending || Boolean(activeRecognition);
  updateConversationLayout();
}

// 작은 높이·확대 글꼴에서는 대화/입력/고지를 문서 흐름으로 함께 읽는다.
function updateConversationLayout() {
  cancelAnimationFrame(layoutFrame);
  layoutFrame=requestAnimationFrame(()=>{
    const workspace=document.querySelector('.chat-workspace');
    const scroll=document.getElementById('conversation-scroll');
    if(!workspace || !scroll)return;
    const viewportHeight=Math.min(window.innerHeight,window.visualViewport?.height ?? window.innerHeight);
    const shortScreen=viewportHeight<=720;
    workspace.classList.remove('flow-layout');
    const style=getComputedStyle(scroll);
    const readingHeight=scroll.clientHeight-parseFloat(style.paddingTop)-parseFloat(style.paddingBottom);
    workspace.classList.toggle('flow-layout',shortScreen || readingHeight<112 || workspace.scrollHeight>workspace.clientHeight+1);
  });
}

function fillRequestDraft(text,{source='요청 예시',focus=true}={}) {
  if(pending || activeRecognition)return false;
  const input=document.getElementById('request-input');
  const draft=String(text || '').trim().slice(0,MAX_MESSAGE);
  if(!draft)return false;
  if(input.value.trim() && input.value.trim()!==draft && !window.confirm('입력창에 작성 중인 요청이 있어요. 선택한 문구로 바꿀까요? 취소하면 기존 초안을 유지합니다.'))return false;
  input.value=draft;resizeInput();
  voiceMessage(`${source}를 입력창에 넣었어요. 날짜·대상을 확인하고 고친 뒤 보내 주세요.`);
  if(focus){input.focus({preventScroll:true});input.scrollIntoView({block:'nearest',behavior:'instant'});}
  return true;
}

function setPending(value) {
  pending = value;
  document.getElementById('request-input').readOnly = value;
  document.getElementById('send-request').disabled = value || !document.getElementById('request-input').value.trim();
  document.getElementById('voice-request').disabled = value || !SpeechRecognition;
  document.getElementById('new-conversation').disabled = value;
  document.getElementById('preview-button').disabled = value;
  document.getElementById('pending-message').hidden = !value;
  document.getElementById('conversation-form').setAttribute('aria-busy',String(value));
  document.getElementById('send-request').setAttribute('aria-label',value?'요청 응답을 기다리는 중':'요청 보내기');
  for (const button of document.querySelectorAll('[data-example]')) button.disabled=value;
  for (const button of document.querySelectorAll('[data-contact-draft],[data-journey-draft],[data-journey-scenario],[data-call-recovery-scenario]')) button.disabled=value || Boolean(activeRecognition);
  updateConversationLayout();
  if (value) scrollToLatest();
}

function requestIsCurrent(request) {
  return activeRequest===request && request.version===conversationVersion;
}

function beginRequest(kind,values,timeout) {
  const request={...values,kind,version:conversationVersion,controller:new AbortController()};
  activeRequest=request;
  request.timer=setTimeout(()=>{if(requestIsCurrent(request))cancelRequest({timedOut:true});},timeout);
  setPending(true);
  return request;
}

function finishRequest(request) {
  clearTimeout(request.timer);
  if(!requestIsCurrent(request))return false;
  activeRequest=undefined;setPending(false);
  if(request.kind==='preview')document.getElementById('preview-button').textContent='대화 흐름 미리보기';
  return true;
}

function showRequestProblem(request,copy,{uncertain=false}={}) {
  failedRequests.set(request.requestId,{text:request.text,body:request.body});
  const firstRequestWarning=uncertain && !request.body.sessionId ? '첫 응답을 받기 전이라 재시도하면 서버에서 같은 일을 한 번 더 처리하고 시연 이용 횟수가 추가될 수 있어요.' : '';
  const node=request.messageNode;
  if(node?.isConnected) {
    node.classList.add('failed');node.querySelector('.request-error')?.remove();
    const problem=document.createElement('div');problem.className='request-error';problem.setAttribute('role','alert');
    problem.innerHTML=`<p>${escape(copy)}</p>${firstRequestWarning?`<p>${escape(firstRequestWarning)}</p>`:''}<button type="button" class="text-button" data-retry="${escape(request.requestId)}">같은 요청 다시 확인${icon('refresh')}</button>`;
    node.append(problem);
  }
  const input=document.getElementById('request-input');
  input.value=request.text;resizeInput();
}

function cancelRequest({timedOut=false}={}) {
  const request=activeRequest;
  if(!request || !requestIsCurrent(request))return;
  request.stopReason=timedOut?'timeout':'user';request.controller.abort();
  if(request.kind==='message') {
    const copy=timedOut?'응답을 오래 기다려 이 화면의 대기를 마치고 요청을 복원했어요.':'응답 대기를 중지하고 요청을 입력창에 복원했어요.';
    showRequestProblem(request,copy+' 서버 처리는 계속될 수 있습니다. 실제 발신을 중단했다는 뜻은 아니며, 현재 실제 전화는 연결되어 있지 않습니다.',{uncertain:true});
  } else {
    failedPreviewRequest=request.body;
    const notice=document.getElementById('mode-notice');
    notice.hidden=false;notice.textContent=(timedOut?'미리보기 응답을 오래 기다려 이 화면의 대기를 마쳤어요.':'미리보기 응답 대기를 중지했어요.')+' 현재 대화와 초안은 유지됩니다. 서버 처리는 계속될 수 있습니다.';
  }
  document.getElementById('conversation-status').textContent='이 화면의 응답 대기를 중지했습니다. 서버 처리 중단을 확인한 것은 아닙니다.';
  finishRequest(request);
  if(request.messageNode)scrollToMessage(request.messageNode);
  document.getElementById('request-input').focus({preventScroll:true});
}

function errorCopy(code) {
  if (/MODEL_NOT_CONFIGURED|MODEL_DISABLED|LLM_NOT_CONFIGURED|MODEL_NOT_CONNECTED/.test(code)) return 'AI 모델이 아직 연결되지 않았어요. 입력한 요청은 그대로 남겨두었습니다. 준비 흐름은 ‘대화 흐름 미리보기’에서 볼 수 있어요.';
  if (/LOOP_LIMIT|TOOL_LIMIT/.test(code)) return '한 번에 확인할 일이 많아 이번 요청을 마치지 못했어요. 요청을 나누어 다시 말씀해 주세요.';
  if (/DAILY_LIMIT/.test(code)) return '오늘의 시연 이용 한도에 도달했어요. 한국 시간 오전 9시에 새 한도가 열립니다.';
  if (/TURN_LIMIT/.test(code)) return '이 대화의 요청 한도에 도달했어요. 준비 내역을 저장하고 새 대화를 시작해 주세요.';
  if (/RATE_LIMIT/.test(code)) return '요청이 몰리고 있어요. 잠시 뒤 같은 요청을 다시 확인해 주세요.';
  if (/SESSION_BUSY/.test(code)) return '앞선 요청을 아직 처리하고 있어요. 잠시 뒤 같은 요청을 다시 확인해 주세요.';
  if (/SESSION_STORE_UNAVAILABLE|CLOUD_RUNTIME_UNAVAILABLE/.test(code)) return '준비 상태를 저장하는 곳에 연결하지 못했어요. 입력은 남겨두었습니다. 잠시 뒤 같은 요청을 확인해 주세요.';
  if (/LIMIT|BUDGET|RATE|QUOTA/.test(code)) return '지금은 대화 이용 한도에 도달했어요. 잠시 뒤 다시 요청해 주세요.';
  if (/SESSION/.test(code)) return '이 대화 연결이 만료됐어요. 새 대화에서 다시 시작해 주세요.';
  if (/TIMEOUT|ABORT/.test(code)) return '응답을 기다리는 시간이 길어졌어요. 같은 요청을 다시 확인할 수 있습니다.';
  if (/VALIDATION|INVALID_MESSAGE/.test(code)) return '요청을 짧게 다시 말씀해 주세요. 주민번호·인증정보는 입력하지 마세요.';
  return '대화 서비스에 연결하지 못했어요. 요청 내용은 입력창에 남겨두었습니다. 잠시 뒤 다시 보내주세요.';
}

function normalizeResponse(data) {
  if (!data || typeof data.reply!=='string' || !data.reply.trim() || data.reply.length>16000 || typeof data.sessionId!=='string' || data.sessionId.length>160 || !data.caseState?.patient) throw new Error('INVALID_RESPONSE');
  getProgress(data.caseState); getVisitSupportSummary(data.caseState); getTasks(data.caseState);
  const events = (Array.isArray(data.events)?data.events:[]).slice(0,24).map((event,index)=>({
    id:String(event.id || index),tool:String(event.tool || '').slice(0,100),label:String(event.label || '요청 처리').slice(0,200),
    status:['completed','needs_input','not_connected','error'].includes(event.status)?event.status:'needs_input',
    detail:String(event.detail || '').slice(0,1600),isSimulation:event.isSimulation===true,source:typeof event.source==='string'?event.source.slice(0,1000):'',
  }));
  const actions = (Array.isArray(data.pendingActions)?data.pendingActions:[]).slice(0,12).map(item=>({id:String(item.id || ''),kind:String(item.kind || ''),label:String(item.label || '').slice(0,240),reason:String(item.reason || '').slice(0,600)}));
  return {...data,events,pendingActions:actions};
}

async function payloadHash(payload) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload));
  return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

// 모델 연결을 바꿔도 화면·음성 입력은 이 API 경로를 그대로 사용한다.
async function callAgent(path,body,signal) {
  const payload=JSON.stringify(body);
  const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json','x-amz-content-sha256':await payloadHash(payload)},body:payload,signal,cache:'no-store'});
  let raw;
  try {raw=await response.json();} catch {throw new Error('INVALID_RESPONSE');}
  if(!response.ok || raw?.error)throw new Error(String(raw?.error?.code || `HTTP_${response.status}`));
  return normalizeResponse(raw);
}

async function showPreview(scenarioId='aewol-parent-visit') {
  if(pending || activeRecognition)return;
  if(!['aewol-parent-visit',...JOURNEY_SCENARIOS.map(item=>item.id),...CALL_RECOVERY_SCENARIOS.map(item=>item.id)].includes(scenarioId))return;
  if(hasConversationWork() && !window.confirm('고정 예시를 열면 현재 대화와 작성 중인 요청이 사라집니다. 미리보기를 열까요?'))return;
  const body=failedPreviewRequest?.scenarioId===scenarioId?failedPreviewRequest:{scenarioId,requestId:makeId()};
  const journeyDialog=document.getElementById('care-journey-dialog');
  if(journeyDialog.open)journeyDialog.close('preview');
  const contactDialog=document.getElementById('contact-plan-dialog');
  if(contactDialog.open)contactDialog.close('preview');
  const request=beginRequest('preview',{body},30000);
  const button=document.getElementById('preview-button');
  const notice=document.getElementById('mode-notice');
  button.textContent='미리보기 불러오는 중';
  try {
    const data=await callAgent(API+'/preview',request.body,request.controller.signal);
    if(!requestIsCurrent(request))return;
    if(data.isPreview!==true || !Array.isArray(data.previewMessages) || !data.previewMessages.length)throw new Error('INVALID_PREVIEW');
    const messages=data.previewMessages.slice(0,12).filter(message=>['user','assistant'].includes(message.role) && typeof message.text==='string' && message.text.trim()).map(message=>({role:message.role,text:message.text.slice(0,16000)}));
    if(!messages.length)throw new Error('INVALID_PREVIEW');
    const last=messages.at(-1);
    if(last.role!=='assistant' || last.text!==data.reply)messages.push({role:'assistant',text:data.reply});
    previewMode=true;sessionId=undefined;history=[];failedRequests.clear();
    failedPreviewRequest=undefined;
    caseState=data.caseState;latestActions=data.pendingActions;latestEvents=data.events;responseCount=1;
    document.getElementById('request-input').value='';resizeInput();
    document.getElementById('message-list').replaceChildren();
    document.getElementById('starter-prompts').hidden=true;
    messages.forEach((message,index)=>appendMessage({...message,isExample:true,events:index===messages.length-1?data.events:[]}));
    // 미리보기의 LLM 미사용은 전역 모델 연결 설정과 별개다.
    updateCapabilities();renderSnapshot();
    document.getElementById('conversation-status').textContent='고정된 합성 대화 예시를 불러왔습니다. 실제 모델 응답과 전화는 아닙니다.';
    requestAnimationFrame(()=>{document.getElementById('conversation-scroll').scrollTop=0;});
  } catch {
    if(!requestIsCurrent(request))return;
    failedPreviewRequest=request.body;
    notice.hidden=false;notice.textContent='미리보기를 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 눌러주세요.';
    document.getElementById('conversation-status').textContent=notice.textContent;
  } finally {
    finishRequest(request);
  }
}

async function sendRequest(text,retryId) {
  if (pending || activeRecognition) return;
  const input=document.getElementById('request-input');
  const failed=retryId?failedRequests.get(retryId):undefined;
  if(retryId && !failed)return;
  text=String(failed?.text ?? text ?? input.value).trim();
  if (!text || text.length>MAX_MESSAGE) return;
  if(retryId && input.value.trim() && input.value.trim()!==text && !window.confirm('같은 요청을 다시 확인하면 작성 중인 새 초안을 원래 요청으로 바꿉니다. 계속할까요?'))return;
  if(previewMode)resetConversation({focus:false,force:true});
  const requestId=retryId || makeId();
  const requestBody=failed ? failed.body : {message:text,...(sessionId?{sessionId}:{}),history:normalizeHistory(history),requestId,preferences:{...carePreferences},applyPreferences:preferencesNeedApply};
  let messageNode,replyNode;
  if (retryId) {
    messageNode=document.querySelector(`[data-message-id="${requestId}"]`);
    messageNode?.querySelector('.request-error')?.remove();
    messageNode?.classList.remove('failed');
  } else messageNode=appendMessage({role:'user',text,id:requestId});
  document.getElementById('starter-prompts').hidden=true;
  input.value='';resizeInput();
  const request=beginRequest('message',{text,requestId,body:requestBody,messageNode},65000);
  try {
    const data=await callAgent(API,requestBody,request.controller.signal);
    if(!requestIsCurrent(request))return;
    caseState=data.caseState;sessionId=data.sessionId;latestActions=data.pendingActions;latestEvents=data.events;responseCount++;
    history=normalizeHistory([...history,{role:'user',text},{role:'assistant',text:data.reply}]);
    failedRequests.delete(requestId);
    if(preferencesEqual(requestBody.preferences,carePreferences))preferencesNeedApply=false;
    replyNode=appendMessage({role:'assistant',text:data.reply,events:data.events});
    updateCapabilities(data.capabilities);renderSnapshot();
    document.getElementById('conversation-status').textContent=data.needsInput?'필요한 내용을 이어서 말씀해 주세요.':'준비 내용을 갱신했습니다.';
  } catch(error) {
    if(!requestIsCurrent(request))return;
    const code=error.name==='AbortError'?'MODEL_TIMEOUT':error.message || 'CONNECTION_ERROR';
    const copy=errorCopy(code)+(request.stopReason==='timeout'?' 이 화면의 대기만 끝났으며 서버 처리는 계속될 수 있습니다.':'' );
    showRequestProblem(request,copy,{uncertain:request.stopReason==='timeout'});
    document.getElementById('conversation-status').textContent='요청 전송을 확인하지 못했습니다.';
    updateCapabilities(/MODEL_NOT_CONFIGURED|MODEL_DISABLED|LLM_NOT_CONFIGURED|MODEL_NOT_CONNECTED/.test(code)?{llm:false}:undefined);
  } finally {
    if(finishRequest(request)) {
      scrollToMessage(replyNode || messageNode);
      if (window.matchMedia('(min-width:961px)').matches)input.focus({preventScroll:true});
    }
  }
}

function voiceMessage(text,error=false) {
  const hint=document.getElementById('voice-help');hint.textContent=text;hint.classList.toggle('error',error);
}

function resetVoiceButton() {
  const button=document.getElementById('voice-request');button.classList.remove('listening');button.setAttribute('aria-pressed','false');button.setAttribute('aria-label','음성으로 요청하기');button.innerHTML=micIcon+'<span>말로 요청</span>';
}

function startVoice() {
  if (pending || !SpeechRecognition) return;
  if (activeRecognition) {
    recognitionCancelled=true;activeRecognition.abort();
    document.getElementById('request-input').value=voiceBase;resizeInput();
    voiceMessage('음성 입력을 중지했어요. 텍스트로도 요청할 수 있습니다.');
    return;
  }
  recognitionCancelled=false;recognitionFailed=false;finalTranscript='';voiceBase=document.getElementById('request-input').value.trim();
  const recognition=new SpeechRecognition();activeRecognition=recognition;
  recognition.lang='ko-KR';recognition.interimResults=true;recognition.continuous=false;recognition.maxAlternatives=1;
  recognition.onstart=()=>{
    const button=document.getElementById('voice-request');button.classList.add('listening');button.setAttribute('aria-pressed','true');button.setAttribute('aria-label','음성 입력 중지');button.innerHTML=stopIcon+'<span>듣기 중지</span>';
    voiceMessage('듣고 있어요. 말이 끝나면 내용을 확인하고 보내 주세요.');
    resizeInput();
  };
  recognition.onresult=event=>{
    let interim='';
    for(let index=event.resultIndex;index<event.results.length;index++) {
      const transcript=event.results[index][0]?.transcript || '';
      if(event.results[index].isFinal)finalTranscript+=transcript;else interim+=transcript;
    }
    const value=[voiceBase,finalTranscript,interim].filter(Boolean).join(' ').slice(0,MAX_MESSAGE);
    document.getElementById('request-input').value=value;resizeInput();
  };
  recognition.onspeechend=()=>recognition.stop();
  recognition.onerror=event=>{
    recognitionFailed=true;
    const errors={'not-allowed':'마이크 권한이 허용되지 않았어요. 텍스트로 요청할 수 있습니다.','service-not-allowed':'이 브라우저에서 음성 서비스를 사용할 수 없어요. 텍스트로 요청해 주세요.','no-speech':'음성을 인식하지 못했어요. 다시 말하거나 텍스트로 요청해 주세요.','audio-capture':'마이크를 찾지 못했어요. 기기 설정을 확인하거나 텍스트로 요청해 주세요.',network:'음성 인식에 연결하지 못했어요. 텍스트로 요청해 주세요.','language-not-supported':'한국어 음성 인식을 사용할 수 없어요. 텍스트로 요청해 주세요.'};
    if(!recognitionCancelled)voiceMessage(errors[event.error] || '음성 입력을 마치지 못했어요. 텍스트로 요청할 수 있습니다.',true);
  };
  recognition.onend=()=>{
    if(activeRecognition!==recognition)return;
    activeRecognition=undefined;resetVoiceButton();resizeInput();
    if(!recognitionCancelled && !recognitionFailed && finalTranscript.trim()) {
      const message=[voiceBase,finalTranscript.trim()].filter(Boolean).join(' ').slice(0,MAX_MESSAGE);
      document.getElementById('request-input').value=message;resizeInput();
      voiceMessage('인식한 내용을 확인해 주세요. 날짜·기관명을 고친 뒤 보내면 됩니다.');
      document.getElementById('request-input').focus({preventScroll:true});
    } else if(!recognitionCancelled && !recognitionFailed)voiceMessage('인식된 내용이 없어요. 다시 말하거나 텍스트로 요청해 주세요.');
  };
  try {recognition.start();} catch {activeRecognition=undefined;resetVoiceButton();resizeInput();voiceMessage('음성 입력을 시작하지 못했어요. 텍스트로 요청할 수 있습니다.',true);}
}

function resetConversation({focus=true,force=false}={}) {
  if(pending)return false;
  if(!force && hasConversationWork() && !window.confirm('현재 대화와 작성 중인 요청이 사라집니다. 새 가상 사례를 시작할까요?'))return false;
  if(activeRecognition){recognitionCancelled=true;activeRecognition.abort();activeRecognition=undefined;resetVoiceButton();}
  conversationVersion++;failedPreviewRequest=undefined;
  caseState=createDemoCase();sessionId=undefined;history=[];latestActions=[];latestEvents=[];responseCount=0;previewMode=false;failedRequests.clear();
  preferencesNeedApply=true;
  document.getElementById('message-list').replaceChildren();
  welcomeMessage();document.getElementById('starter-prompts').hidden=false;
  document.getElementById('request-input').value='';resizeInput();renderSnapshot();updateCapabilities();
  document.getElementById('conversation-status').textContent='새 가상 사례로 대화를 시작합니다.';
  if(focus)document.getElementById('request-input').focus({preventScroll:true});
  return true;
}

function saveReport() {
  if(!responseCount)return;
  const body=(previewMode?'# 고정 시나리오 미리보기\n\n작성된 합성 대화 예시입니다. 실제 모델 응답·발신·예약 결과가 아닙니다.\n\n':'')+buildReport(caseState)+'\n\n## API가 반환한 도구 처리 기록\n\n'+latestEvents.map(event=>`- ${event.label}: ${event.detail} (${event.isSimulation?'시연':event.status})${event.source?' · '+event.source:''}`).join('\n');
  const url=URL.createObjectURL(new Blob([body],{type:'text/markdown;charset=utf-8'}));
  const anchor=document.createElement('a');anchor.href=url;anchor.download='제주-진료-준비-보고서.md';anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function welcomeMessage() {
  appendMessage({role:'assistant',greeting:true,text:'제주 진찰과 기존 도외 주치의 검토를 이어갈 자료·이동·동행 준비를 도와드려요.'});
}

function mount() {
  const brand=`<img src="/assets/hondi-logo-v1.png" alt="" width="480" height="168"/>`;
  const menuIcon='<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
  document.getElementById('app').innerHTML=`
    <div class="app-shell">
      <header class="mobile-app-header" id="mobile-app-header">
        <a class="brand" href="/" aria-label="혼디 홈">${brand}</a>
        <button type="button" id="open-care-menu" class="menu-button" aria-controls="care-rail" aria-expanded="false">${menuIcon}<span>설정</span></button>
      </header>
      <button type="button" id="drawer-backdrop" class="drawer-backdrop" aria-label="설정 닫기" tabindex="-1" hidden></button>
      <aside class="care-rail" id="care-rail" aria-label="가상 가족 사례와 기본 설정" tabindex="-1">
        <div class="rail-brand-row"><a class="brand" href="/" aria-label="혼디 홈">${brand}</a><button type="button" id="close-care-menu" class="close-menu" aria-label="설정 닫기">${icon('close')}</button></div>
        <section class="rail-case" aria-labelledby="rail-patient">
          <span class="case-person">${icon('user')}</span><h2 id="rail-patient"></h2>
          <p id="rail-area"></p><p id="rail-caregiver"></p>
          <span class="case-demo">가상 사례 체험 중</span>
        </section>
        <nav class="rail-nav" aria-label="준비 화면 이동">
          <a href="#main" id="nav-preparation" class="active" aria-current="location">${icon('compass')}<span>진료 준비</span>${icon('chevron')}</a>
          <a href="#care-journey-dialog" id="nav-care-journey" aria-haspopup="dialog" aria-controls="care-journey-dialog">${icon('file')}<span>진료 연결 여정</span>${icon('chevron')}</a>
          <a href="#patient-records-dialog" id="nav-patient-records" aria-haspopup="dialog" aria-controls="patient-records-dialog">${icon('folder')}<span>환자 정보·건강 기록</span>${icon('chevron')}</a>
          <a href="#contact-plan-dialog" id="nav-contact-plan" aria-haspopup="dialog" aria-controls="contact-plan-dialog">${icon('phone')}<span>전화·협진 준비</span>${icon('chevron')}</a>
          <a href="#care-preferences" id="nav-preferences">${icon('car')}<span>이동·동행 설정</span>${icon('chevron')}</a>
        </nav>
        <section class="preference-panel" id="care-preferences" aria-labelledby="preferences-heading" tabindex="-1">
          <h2 id="preferences-heading">이동·동행 기본 설정</h2>
          <p class="preference-intro">매번 말씀하지 않아도 되도록.<br>필요한 조건만 정해 두세요.</p>
          <form id="preferences-form">
            <label class="select-label" for="pref-taxi">선호 택시 문의처</label>
            <select id="pref-taxi" name="taxiProviderId" aria-describedby="taxi-preference-note"></select>
            <p class="field-note" id="taxi-preference-note">공개 문의처 · 실제 배차·예약 미확정</p>
            <label class="preference-toggle" for="pref-wheelchair"><span>휠체어 차량 필요</span><input type="checkbox" id="pref-wheelchair" name="wheelchair"/></label>
            <label class="preference-toggle" for="pref-companion"><span>병원 동행 필요</span><input type="checkbox" id="pref-companion" name="companionNeeded"/></label>
          </form>
          <p class="preference-feedback" id="preferences-status" role="status" aria-live="polite"></p>
          <p class="field-note">설정은 선택이에요. 대화에서 말씀하신 조건을 먼저 따릅니다.</p>
        </section>
        <p class="rail-note">${icon('lock')}이 기기에는 위의 기본 설정만 저장해요. 대화와 의료기록은 저장하지 않습니다.</p>
      </aside>
      <div class="workspace-shell" id="workspace-shell">
        <main id="main" class="page-main" tabindex="-1">
          <header class="workspace-header">
            <div class="case-header"><h1 id="case-heading"></h1><p id="case-caption"></p></div>
            <div class="header-actions"><span class="connection-state checking" id="connection-state">연결 확인 중</span><button type="button" class="header-button" id="new-conversation">${icon('plus')}<span>새 대화</span></button></div>
          </header>
          <div class="mobile-case-summary" id="mobile-case-summary" aria-label="이번 방문 요약"></div>
          <div class="conversation-layout">
            <section class="chat-workspace" aria-labelledby="conversation-title">
              <div class="chat-toolbar"><h2 id="conversation-title">혼디와 준비하기</h2><button type="button" id="preview-button" class="preview-button">대화 흐름 미리보기${icon('chevron')}</button></div>
              <p class="mode-notice" id="mode-notice">연결 범위를 확인하고 있어요.</p>
              <div class="conversation-scroll" id="conversation-scroll">
                <section class="care-journey-summary" id="care-journey-summary" aria-label="현재 진료 연결과 다음 행동"><div class="journey-summary-state"><h3>현재</h3><strong id="care-journey-current">미확인</strong></div><button type="button" id="open-care-journey" aria-haspopup="dialog" aria-controls="care-journey-dialog">여정·할 일 보기${icon('chevron')}</button><p class="journey-summary-next"><span>다음</span><strong id="care-journey-next"></strong></p><p class="journey-summary-flow">자료 → 병원 문의 → 이동·동행 후속 확인</p></section>
                <div class="message-list" id="message-list" role="log" aria-label="진료 준비 대화" aria-live="polite" aria-relevant="additions"></div>
              </div>
              <div class="pending-message" id="pending-message" hidden><div class="pending-summary"><span class="working-mark"></span><p role="status">요청 응답을 기다리고 있어요.</p></div><button type="button" id="cancel-request" class="cancel-request">응답 대기 중지</button><p class="pending-note">이 화면의 대기만 중지해요. 서버 처리는 계속될 수 있습니다.</p></div>
              <div class="starter-prompts" id="starter-prompts"><p>이렇게 요청해 보세요</p>
                  <button type="button" data-example="저는 동행이 어려워요. 자료와 이동도 준비해 주세요."><span>저는 동행이 어려워요.<br> 자료와 이동도 준비해 주세요.</span>${icon('arrow')}</button>
                  <button type="button" class="secondary-prompt" data-example="어머니가 휠체어를 이용하세요. 무엇을 확인해야 할까요?"><span>어머니가 휠체어를 이용하세요.<br> 무엇을 확인해야 할까요?</span>${icon('arrow')}</button>
                </div>
              <form id="conversation-form" class="conversation-form" aria-busy="false">
                <label for="request-input" class="visually-hidden">진료 준비 요청</label>
                <textarea id="request-input" name="message" rows="2" maxlength="${MAX_MESSAGE}" placeholder="예: 어머니 진료 자료와 이동·동행을 준비해줘." autocomplete="off" aria-describedby="composer-disclosure privacy-note voice-help" required></textarea>
                <div class="composer-actions"><button type="button" id="voice-request" class="voice-button" aria-label="음성으로 요청하기" aria-pressed="false" aria-describedby="voice-help" ${SpeechRecognition?'':'disabled'}>${micIcon}<span>말로 요청</span></button><span class="keyboard-hint">Enter로 전송 · Shift+Enter 줄바꿈</span><span class="character-count" id="character-count">0/${MAX_MESSAGE}</span><button type="submit" class="send-button" id="send-request" aria-label="요청 보내기" disabled>${icon('arrow')}<span>보내기</span></button></div>
                <p class="voice-help" id="voice-help" role="status">${SpeechRecognition?'음성은 인식한 내용을 확인한 뒤 보내요.':'음성 미지원 브라우저예요. 텍스트로 요청해 주세요.'}</p>
              </form>
              <div class="composer-notes"><p class="composer-disclosure" id="composer-disclosure">${icon('info')}가상 사례 · 실제 연락·예약 없음</p><p class="privacy-note" id="privacy-note">주민번호·인증정보·실제 의료기록 입력 금지 · 대화는 새로고침하면 사라져요.</p></div>
            </section>
            <aside class="case-sidebar" aria-label="대화에서 준비한 내용">
              <details class="case-summary" id="case-summary" ${window.matchMedia('(min-width:901px)').matches?'open':''}><summary><span>${icon('calendar')}이번 방문 준비</span>${icon('chevron')}</summary><div id="case-content"></div></details>
              <button type="button" class="report-button" id="save-report" title="대화 응답 후 준비 내역을 저장할 수 있어요." disabled>${icon('download')}준비 내역 저장</button>
              <details class="connection-details"><summary>지금 연결된 범위${icon('chevron')}</summary><div id="connection-details"></div></details>
              <details class="source-details"><summary>준비에 사용한 출처${icon('chevron')}</summary><div id="case-sources"></div></details>
              <span class="mode-label" id="mode-label">가상 사례 · 실제 발신 없음</span><p class="service-note">진찰과 진료 계획은 의료진이 결정합니다. 등록된 문의처와 실제 예약·배정은 다릅니다.</p>
            </aside>
          </div>
          <p id="conversation-status" class="visually-hidden" role="status" aria-live="polite"></p>
        </main>
      </div>
      <dialog class="patient-records-dialog" id="patient-records-dialog" aria-labelledby="patient-records-title" aria-describedby="patient-records-description">
        <header class="patient-records-header"><div><h2 id="patient-records-title" tabindex="-1">환자 정보·건강 기록</h2><p id="patient-records-description">가상 사례 · 합성 정보 · 읽기 전용</p></div><button type="button" id="close-patient-records" class="close-records" aria-label="환자 정보·건강 기록 닫기">${icon('close')}</button></header>
        <div class="patient-records-body" id="patient-records-body">
          <section class="records-section" aria-labelledby="patient-basics-title"><h3 id="patient-basics-title">현재 준비 대상</h3><dl class="patient-basics" id="patient-basics"></dl><p class="records-note">방문일은 시연 일정이며 실제 예약이 확정된 상태가 아닙니다.</p></section>
          <section class="records-section health-highway" aria-labelledby="health-highway-title"><div class="records-section-heading"><h3 id="health-highway-title">건강정보 고속도로</h3><span class="connector-state" id="health-highway-status">미연결</span></div><dl class="connector-facts"><div><dt>최근 불러오기</dt><dd id="health-highway-last-sync">불러온 기록 없음</dd></div><div><dt>현재 표시 자료</dt><dd>가상 사례의 합성 자료</dd></div></dl><p class="records-note">현재 자료는 건강정보 고속도로·공단에서 조회한 기록이 아닙니다. 연결되지 않아 실제 건강 상태는 확인되지 않았습니다.</p><details class="highway-help" id="health-highway-help"><summary>연결 안내와 현재 범위${icon('chevron')}</summary><p>이 화면에는 건강정보 고속도로의 본인인증·동의·기록 연계 기능이 없습니다. 이 창을 여는 것만으로 인증이나 기록 조회를 요청하지 않습니다.</p><a href="https://www.myhealthway.go.kr/portal/index?page=Individual%2FPortal%2FMediMyData%2FMydataService" target="_blank" rel="noopener noreferrer">공식 서비스 소개${icon('external')}</a></details></section>
          <section class="records-section" aria-labelledby="record-documents-title"><h3 id="record-documents-title">현재 진료 자료</h3><p class="records-note">이 대화에 반영된 합성 자료의 상태·출처·내용입니다. 준비됨 표시는 실제 기관이 확인했다는 뜻이 아닙니다.</p><div class="record-documents" id="patient-record-documents">${DOCUMENT_DEFINITIONS.map(item=>`<details class="record-document" data-record-document-id="${item.id}"><summary><span data-record-label>${escape(item.label)}</span><span data-record-status></span>${icon('chevron')}</summary><dl><div><dt>출처</dt><dd data-record-source></dd></div><div><dt>내용</dt><dd data-record-content></dd></div></dl></details>`).join('')}</div></section>
          <p class="records-memory-note">${icon('lock')}환자 정보와 진료 자료는 현재 대화에서만 표시합니다. 이 창에서는 수정하거나 기기에 저장하지 않습니다.</p>
        </div>
      </dialog>
      <dialog class="patient-records-dialog contact-plan-dialog" id="contact-plan-dialog" aria-labelledby="contact-plan-title" aria-describedby="contact-plan-description">
        <header class="patient-records-header"><div><h2 id="contact-plan-title" tabindex="-1">전화·협진 준비</h2><p id="contact-plan-description">문의 계획·합성 결과 · 실제 전화 미연결</p></div><button type="button" id="close-contact-plan" class="close-records" aria-label="전화·협진 준비 닫기">${icon('close')}</button></header>
        <div class="patient-records-body" id="contact-plan-body">
          <section class="contact-overview" aria-labelledby="contact-overview-title"><h3 id="contact-overview-title">두 병원에 문의할 준비를 이어가요</h3><p>기존 도외 병원의 협진·회송 창구와 제주 병원의 현지 진찰·자료 전달 절차를 확인합니다. 실제 진찰 소견·의뢰서 작성과 진료 수락은 의료진과 기관이 담당합니다.</p><p>아래는 현재 가상 사례의 읽기 전용 계획입니다. 실환자 본인의 위임·본인인증·동의를 확인한 상태가 아니며, 전화 서비스 계정은 연결하지 않았습니다.</p></section>
          <div class="contact-plans" id="contact-plans"></div>
          <section class="call-handoffs" id="call-handoffs" aria-label="실패한 문의와 인계"></section>
          <details class="call-recovery-examples" id="call-recovery-examples"><summary><span>연결되지 않았을 때</span>${icon('chevron')}</summary><p class="journey-note">무응답·AI 응대 거절·본인 확인·서류/예약이 막힌 네 상황의 작성된 합성 예시입니다. 선택하면 현재 대화를 바꾸며 실제 모델·전화·동의 확인은 실행하지 않습니다.</p><div class="journey-scenarios" id="call-recovery-options"></div></details>
          <p class="records-memory-note">${icon('lock')}문의 계획은 현재 대화에서만 표시해요. 실제 환자 개인정보를 자동 전달하거나 이 기기에 저장하지 않습니다.</p>
        </div>
      </dialog>
      <dialog class="patient-records-dialog care-journey-dialog" id="care-journey-dialog" aria-labelledby="care-journey-title" aria-describedby="care-journey-description">
        <header class="patient-records-header"><div><h2 id="care-journey-title" tabindex="-1">진료 연결 여정</h2><p id="care-journey-description">자료·문의·이동을 잇는 합성 준비 흐름 · 의료진 판단 전 미확인</p></div><button type="button" id="close-care-journey" class="close-records" aria-label="진료 연결 여정 닫기">${icon('close')}</button></header>
        <div class="patient-records-body" id="care-journey-content"></div>
      </dialog>
    </div>`;
  welcomeMessage();renderSnapshot();updateCapabilities();
  const form=document.getElementById('conversation-form'),input=document.getElementById('request-input');
  form.addEventListener('submit',event=>{event.preventDefault();if(!composing)sendRequest();});
  input.addEventListener('input',resizeInput);
  input.addEventListener('compositionstart',()=>{composing=true;});input.addEventListener('compositionend',()=>{composing=false;resizeInput();});
  input.addEventListener('keydown',event=>{if(event.key==='Enter' && !event.shiftKey && !event.isComposing && !composing && event.keyCode!==229){event.preventDefault();if(!pending)sendRequest();}});
  document.getElementById('voice-request').addEventListener('click',startVoice);
  document.getElementById('cancel-request').addEventListener('click',cancelRequest);
  document.getElementById('new-conversation').addEventListener('click',()=>resetConversation());
  document.getElementById('preview-button').addEventListener('click',()=>showPreview());
  document.getElementById('save-report').addEventListener('click',saveReport);
  document.getElementById('nav-patient-records').addEventListener('click',event=>{event.preventDefault();openPatientRecords();});
  document.getElementById('nav-contact-plan').addEventListener('click',event=>{event.preventDefault();openContactPlan();});
  document.getElementById('nav-care-journey').addEventListener('click',event=>{event.preventDefault();openCareJourney();});
  document.getElementById('open-care-journey').addEventListener('click',openCareJourney);
  const recordsDialog=document.getElementById('patient-records-dialog');
  document.getElementById('close-patient-records').addEventListener('click',()=>recordsDialog.close());
  recordsDialog.addEventListener('close',()=>{document.body.classList.remove('records-dialog-open');const target=mobileRail.matches?document.getElementById('open-care-menu'):patientRecordsReturnFocus;if(target?.isConnected)target.focus({preventScroll:true});});
  const contactDialog=document.getElementById('contact-plan-dialog');
  document.getElementById('close-contact-plan').addEventListener('click',()=>contactDialog.close());
  contactDialog.addEventListener('close',()=>{
    if(contactDialog.open)return;
    document.body.classList.remove('records-dialog-open');
    const target=contactDialog.returnValue==='draft'?input:contactDialog.returnValue==='preview' && pending?document.getElementById('cancel-request'):mobileRail.matches?document.getElementById('open-care-menu'):contactPlanReturnFocus;
    if(target?.isConnected){target.focus({preventScroll:true});if(contactDialog.returnValue==='draft')target.scrollIntoView({block:'nearest',behavior:'instant'});}
  });
  contactDialog.addEventListener('keydown',event=>trapDialogFocus(event,contactDialog));
  document.getElementById('contact-plans').addEventListener('click',event=>{
    const button=event.target.closest('[data-contact-draft]');
    if(!button || !CALL_TARGETS.includes(button.dataset.contactDraft))return;
    const plan=buildCallPlan(caseState,button.dataset.contactDraft);
    if(fillRequestDraft(plan.requestDraft,{source:'문의 준비 문구',focus:false}))contactDialog.close('draft');
  });
  document.getElementById('contact-plan-body').addEventListener('click',event=>{
    const scenario=event.target.closest('[data-call-recovery-scenario]');
    if(scenario){showPreview(scenario.dataset.callRecoveryScenario);return;}
    const button=event.target.closest('[data-call-handoff-draft]');
    if(!button)return;
    const item=(getCareJourneySummary(caseState).handoffs || []).find(item=>item.id===button.dataset.callHandoffDraft);
    if(item && fillRequestDraft(item.requestDraft,{source:'사람 인계 초안',focus:false}))contactDialog.close('draft');
  });
  const journeyDialog=document.getElementById('care-journey-dialog');
  document.getElementById('close-care-journey').addEventListener('click',()=>journeyDialog.close());
  journeyDialog.addEventListener('close',()=>{
    if(journeyDialog.open)return;
    document.body.classList.remove('records-dialog-open');
    const target=journeyDialog.returnValue==='draft'?input:journeyDialog.returnValue==='preview' && pending?document.getElementById('cancel-request'):careJourneyReturnFocus;
    if(target?.isConnected){target.focus({preventScroll:true});if(journeyDialog.returnValue==='draft')target.scrollIntoView({block:'nearest',behavior:'instant'});}
  });
  journeyDialog.addEventListener('keydown',event=>trapDialogFocus(event,journeyDialog));
  document.getElementById('care-journey-content').addEventListener('click',event=>{
    const scenario=event.target.closest('[data-journey-scenario]');
    if(scenario){showPreview(scenario.dataset.journeyScenario);return;}
    const button=event.target.closest('[data-journey-draft]');
    if(!button)return;
    const journey=getCareJourneySummary(caseState);
    const item=[...journey.tasks,...journey.nextActions,...(journey.handoffs || [])].find(item=>item.id===button.dataset.journeyDraft);
    if(item && fillRequestDraft(item.requestDraft,{source:'다음 할 일 초안',focus:false}))journeyDialog.close('draft');
  });
  document.getElementById('preferences-form').addEventListener('submit',event=>event.preventDefault());
  document.getElementById('preferences-form').addEventListener('change',changePreferences);
  document.getElementById('open-care-menu').addEventListener('click',openCareMenu);
  document.getElementById('close-care-menu').addEventListener('click',()=>closeCareMenu());
  document.getElementById('drawer-backdrop').addEventListener('click',()=>closeCareMenu());
  document.getElementById('nav-preparation').addEventListener('click',event=>{event.preventDefault();closeCareMenu({restoreFocus:false});document.getElementById('nav-preparation').setAttribute('aria-current','location');document.getElementById('nav-preferences').removeAttribute('aria-current');input.focus({preventScroll:true});});
  document.getElementById('nav-preferences').addEventListener('click',event=>{event.preventDefault();document.getElementById('nav-preparation').removeAttribute('aria-current');document.getElementById('nav-preferences').setAttribute('aria-current','location');document.getElementById('pref-taxi').focus({preventScroll:true});document.getElementById('care-preferences').scrollIntoView({block:'nearest'});});
  document.addEventListener('keydown',event=>{
    if(!drawerOpen)return;
    if(event.key==='Escape'){event.preventDefault();closeCareMenu();return;}
    if(event.key==='Tab'){
      const items=[...document.getElementById('care-rail').querySelectorAll('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled)')].filter(node=>node.getBoundingClientRect().width>0);
      const first=items[0],last=items.at(-1);
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  mobileRail.addEventListener('change',()=>{const focusedRail=document.getElementById('care-rail').contains(document.activeElement);closeCareMenu({restoreFocus:false});if(mobileRail.matches && focusedRail)document.getElementById('open-care-menu').focus();});
  closeCareMenu({restoreFocus:false});
  window.addEventListener('beforeunload',event=>{if(hasConversationWork()){event.preventDefault();event.returnValue='';}});
  document.addEventListener('click',event=>{
    const example=event.target.closest('[data-example]');if(example && !pending)fillRequestDraft(example.dataset.example);
    const retry=event.target.closest('[data-retry]');if(retry && failedRequests.has(retry.dataset.retry))sendRequest(failedRequests.get(retry.dataset.retry).text,retry.dataset.retry);
  });
  const layoutObserver=new ResizeObserver(updateConversationLayout);
  for(const node of document.querySelectorAll('.chat-toolbar,.mode-notice,.starter-prompts,.conversation-form,.composer-notes,.pending-message'))layoutObserver.observe(node);
  window.addEventListener('resize',updateConversationLayout);
  window.visualViewport?.addEventListener('resize',updateConversationLayout);
  document.fonts.ready.then(updateConversationLayout);
  resizeInput();
  fetch(API+'/capabilities',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error('unavailable');return response.json();}).then(data=>updateCapabilities(data.capabilities || data)).catch(()=>updateCapabilities({llm:false}));
}

mount();

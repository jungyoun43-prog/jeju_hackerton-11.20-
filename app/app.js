import { createDemoCase, applyAction, getTasks, getProgress, getSummary, calculateBurden, buildReport, DOCUMENT_DEFINITIONS } from './domain.js';
import { icon } from './icons.js';
import { mountMap, destroyMap, refreshMap, googleMapUrl, hospitalMapUrl } from './map.js';
import { filterHospitals } from './hospitals.js';
import { getVisitSupportSummary, buildSupportInquiry } from './visit-support.js';
import { loadSupportRegistry, getSupportCandidates } from './support-data.js';

let state = createDemoCase();
let currentView = 'overview';
let assistantAnswer = '';
let toastTimer;
let dataTools;
let dataProfile;
let dataProfileError = '';
let hospitalRecords = [];
let publicHospitals = [];
let candidateSnapshot;
let candidateOrigin = 'public-preview';
let importProfile;
let hospitalFilters = { department: '', area: '' };
let supportRegistry;
let supportLoadError = '';
const supportNames = { taxi: '택시 이동', companion: '병원 동행' };
const busyTargets = new Set();
const views = { overview: ['진료 준비', 'home'], documents: ['진료 자료', 'folder'], calls: ['병원 문의', 'phone'], plan: ['일정·동행', 'calendar'], data: ['기관·데이터', 'database'] };
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => new Intl.NumberFormat('ko-KR').format(value || 0);
const documentLabels = { history: '치료 이력 요약', report: '최근 검사 판독문', exam: '제주 대면 진찰 소견', referral: '의료진 작성 의뢰서' };
const docStatus = { ready: ['준비 완료', 'green'], missing: ['자료 필요', 'orange'], not_performed: ['진찰 후 준비', 'neutral'] };
const inquiryStatus = { not_contacted: ['문의 전', 'neutral'], confirmed: ['절차 확인 · 시연', 'green'], unreachable: ['연결 안 됨 · 시연', 'orange'], not_participating: ['미참여 응답 · 시연', 'orange'] };
const outcomeOptions = '<option value="documents">최근 판독문·진찰 소견 요청</option><option value="referral">의사 명의 의뢰서도 요청</option><option value="unreachable">전화 연결 안 됨</option><option value="not_participating">협진 미참여 안내</option>';

function badge(label, tone = 'neutral', mark = '') { return `<span class="badge ${tone}">${mark ? icon(mark) : ''}${escape(label)}</span>`; }
function button(text, attributes = '', variant = 'primary', symbol = 'arrow') { return `<button class="button ${variant}" ${attributes}>${escape(text)}${symbol ? icon(symbol) : ''}</button>`; }
function pageTitle(title, description) {
  return `<div class="page-title-row"><div><h1>${escape(title)}</h1><p>${escape(description)}</p></div><div class="date-note">${icon('calendar')}2026년 10월 31일 · 시연 기준</div></div>`;
}
function patientStrip() {
  return `<section class="patient-strip" aria-label="진료 대상자"><div class="patient-avatar">${icon('user')}</div><div><div class="patient-name"><h2>${escape(state.patient.name)} 님</h2>${badge('가상 환자')}<small>${escape(state.patient.age)}세</small></div><p class="patient-details"><span>${escape(state.patient.area)}</span><span>${escape(state.patient.purpose)}</span></p></div><button class="text-button" data-nav="plan" data-focus="patient-settings">정보 보기${icon('chevron')}</button></section>`;
}
function progressPanel() {
  const progress = getProgress(state);
  return `<section class="progress-panel" aria-label="협진 준비 진행 단계"><div class="panel-top"><h2>진료 연결 현황</h2><span class="panel-meta">${escape(progress.label)}</span></div><ol class="steps">${progress.steps.map((step, i) => `<li class="step ${step.status}" ${step.status === 'current' ? 'aria-current="step"' : ''}><span class="step-dot">${step.status === 'done' ? icon('check') : i + 1}</span><span>${escape(step.label)}</span></li>`).join('')}</ol></section>`;
}
function actionButton(task, secondary = false) {
  const labels = { call: '병원 문의 시연', document: '필요 자료 준비', submit: '검토 접수 준비', wait: '의료진 회신 확인', plan: '가족 실행 계획' };
  return `<button class="${secondary ? 'text-button' : 'button primary'}" data-task="${escape(task.action)}" data-target="${escape(task.target || '')}">${escape(secondary ? '확인하기' : labels[task.action] || '다음 단계 보기')}${icon(secondary ? 'chevron' : 'arrow')}</button>`;
}
function tasksPanel() {
  const tasks = getTasks(state);
  const first = tasks[0];
  return `<section class="panel" aria-labelledby="task-title"><div class="panel-top"><h2 class="action-heading" id="task-title">${icon('spark')}지금 할 일</h2>${badge(`${tasks.length}개 확인`)}</div>${first ? `<div class="priority-task"><h3>${escape(first.title)}</h3><p>${escape(first.description)}</p></div><div class="task-footer"><span class="owner">${icon('user')}담당 · ${escape(first.owner)}</span>${actionButton(first)}</div><div class="secondary-tasks">${tasks.slice(1, 3).map(task => `<div class="secondary-task"><span>${icon('clock')}${escape(task.title)}</span>${actionButton(task, true)}</div>`).join('')}</div>` : '<p class="empty-note">현재 준비할 작업을 모두 확인했어요. 의료진이 안내한 일정에 맞춰 다음 진료를 준비해 주세요.</p>'}</section>`;
}
function documentRows() {
  return state.documents.filter(doc => doc.id !== 'referral' || isRequired('referral') || doc.status === 'ready').map(doc => {
    const [label, tone] = docStatus[doc.status] || docStatus.missing;
    return `<div class="doc-row ${doc.status}"><span class="doc-icon">${icon(doc.status === 'ready' ? 'check' : 'file')}</span><div class="doc-info"><span class="doc-title">${escape(doc.label || documentLabels[doc.id])}</span><span class="doc-source">${escape(doc.status === 'ready' ? doc.source : doc.id === 'exam' ? '제주 의료진 대면 진찰 후 작성' : '보호자와 병원에서 준비')}</span></div>${badge(label, tone)}</div>`;
  }).join('');
}
function documentsPanel() {
  const progress = getProgress(state);
  return `<section class="panel" aria-labelledby="documents-title"><div class="panel-top"><h2 id="documents-title">진료 자료 준비</h2><button class="text-button" data-nav="documents">${progress.prepared}/${progress.total} 준비${icon('chevron')}</button></div><div class="doc-list">${documentRows()}</div><p class="doc-note">${icon('lock')}자료는 이 화면의 메모리에서만 다뤄요. 새로고침하면 시연이 처음부터 시작됩니다.</p></section>`;
}
function assistantPanel() {
  return `<section class="panel assistant-panel" aria-labelledby="assistant-title"><div class="assistant-title">${icon('compass')}<h2 id="assistant-title">나침반 도우미</h2></div><p class="assistant-message" id="assistant-response" aria-live="polite">${escape(assistantAnswer || `${getProgress(state).label} 단계예요. ${getTasks(state)[0]?.title || '준비한 실행 계획을 확인해 주세요.'}`)}</p><p class="assistant-attribution">현재 진행 상태를 정리하는 규칙 기반 시연</p><div class="assistant-quick"><button class="quick-chip" data-question="자료">어떤 자료가 필요해?</button><button class="quick-chip" data-question="다음">다음엔 뭘 할까?</button><button class="quick-chip" data-question="비용">동행 부담은?</button></div><form class="assistant-form" id="assistant-form"><label class="visually-hidden" for="assistant-input">진행 상황에 관해 물어보기</label><input id="assistant-input" name="question" placeholder="진료 준비에 대해 물어보세요" maxlength="300" autocomplete="off" required/><button type="submit" aria-label="도우미에게 질문 보내기">${icon('send')}</button></form></section>`;
}
function mapPanel() {
  return `<section class="panel map-panel" aria-labelledby="map-title"><div class="panel-top"><h2 id="map-title">제주에서 이어지는 진료</h2>${icon('pin')}</div><div class="map-legend"><span><i></i>부모님 댁</span><span><i></i>시연 병원 위치</span></div><div id="care-map" class="map-canvas" role="region" aria-label="애월과 제주 시내의 가상 진료 지점 지도"></div><div class="map-foot"><p>지도는 실제 지형, 두 지점은 가상 위치예요. 선택한 기관의 주소를 표시한 것이 아닙니다.</p><p class="map-load-state">외부 지도 배경을 불러오고 있어요.</p><a href="${googleMapUrl()}" target="_blank" rel="noopener noreferrer">Google 지도에서 위치 보기${icon('external')}</a></div></section>`;
}
function activitiesPanel() {
  const events = state.events.slice(-5).reverse();
  return `<section class="panel activity-panel" aria-labelledby="activity-title"><div class="panel-top"><h2 id="activity-title">최근 진행 기록</h2><span class="panel-meta">작업과 출처를 함께 남겨요</span></div>${events.length ? events.map(event => `<div class="activity-row"><span class="activity-dot"></span><div class="activity-text"><strong>${escape(event.title)}</strong><p>${escape(event.detail)}${event.source ? ` · ${escape(event.source)}` : ''}</p></div><time class="activity-time">${formatTime(event.at)}</time></div>`).join('') : '<p class="empty-note">첫 병원 문의를 시연하면 응답과 다음 작업이 여기에 기록됩니다.</p>'}</section>`;
}
function formatTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '시연 기록' : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function isRequired(id) { return id !== 'referral' || Object.values(state.inquiries).some(inquiry => inquiry.requestedDocuments?.includes(id)); }

function sourceSummary() {
  const detail = dataProfile?.scope === 'public-preview-aggregates'
    ? `공개 미리보기 ${dataProfile.totalRows}행 분석 · 기관 등록 정보`
    : '공개 기관 등록 정보의 출처와 시점 확인';
  return `<div class="source-summary"><span>${icon('database')}기관 정보의 근거</span><strong>제주데이터허브 · 병·의원 정보</strong><small>${escape(detail)}</small><button class="text-button" data-nav="data">출처와 자료 확인${icon('chevron')}</button></div>`;
}
function missionPanel() {
  const first = getTasks(state)[0], progress = getProgress(state);
  const title = first?.action === 'call' ? first.target === 'mainland' ? '기존 병원의 접수 절차 확인' : '제주 기관의 진찰·자료 전달 절차 확인' : first?.title || '진료 준비 기록 확인';
  const details = first?.action === 'call' ? '어느 창구로 연락할지, 어떤 자료를 준비할지 확인합니다.' : first?.description || '의료진이 안내한 계획에 맞춰 다음 일정을 준비합니다.';
  const result = first?.action === 'call' ? ['접수 창구', '필요 서류', '의뢰·회신 경로'] : first?.action === 'document' ? ['자료 출처', '누락 항목', '준비 담당자'] : first?.action === 'plan' ? ['후속 일정', '가족 동행', '미확인 비용'] : ['요청 자료', '회신', '다음 준비'];
  return `<section class="mission-card" aria-labelledby="task-title"><div class="mission-meta"><h2 id="task-title">지금 할 일</h2><span class="mission-step">${escape(progress.label)}</span></div><h3>${escape(title)}</h3><p class="mission-description">${escape(details)}</p><div class="mission-outputs">${result.map(label=>`<span>${icon('check')}${escape(label)}</span>`).join('')}</div><div class="mission-action">${first ? `<button id="mission-primary" class="button mission-button" data-task="${escape(first.action)}" data-target="${escape(first.target || '')}">${escape({call:'병원 문의 시연',document:'필요 자료 준비',submit:'검토 접수 준비',wait:'의료진 회신 확인',plan:'가족 실행 계획'}[first.action] || '다음 단계 보기')}${icon('arrow')}</button>` : '<button id="mission-primary" class="button mission-button" data-nav="plan">실행 계획 보기</button>'}<span>전화·자료 전달은 시연입니다.</span></div></section>`;
}
function familyTasks() {
  const tasks=getTasks(state).filter(task=>task.action !== 'call').slice(0,2);
  return `<section class="family-tasks"><div class="panel-top"><h2>가족과 의료진의 준비</h2></div>${tasks.length ? tasks.map(task=>`<div class="family-task"><div><small>${escape(task.owner)}</small><strong>${escape(task.title.replace(/(?:을|를) 준비해 주세요[.]?$/, ' 준비').replace(/해 주세요[.]?$/, ''))}</strong>${actionButton(task,true)}</div></div>`).join('') : `<p class="help-text">접수와 회신 상태를 확인하세요.</p>`}<p class="family-boundary">진찰과 진료 계획은 의료진이 결정합니다.</p></section>`;
}
function connectionPanel() {
  const progress=getProgress(state), answered=Object.values(state.inquiries).filter(item=>item.status==='confirmed').length;
  return `<section class="connection-panel" aria-labelledby="connection-title"><div class="panel-top"><h2 id="connection-title">두 병원 사이, 준비 기록</h2><span class="panel-meta">절차 ${answered}/2곳 확인</span></div><div class="care-connection"><article class="care-place"><div class="place-route"><span>제주</span><i></i></div><div class="place-record"><div class="place-title"><h3>현지 대면 진찰</h3>${badge(inquiryStatus[state.inquiries.jeju.status][0],state.inquiries.jeju.status==='confirmed'?'green':'neutral')}</div><p>${escape(state.patient.localHospital)}</p><span class="place-purpose">진찰 소견 · 검사 자료 · 의뢰서</span><div class="place-actions"><button class="text-button" data-nav="calls" data-focus="inquiry-jeju">문의 기록${icon('chevron')}</button><button class="text-button" data-nav="data">기관 찾기${icon('chevron')}</button></div></div></article><div class="connection-bridge">${icon('folder')}<strong>검토할 자료</strong><span>${progress.prepared}/${progress.total} 준비</span><button class="text-button" data-nav="documents">자료 보기${icon('chevron')}</button></div><article class="care-place"><div class="place-route"><span>도외</span></div><div class="place-record"><div class="place-title"><h3>기존 주치의·전문의 검토</h3>${badge(state.review.status==='completed'?'합성 회신 확인':state.review.status==='pending'?'회신 대기':inquiryStatus[state.inquiries.mainland.status][0],state.review.status==='completed'?'green':'neutral')}</div><p>${escape(state.patient.existingHospital)}</p><span class="place-purpose">기록 검토 · 추가 요청 · 후속 계획</span><button class="text-button" data-nav="calls" data-focus="inquiry-mainland">문의 기록${icon('chevron')}</button></div></article></div></section>`;
}
function visitDateLabel() {
  const value = state.patient.nextVisit;
  const date = new Date(`${value}T12:00:00Z`);
  return !value || Number.isNaN(date.valueOf()) ? '방문일 미정' : new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'UTC' }).format(date);
}
function supportTone(status) {
  return status === 'available_demo' ? 'green' : ['needs_recheck', 'unavailable_demo', 'unreachable_demo'].includes(status) ? 'orange' : 'neutral';
}
function supportCandidates(kind) {
  return supportRegistry ? getSupportCandidates(supportRegistry, { kind, area: state.patient.area, wheelchair: state.visitSupport.requirements.wheelchair }) : [];
}
function readinessStrip() {
  const progress = getProgress(state), support = getVisitSupportSummary(state);
  const confirmed = Object.values(state.inquiries).filter(item => item.status === 'confirmed').length;
  const items = [
    { label: '병원 연결', value: `${confirmed}/2곳 절차 확인`, detail: confirmed === 2 ? '자료 검토 준비' : '접수 창구 확인 필요', nav: 'calls', tone: confirmed === 2 ? 'ready' : '' },
    { label: '진료 자료', value: `${progress.prepared}/${progress.total}개 준비`, detail: progress.prepared === progress.total ? '필요 자료 준비됨' : '빠진 자료 확인', nav: 'documents', tone: progress.prepared === progress.total ? 'ready' : '' },
    { label: '택시 이동', value: support.taxi.label, detail: state.visitSupport.requirements.transportNeeded ? support.taxi.providerName || '지역 문의처 찾기' : '별도 지원 없음', nav: 'plan', focus: 'visit-support-taxi', tone: support.taxi.ready ? 'ready' : '' },
    { label: '병원 동행', value: support.companion.label, detail: state.visitSupport.requirements.companionNeeded ? support.companion.providerName || '보호자 대신 함께 갈 사람' : '별도 지원 없음', nav: 'plan', focus: 'visit-support-companion', tone: support.companion.ready ? 'ready' : '' },
  ];
  return `<section class="readiness-strip" aria-label="이번 방문의 준비 상태">${items.map(item => `<button class="readiness-item ${item.tone}" data-nav="${item.nav}" ${item.focus ? `data-focus="${item.focus}"` : ''}><span>${escape(item.label)}${icon('chevron')}</span><strong>${escape(item.value)}</strong><small>${escape(item.detail)}</small></button>`).join('')}</section>`;
}
function visitRoutePanel() {
  const progress = getProgress(state), support = getVisitSupportSummary(state);
  const localName = state.selectedHospital?.companyName || '제주 기관을 선택해 주세요';
  return `<section class="visit-route-panel" aria-labelledby="visit-route-title"><div class="panel-top"><h2 id="visit-route-title">이번 진료가 이어지는 길</h2><span class="panel-meta">방문 1건의 준비</span></div><div class="physical-route"><div class="route-home">${icon('home')}<div><small>출발</small><strong>${escape(state.patient.area)}</strong></div></div><div class="route-transport">${icon('car')}<span>${escape(state.visitSupport.requirements.transportNeeded ? support.taxi.providerName || '이동 수단 준비' : '추가 이동지원 없음')}</span><small>이동시간 미확인</small></div><div class="route-clinic">${icon('hospital')}<div><small>제주 대면 진찰</small><strong>${escape(localName)}</strong><button class="text-button" data-nav="data">${state.selectedHospital ? '선택 기관 확인' : '기관 찾기'}${icon('chevron')}</button></div></div></div><div class="records-route"><div>${icon('folder')}<span>진찰·검사 자료 <strong>${progress.prepared}/${progress.total} 준비</strong></span></div>${icon('arrow')}<div>${icon('hospital')}<span>기존 주치의 검토<small>${escape(state.patient.existingHospital)}</small></span></div></div><p class="route-note">이동은 제주 방문 준비입니다. 도외 병원과는 자료 검토 절차를 확인합니다.</p></section>`;
}
function supportOverviewPanel() {
  const support = getVisitSupportSummary(state);
  return `<section class="support-overview" aria-labelledby="support-overview-title"><div class="panel-top"><h2 id="support-overview-title">이동과 동행도 함께</h2><button class="text-button" data-nav="plan" data-focus="visit-support">준비하기${icon('chevron')}</button></div>${['taxi','companion'].map(kind => {
    const item = support[kind], candidate = supportCandidates(kind)[0];
    const required = state.visitSupport.requirements[kind === 'taxi' ? 'transportNeeded' : 'companionNeeded'];
    return `<div class="support-overview-row">${icon(kind === 'taxi' ? 'car' : 'users')}<div><span>${escape(supportNames[kind])}</span><strong>${escape(required ? item.providerName || candidate?.name || '문의처 확인 중' : '별도 지원 없음')}</strong><small>${escape(required && item.providerName ? item.label : required ? candidate ? `${candidate.matchLabel} · 이용 가능 여부 문의` : supportLoadError || '지역에 맞는 문의처를 불러옵니다.' : '추가 지원이 필요하지 않은 설정')}</small></div><button class="text-button" data-nav="plan" data-focus="visit-support-${kind}">${item.providerName ? '상태 보기' : '문의 준비'}${icon('chevron')}</button></div>`;
  }).join('')}<p class="support-boundary">현재 차량·동행인이 배정된 상태는 아닙니다.</p></section>`;
}
function nextTasksPanel() {
  const support = getVisitSupportSummary(state), tasks = getTasks(state).slice(1,3);
  return `<section class="next-tasks"><div class="panel-top"><h2>이어서 준비할 일</h2><span class="panel-meta">담당자와 다음 행동</span></div>${tasks.map(task => `<div class="next-task-row"><span class="task-check">${icon(task.owner.includes('의료진') ? 'hospital' : 'file')}</span><div><strong>${escape(task.title.replace(/(?:을|를) 준비해 주세요[.]?$/, ' 준비').replace(/해 주세요[.]?$/, ''))}</strong><small>${escape(task.owner)}</small></div>${actionButton(task,true)}</div>`).join('')}${support.nextActions.slice(0,1).map(task => `<div class="next-task-row"><span class="task-check">${icon(task.kind === 'taxi' ? 'car' : 'users')}</span><div><strong>${escape(task.title)}</strong><small>${escape(task.reason)}</small></div><button class="text-button" data-nav="plan" data-focus="visit-support-${escape(task.kind)}">준비하기${icon('chevron')}</button></div>`).join('')}</section>`;
}
function overview() {
  const time = state.visitSupport.requirements.appointmentTime;
  return `<header class="visit-heading"><div><h1 id="service-role">${escape(state.patient.name)} 님의 진료 준비</h1><p><span>${escape(state.patient.area)} · ${escape(state.patient.age)}세</span><span>보호자 ${escape(state.patient.caregiver)}</span><span class="synthetic-label">합성 사례</span></p></div><button class="visit-date" data-nav="plan" data-focus="patient-settings">${icon('calendar')}<span><small>다음 방문 · 시연 일정</small><strong>${escape(visitDateLabel())}</strong><small>${time ? `${escape(time)} 진료 시각 가정` : '진료 시각 미정'} · 일정 수정</small></span>${icon('chevron')}</button></header>${readinessStrip()}<div class="visit-workboard"><div class="visit-main">${missionPanel()}${visitRoutePanel()}${nextTasksPanel()}</div><aside class="visit-sidebar" aria-label="이동·동행과 자료 준비">${supportOverviewPanel()}${documentsPanel()}</aside></div><div class="visit-followups">${activitiesPanel()}${assistantPanel()}</div><div class="visit-bottom">${mapPanel()}${sourceSummary()}</div>`;
}
function profilePanel(profile=dataProfile) {
  if(!profile) return `<section class="panel data-profile"><h2>자료의 범위를 먼저 확인해요</h2><p class="help-text">${escape(dataProfileError || '공개 자료의 출처 정보를 불러오고 있어요.')}</p><a class="text-button" href="https://jejudatahub.net/data/view/data/859" target="_blank" rel="noopener noreferrer">허브 원문 확인${icon('external')}</a></section>`;
  const imported = profile.scope === 'user-import';
  const metadataOnly = profile.scope === 'metadata-only' || !Number.isFinite(profile.totalRows);
  const label = imported ? '사용자 제공 · 원출처 미검증' : metadataOnly ? '공개 항목 정의' : '공개 미리보기 20행 분석';
  const rows=[['분석한 등록 정보',`${profile.totalRows}행`],['자료상 행정 정상',`${profile.activeRegistrationRows}행`],['폐업 기록',`${profile.closedRows}행`],['진료과 정보',`${profile.completeness?.departmentRows ?? '미확인'}/${profile.totalRows}행`]];
  const description = imported ? '가져온 파일의 등록 정보와 결측 항목을 분석합니다. 원출처와 현재 운영·협진 참여 여부는 별도 확인이 필요해요.' : metadataOnly ? '공개 데이터명과 항목 정의를 안내합니다. 사용 가능한 등록 정보를 가져와 문의할 기관을 조회할 수 있어요.' : '공개 미리보기 20행의 등록 정보와 결측 항목을 분석했습니다. 전체 기관 목록이나 현재 진료·협진 가능 여부를 뜻하지 않습니다.';
  return `<section class="panel data-profile"><div class="panel-top"><h2>${escape(profile.dataset?.name || '병·의원 정보 · 859')}</h2></div>${badge(label,'orange')}<p class="help-text profile-description">${escape(description)}</p>${metadataOnly ? `<div class="import-empty"><h3>권한 있는 파일을 가져와 시작해요</h3><p>기관명·주소·등록 진료과·행정 상태·갱신일을 확인하고, 문의할 기관을 직접 선택할 수 있어요.</p></div>` : `<dl class="data-facts">${rows.map(([title,value])=>`<div><dt>${title}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl><div class="data-dates"><p>원자료 수집 시점 <strong>${escape(profile.time?.collectedAt?.join(', ') || '미확인')}</strong></p><p>행별 갱신 범위 <strong>${escape(profile.time?.earliestRowUpdate || '미확인')} ~ ${escape(profile.time?.latestRowUpdate || '미확인')}</strong></p></div>`}<h3>자료에 없어 별도로 확인할 항목</h3><div class="capability-tags">${(profile.missingCapabilities || []).map(value=>`<span>${icon('phone')}${escape(value)}</span>`).join('')}</div><details class="source-detail"><summary>이용조건 기록</summary><p class="data-rights">${escape(profile.rights?.basis || '개별 이용·재배포 조건은 추가 확인이 필요합니다.')}</p></details><a class="text-button" href="https://jejudatahub.net/data/view/data/859" target="_blank" rel="noopener noreferrer">${imported ? '참고 항목 정의 · 허브 859' : '출처 · 제주데이터허브 / LOCALDATA'}${icon('external')}</a></section>`;
}
function hospitalCandidates() {
  const records=filterHospitals(hospitalRecords,hospitalFilters);
  const departments=[...new Set(hospitalRecords.flatMap(record=>record.departments))].sort((a,b)=>a.localeCompare(b,'ko'));
  const imported=candidateOrigin==='user-import';
  const sourceLabel=imported ? '사용자 제공 · 원출처 미검증' : '제주데이터허브 공개 미리보기';
  const sourceDescription=imported ? '가져온 파일의 행정 등록 정보를 조회합니다. 원본은 브라우저 메모리에서만 다루며, 허브 운영 API 인증 결과가 아닙니다.' : '공개 미리보기 20행 중 폐업 기록 7행을 제외한 13개 등록 후보입니다. 수집 시점은 2024년 10월이며, 현재 운영·진료·협진 참여는 문의가 필요해요.';
  return `<section class="panel hospital-import"><div class="panel-top"><h2>문의할 제주 기관 찾기</h2>${badge(imported?'내 자료':'공개 데이터')}</div><p class="help-text">${escape(sourceDescription)}</p>${hospitalRecords.length ? `<form id="hospital-filter" class="hospital-filter"><div class="field"><label for="hospital-department">등록 진료과</label><select id="hospital-department" name="department"><option value="">전체 진료과</option>${departments.map(value=>`<option ${value===hospitalFilters.department?'selected':''}>${escape(value)}</option>`).join('')}</select></div><div class="field"><label for="hospital-area">주소에서 지역 찾기</label><input id="hospital-area" name="area" value="${escape(hospitalFilters.area)}" placeholder="예: 애월, 제주시" maxlength="100"/></div><button class="button secondary" type="submit">후보 조회${icon('search')}</button></form><p class="candidate-count">등록 조건에 맞는 ${records.length}곳 · 임상 적합성 순위가 아닙니다.</p><div class="candidate-list">${records.map(record=>`<article class="hospital-candidate"><div><h3>${escape(record.companyName)}</h3>${badge('현재 진료·협진 미확인','orange')}</div><p>${escape(record.address || '주소 미확인')}</p><span>${escape(record.departments.join(' · ') || '등록 진료과 미확인')}</span><small>자료상 ${escape(record.openStatus)} · 갱신 ${escape(record.updatedAt || '미확인')}<br>출처: ${escape(sourceLabel)}</small><div class="candidate-actions"><button class="button outline small" data-select-hospital="${escape(record.id)}" ${!/^(영업\s*\/\s*정상|정상|영업중)$/.test(record.openStatus)?'disabled':''}>문의할 기관으로 선택${icon('arrow')}</button><a class="text-button hospital-map-link" href="${escape(hospitalMapUrl(record))}" target="_blank" rel="noopener noreferrer">지도에서 주소 보기${icon('external')}</a></div></article>`).join('') || '<p class="empty-note">조건에 맞는 등록 행이 없어요. 지역이나 진료과를 바꿔보세요.</p>'}</div>` : `<div class="import-empty"><h3>기관 등록 정보를 불러오고 있어요</h3><p>${escape(dataProfileError || '공개 미리보기의 출처와 등록 정보를 확인하고 있습니다.')}</p></div>`}<details class="hospital-import-more"><summary>보유한 기관 자료로 조회하기</summary><p class="help-text">이용 가능한 병·의원 JSON/CSV를 가져오면 현재 후보 목록을 바꿉니다. 원본은 서버에 보내지 않아요.</p><label class="file-drop" for="hospital-file">${icon('folder')}<strong>병·의원 자료 가져오기</strong><span>JSON 또는 CSV · 2MB 이하</span><input type="file" id="hospital-file" accept=".json,.csv,application/json,text/csv" ${!dataTools?'disabled':''}/></label></details></section>`;
}
function data() {
  return `${pageTitle('제주 기관·데이터', '출처와 시점을 확인하고, 기관 등록 정보를 문의 준비에 연결해요.')}<div class="data-banner">${icon('info')}등록된 진료과·행정 상태는 현재 진료 가능 여부나 협진 수락을 뜻하지 않습니다.</div><div class="subpage-grid data-grid"><div class="column">${hospitalCandidates()}</div><div class="column">${profilePanel(importProfile || dataProfile)}${supportSourcesPanel()}</div></div>`;
}

function fullDocuments() {
  return `<section class="panel" aria-labelledby="record-title"><div class="panel-top"><h2 id="record-title">의료진에게 전할 자료</h2>${badge('합성 사례')}</div>${state.documents.map(doc => {
    const definition = DOCUMENT_DEFINITIONS.find(item => item.id === doc.id);
    const [label, tone] = docStatus[doc.status] || docStatus.missing;
    return `<article class="full-doc" id="document-${escape(doc.id)}"><div class="full-doc-heading"><span class="doc-icon">${icon(doc.status === 'ready' ? 'check' : 'file')}</span><h3>${escape(doc.label || documentLabels[doc.id])}</h3>${badge(isRequired(doc.id) ? label : '요청 시 준비', isRequired(doc.id) ? tone : 'neutral')}</div><p>${escape(definition?.description || '실제 기록을 작성·확인하는 담당자가 준비하는 자료입니다.')}</p>${doc.status === 'ready' ? `<p><strong>출처</strong> · ${escape(doc.source)}</p><p>${escape(doc.content)}</p><button class="text-button" data-remove-document="${escape(doc.id)}">자료 제거</button>` : `<p>${doc.id === 'exam' ? '대면 진찰을 수행한 제주 의료진의 기록이 필요해요.' : doc.id === 'referral' ? '의뢰서는 의료진이 작성합니다. 시연에서는 합성 기록으로 절차만 확인해요.' : '보유 자료의 내용과 출처를 확인해 준비해 주세요.'}</p><details><summary>자료 내용과 출처 입력</summary><form data-document-form="${escape(doc.id)}"><div class="field"><label for="source-${escape(doc.id)}">자료 출처</label><input id="source-${escape(doc.id)}" name="source" placeholder="예: 시연용 합성 기록" maxlength="200" required/></div><div class="field"><label for="content-${escape(doc.id)}">자료 내용 · 시연용 텍스트</label><textarea id="content-${escape(doc.id)}" name="content" placeholder="출처가 있는 자료 내용을 입력하세요" maxlength="10000" required></textarea></div><button class="button primary small" type="submit">자료 준비에 반영${icon('plus')}</button></form></details><button class="button secondary small" data-example-document="${escape(doc.id)}">합성 예시 자료 추가${icon('plus')}</button>`}</article>`;
  }).join('')}<p class="doc-note">${icon('info')}이 시연은 문서 내용을 해석해 환자의 상태나 진료 적합성을 평가하지 않습니다.</p></section>`;
}
function packetPanel() {
  const progress = getProgress(state);
  const canSubmit = state.inquiries.mainland.status === 'confirmed' && state.inquiries.jeju.status === 'confirmed' && progress.prepared === progress.total && state.permissions.share;
  return `<section class="panel"><div class="panel-top"><h2>협진 자료 묶음</h2>${badge(state.packet.status === 'submitted' ? '검토 접수 재현' : `${progress.prepared}/${progress.total} 준비`, state.packet.status === 'submitted' ? 'green' : 'neutral')}</div><p class="help-text">양쪽 기관의 절차와 필요한 자료를 확인한 뒤 검토 접수를 재현합니다.</p><label class="checkbox"><input type="checkbox" data-permission="share" ${state.permissions.share ? 'checked' : ''}/><span><strong>시연 자료 공유 허용</strong>가상 기관에 자료를 전달하는 단계를 재현합니다. 실제 외부 전송은 하지 않아요.</span></label>${button(state.packet.status === 'submitted' ? '검토 접수 재현 완료' : '협진 검토 접수 시연', `data-submit-packet ${!canSubmit || state.packet.status === 'submitted' ? 'disabled' : ''}`, 'primary', 'send')}${!canSubmit && state.packet.status !== 'submitted' ? '<p class="help-text" style="margin-top:12px">병원 두 곳 문의, 필수 자료 준비, 공유 허용이 필요해요.</p>' : ''}</section>`;
}
function reviewPanel() {
  const pending = state.packet.status === 'submitted' && state.review.status === 'pending';
  return `<section class="panel review-controls"><div class="panel-top"><h2>의료진 회신</h2>${badge(state.review.status === 'completed' ? '합성 회신 확인' : state.review.status === 'needs_information' ? '자료 보완 요청' : pending ? '회신 대기 · 시연' : '접수 전', state.review.status === 'completed' ? 'green' : 'neutral')}</div><p class="help-text">의료진 역할의 합성 응답으로 다음 작업이 바뀌는 과정을 확인해요. 실제 환자에 대한 판단이 아닙니다.</p>${state.review.note ? `<p class="review-note">${escape(state.review.note)}</p><p class="help-text">출처 · ${escape(state.review.source)}</p>` : ''}<form id="review-form"><div class="field"><label for="review-outcome">합성 의료진 응답</label><select id="review-outcome" name="outcome" ${!pending ? 'disabled' : ''}><option value="local_followup">제주 진찰 + 기존 주치의 검토 계획</option><option value="needs_information">추가 판독문 요청 · 보완 필요</option><option value="mainland_visit">도외 대면 방문 계획</option></select></div><button class="button secondary" type="submit" ${!pending ? 'disabled' : ''}>의료진 회신 재현${icon('arrow')}</button></form></section>`;
}
function documents() {
  return `${pageTitle('진료 자료', '기록의 출처를 확인하고, 빠진 자료를 함께 준비해요.')}<p class="page-description">병원에서 요구한 서류와 실제 의료진이 작성한 기록을 한곳에서 관리합니다. 시연용 예시 자료로 보완 과정을 먼저 확인할 수 있어요.</p>${progressPanel()}<div class="subpage-grid"><div class="column">${fullDocuments()}</div><div class="column">${packetPanel()}${reviewPanel()}</div></div>`;
}

function inquiryPanel(target) {
  const inquiry = state.inquiries[target];
  const [label, tone] = inquiryStatus[inquiry.status] || inquiryStatus.not_contacted;
  const mainland = target === 'mainland';
  return `<article class="inquiry" id="inquiry-${target}"><div class="inquiry-heading">${icon('hospital')}<div><h3>${escape(mainland ? state.patient.existingHospital : state.patient.localHospital)}</h3><p>${mainland ? '기존 주치의 측 · 협진 접수 절차' : '제주 측 · 진찰·자료 전달 절차'}</p></div>${badge(label, tone)}</div><p class="help-text">${mainland ? '접수 창구, 의사 명의 의뢰 필요 여부, 준비 자료와 회신 방법을 확인합니다.' : '협진 참여 여부, 대면 진찰과 기록 준비, 접수 방법을 확인합니다.'}</p><form data-call-form="${target}" style="margin-top:15px"><div class="field"><label for="outcome-${target}">이번에 재현할 병원 응답</label><select id="outcome-${target}" name="outcome" ${busyTargets.has(target) ? 'disabled' : ''}>${outcomeOptions}</select></div><button class="button primary" type="submit" ${busyTargets.has(target) || !state.permissions.inquiry ? 'disabled' : ''}>${busyTargets.has(target) ? '합성 응답을 확인하고 있어요' : '문의 응답 재현'}${icon(busyTargets.has(target) ? 'clock' : 'phone')}</button></form>${inquiry.response ? `<p class="inquiry-response">${escape(inquiry.response)}</p>` : ''}${inquiry.transcript?.length ? `<details style="margin-top:12px"><summary>합성 통화 내용과 출처 보기</summary><div class="transcript">${inquiry.transcript.map(item => `<div class="transcript-item"><strong>${escape(item.speaker)}</strong><p>${escape(item.text)}</p></div>`).join('')}</div><p class="help-text">출처 · 미리 정의한 시연 응답. 실제 전화망 발신·녹음 없음.</p></details>` : ''}</article>`;
}
function calls() {
  return `${pageTitle('병원 문의', '한 번의 문의를, 다음 준비로 이어가요.')}<p class="page-description">병원에서 무엇을 요구했는지에 따라 할 일과 자료 목록이 바뀝니다. 아래 문의는 사전에 정한 응답으로 진행하는 시연입니다. 선택한 기관의 실제 응답이 아니며, 실제 발신은 하지 않아요.</p><div class="subpage-grid"><section class="panel"><div class="panel-top"><h2>제주와 기존 병원 연결</h2>${badge('통화 시뮬레이션', 'orange')}</div>${inquiryPanel('mainland')}${inquiryPanel('jeju')}</section><div class="column"><section class="panel permission-panel"><h2>문의 범위</h2><p class="help-text">보호자가 허용한 범위에서 절차를 확인해요.</p><label class="checkbox"><input type="checkbox" data-permission="inquiry" ${state.permissions.inquiry ? 'checked' : ''}/><span><strong>접수 절차 문의 허용</strong>창구·서류·협진 참여 절차를 묻는 단계를 재현합니다. 선택 기관의 실제 참여 여부는 확인하지 않아요.</span></label><p class="help-text">임상 판단과 예약 확정은 문의 응답과 별도로 확인합니다.</p></section>${assistantPanel()}<section class="panel"><div class="panel-top"><h2>후보 정보의 출처</h2>${icon('info')}</div><p class="help-text">${state.selectedHospital ? `제주 기관은 ${state.selectedHospital.source?.kind==='user-import'?'사용자가 가져온 자료':'허브 공개 미리보기'}에서 선택했습니다. 등록 당시 정보이며 실제 전화번호·협진 참여·현재 운영 여부는 확인되지 않았어요. 지도는 가상 위치입니다.` : '초기 기관과 지도 지점은 가상입니다. 기관·데이터에서 허브 공개 미리보기의 등록 기관을 골라 문의 시연을 이어갈 수 있어요.'}</p><button class="text-button" data-nav="data">기관 자료 확인${icon('chevron')}</button><a class="text-button" href="https://jejudatahub.net/data/view/data/859" target="_blank" rel="noopener noreferrer">공공데이터 출처 보기${icon('external')}</a></section></div></div>`;
}

function planPanel() {
  const complete = state.review.status === 'completed';
  const outcome = state.review.outcome;
  const stops = complete
    ? outcome === 'mainland_visit'
      ? [['hospital', '기존 도외 병원 대면 방문 준비', '합성 의료진 회신을 기준으로 자료·교통·가족 동행을 확인해요.'], ['folder', '진찰 기록과 판독문 챙기기', '제주에서 준비한 기록을 기관이 허용한 경로로 전달할 준비를 해요.'], ['calendar', '예약과 동행 일정 확인', '현재 화면은 예약을 확정하지 않습니다. 실제 창구의 확인이 필요해요.']]
      : [['hospital', '제주 의료진의 대면 진찰 준비', '합성 회신에서 제시한 계획입니다. 실제 진찰·검사 범위는 의료진이 정해요.'], ['folder', '기존 주치의에게 기록 전달 준비', '승인된 경로와 검토 일정을 기관에 확인해요.'], ['calendar', '후속 일정·가족 동행 챙기기', '회신에 따른 다음 일정과 보호자 참여 가능 여부를 확인해요.']]
    : [['phone', '양쪽 병원의 협진 절차 확인', '문의 응답에 따라 서류와 다음 담당자를 정리해요.'], ['folder', '의료진이 검토할 자료 준비', '실제 진찰 기록과 출처가 확인된 자료를 준비해요.'], ['calendar', '의료진 회신 후 실행 계획 확인', '진료 장소·검사·방문 일정은 의료진 확인이 필요해요.']];
  return `<section class="panel"><div class="panel-top"><h2>가족 실행 계획</h2>${badge(complete ? '합성 회신 기반' : '의료진 검토 전', complete ? 'green' : 'neutral')}</div><div class="plan-route">${stops.map(([symbol, title, description]) => `<div class="plan-stop">${icon(symbol)}<div><h3>${title}</h3><p>${description}</p></div></div>`).join('')}</div>${state.review.note ? `<p class="inline-message">${escape(state.review.note)}<br>출처 · ${escape(state.review.source)}</p>` : ''}</section>`;
}
const costFields = [ ['visits', '가정한 방문 횟수', '회'], ['caregiverAvailable', '보호자 동행 가능 횟수', '회'], ['localTransport', '방문당 도내 왕복 교통비', '원'], ['offIslandTransport', '방문당 도외 왕복 교통비', '원'], ['lodging', '방문당 숙박비', '원'], ['medical', '방문당 의료비 본인부담', '원'], ['caregiverTransport', '동행 1회당 보호자 이동비', '원'] ];
function costsPanel() {
  const burden = calculateBurden(state.plan);
  return `<section class="panel"><div class="panel-top"><h2>일정이 바뀌면 부담은?</h2>${badge('사용자 입력 가정', 'orange')}</div><p class="help-text" style="margin-bottom:19px">실제 견적이 아닌 예산 시나리오입니다. 확인하지 않은 금액은 비워두고, 필요 없는 항목만 0으로 입력해 주세요.</p><form id="cost-form"><div class="cost-grid">${costFields.map(([key, label, unit]) => `<div class="field"><label for="plan-${key}">${label} (${unit})</label><input id="plan-${key}" type="number" inputmode="numeric" min="0" ${key === 'visits' ? 'max="100"' : ''} name="${key}" value="${state.plan[key] ?? ''}" placeholder="미확인" step="1" ${['visits', 'caregiverAvailable'].includes(key) ? 'required' : ''}/></div>`).join('')}</div><div class="form-actions" style="margin-top:20px"><button type="submit" class="button primary">부담 다시 계산${icon('refresh')}</button></div></form><div class="cost-result" aria-live="polite"><div class="cost-result-top"><p>입력한 금액의 예상 소계</p><strong>${money(burden.estimatedSubtotal)}<small>원</small></strong></div><p class="unknown-costs">${burden.unknownItems.length ? `미확인 항목 · ${burden.unknownItems.map(escape).join(', ')}<br>전체 비용이 확정된 것은 아니에요.` : '모든 비용 항목을 입력했어요. 실제 금액은 예약·기관 견적으로 확인해 주세요.'}</p><p class="inline-message ${burden.careGap ? 'warning' : ''}">${burden.careGap ? `동행자가 정해지지 않은 방문이 ${burden.careGap}회 있어요. 가족 분담이나 동행 지원을 확인해 주세요.` : '입력한 방문 횟수에 필요한 보호자 동행을 확보한 가정이에요.'}</p></div></section>`;
}
function patientPanel() {
  return `<section class="panel" id="patient-settings"><div class="panel-top"><h2>가족·일정 정보</h2>${badge('시연용 입력')}</div><form id="patient-form" class="patient-form"><div class="field"><label for="patient-name">가상 환자 이름</label><input id="patient-name" name="name" value="${escape(state.patient.name)}" maxlength="60" required/></div><div class="field"><label for="patient-caregiver">보호자 이름</label><input id="patient-caregiver" name="caregiver" value="${escape(state.patient.caregiver)}" maxlength="60" required/></div><div class="field"><label for="patient-area">거주 지역</label><input id="patient-area" name="area" value="${escape(state.patient.area)}" maxlength="120" required/></div><div class="field"><label for="patient-date">이번 방문 예정일 · 시연</label><input id="patient-date" name="nextVisit" type="date" value="${escape(state.patient.nextVisit)}" required/></div><div class="form-actions"><button class="button outline small" type="submit">가족 정보 반영${icon('check')}</button></div></form><p class="help-text" style="margin-top:12px">이 정보는 외부 지도나 병원으로 전송하지 않습니다.</p></section>`;
}
function supportSourcesPanel() {
  if (!supportRegistry) return `<section class="panel"><h2>이동·돌봄 자료</h2><p class="help-text">${escape(supportLoadError || '지원 문의처의 출처를 불러오고 있습니다.')}</p></section>`;
  return `<section class="panel support-sources"><div class="panel-top"><h2>이동·돌봄 문의처의 근거</h2>${icon('database')}</div>${supportRegistry.datasets.map(dataset => `<div><h3>${escape(dataset.name)}</h3><p>${escape(dataset.rowCount)}행 · 기준 ${escape(dataset.asOf || '미확인')}</p><a class="text-button" href="${escape(dataset.sourceUrl)}" target="_blank" rel="noopener noreferrer">원출처 확인${icon('external')}</a></div>`).join('')}<p class="help-text">택시는 허브 연결 원출처의 2026년 자료를 사용합니다. 2020년 돌봄 등록 정보와 현재 동행 서비스 소개를 구분하며, 이용 가능일·요금은 문의가 필요합니다.</p></section>`;
}
function supportRequirementsPanel() {
  const requirements = state.visitSupport.requirements, summary = getVisitSupportSummary(state);
  return `<section class="support-requirements" id="visit-support"><div class="panel-top"><div><h2>이번 방문의 이동·동행 준비</h2><p>${escape(visitDateLabel())} · ${escape(state.patient.area)} 출발</p></div>${badge('예약·배차 시연', 'orange')}</div><form id="support-requirements-form"><div class="support-needs"><label class="checkbox"><input id="support-transport-needed" name="transportNeeded" type="checkbox" ${requirements.transportNeeded ? 'checked' : ''}/><span>택시 이동이 필요해요</span></label><label class="checkbox"><input id="support-companion-needed" name="companionNeeded" type="checkbox" ${requirements.companionNeeded ? 'checked' : ''}/><span>병원 동행이 필요해요</span></label><label class="checkbox"><input id="support-wheelchair" name="wheelchair" type="checkbox" ${requirements.wheelchair ? 'checked' : ''}/><span>휠체어 이용 조건을 확인해요</span></label></div><div class="support-time-row"><div class="field"><label for="support-appointment-time">진료 시각 · 미확인이라면 비워두세요</label><input id="support-appointment-time" name="appointmentTime" type="time" value="${escape(requirements.appointmentTime)}"/></div><button class="button outline" type="submit">필요 조건 반영${icon('check')}</button></div></form><div class="support-open-items"><strong>먼저 확인할 조건</strong>${summary.unresolved.length ? `<ul>${summary.unresolved.slice(0,4).map(item => `<li>${escape(item)}</li>`).join('')}</ul>` : '<p>입력한 시연 조건의 준비를 확인했습니다. 실제 예약과 배정은 제공기관 확인이 필요합니다.</p>'}</div></section>`;
}
function providerTypeLabel(provider) {
  return { call_taxi: '호출택시 등록 정보', care_contact: '지역 돌봄 문의처', hospital_escort: '공식 병원동행 소개 확인', accessible_transport: '교통약자 이동 문의처' }[provider.serviceType] || '지원 문의처';
}
function providerContact(provider) {
  const match = String(provider.phone || '').match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}|1\d{3}[-\s]?\d{4}/);
  return match ? `<a class="provider-phone" href="tel:${match[0].replace(/[^\d+]/g,'')}">${icon('phone')}${escape(provider.phone)}</a>` : `<span class="provider-phone">${escape(provider.phone || '번호는 공식 창구에서 확인')}</span>`;
}
function providerRow(provider, kind) {
  const selected = state.visitSupport[kind].provider?.id === provider.id;
  return `<article class="support-provider ${selected ? 'selected' : ''}"><div class="provider-heading"><strong>${escape(provider.name)}</strong><span>${escape(provider.matchLabel)}</span></div><p>${escape(providerTypeLabel(provider))} · ${escape(provider.region || '지역 확인 필요')}</p>${providerContact(provider)}<p class="provider-evidence">${provider.serviceType === 'care_contact' ? '병원동행 제공 여부부터 확인해야 합니다. ' : ''}${escape(provider.description || '')}</p><div class="provider-actions"><button class="button outline small" data-support-select="${escape(provider.id)}" data-support-kind="${kind}" ${selected ? 'disabled' : ''}>${selected ? '선택한 문의처' : '문의처 선택'}${icon(selected ? 'check' : 'arrow')}</button><a class="text-button" href="${escape(provider.source.url)}" target="_blank" rel="noopener noreferrer">${provider.source.asOf ? `기준 ${escape(provider.source.asOf)}` : `공식 안내 · ${escape(provider.source.retrievedAt?.slice(0,10) || '확인일 미상')} 확인`}${icon('external')}</a></div></article>`;
}
function inquiryDraft(kind) {
  try { return buildSupportInquiry(state, kind); } catch (error) { return error.message; }
}
function supportKindPanel(kind) {
  const selected = state.visitSupport[kind], summary = getVisitSupportSummary(state)[kind];
  const needed = state.visitSupport.requirements[kind === 'taxi' ? 'transportNeeded' : 'companionNeeded'];
  const candidates = supportCandidates(kind), provider = selected.provider;
  const prepared = ['prepared','available_demo','unavailable_demo','unreachable_demo'].includes(selected.status);
  const canRespond = selected.status === 'prepared';
  return `<section class="panel support-kind" id="visit-support-${kind}" data-support-panel="${kind}"><div class="panel-top"><h2>${icon(kind === 'taxi' ? 'car' : 'users')}${escape(supportNames[kind])}</h2><span class="badge ${supportTone(summary.status)}" id="support-status-${kind}" data-support-state="${escape(summary.status)}">${escape(summary.label)}</span></div>${!needed ? '<p class="help-text">추가 지원이 필요하지 않은 설정입니다. 필요 조건을 바꾸면 다시 문의처를 찾을 수 있습니다.</p>' : `<p class="support-kind-intro">${kind === 'taxi' ? '출발 지역과 차량 조건에 맞는 문의처를 찾고, 방문일의 이용 가능 여부를 확인하세요.' : '함께 갈 가족이 없다면 동행 서비스와 지역 돌봄 문의처에 지원 범위·날짜·자격을 확인하세요.'}</p><details class="support-options" ${!provider ? 'open' : ''}><summary>${provider ? '다른 문의처 살펴보기' : `지역에 맞는 문의처 ${candidates.length}곳`}</summary>${candidates.length ? candidates.slice(0,3).map(candidate => providerRow(candidate,kind)).join('') : `<p class="empty-note">${escape(supportLoadError || (supportRegistry ? '현재 자료에서 조건에 맞는 문의처를 찾지 못했습니다. 출발 지역을 확인하거나 공식 창구에 문의하세요.' : '공개 지원 정보를 불러오고 있습니다.'))}</p>`}${candidates.length > 3 ? `<details class="more-providers"><summary>나머지 ${candidates.length-3}곳 보기</summary>${candidates.slice(3).map(candidate => providerRow(candidate,kind)).join('')}</details>` : ''}</details>${provider ? `<div class="selected-support"><div class="selected-provider"><small>선택한 문의처</small><h3>${escape(provider.name)}</h3><p>${escape(providerTypeLabel(provider))}</p>${providerContact(provider)}</div>${selected.status === 'needs_recheck' ? '<p class="inline-message warning">방문 조건이 바뀌었습니다. 새 조건으로 다시 문의할 준비가 필요합니다.</p>' : ''}<button class="button secondary" data-support-prepare="${kind}">${prepared ? '문의 초안 다시 만들기' : '문의 초안 만들기'}${icon('file')}</button>${prepared ? `<div class="support-inquiry-draft"><label for="support-inquiry-${kind}">제공기관에 확인할 문의 초안</label><textarea id="support-inquiry-${kind}" readonly rows="9">${escape(inquiryDraft(kind))}</textarea><div class="draft-actions"><button class="text-button" data-support-copy="${kind}">초안 복사${icon('copy')}</button><button class="text-button" data-support-download="${kind}">텍스트 저장${icon('download')}</button></div></div>` : ''}<form class="support-response-form" data-support-response-form="${kind}"><h3>문의 응답 시연</h3><p>실제 제공기관에 연락하지 않습니다. 아래 응답을 선택해 다음 준비가 어떻게 바뀌는지 확인하세요.</p><div class="field"><label for="support-outcome-${kind}">이번에 재현할 응답</label><select id="support-outcome-${kind}" name="outcome" ${!canRespond ? 'disabled' : ''}><option value="available">해당 조건 가능 응답</option><option value="unavailable">해당 조건 이용 불가</option><option value="unreachable">연결되지 않음</option></select></div>${kind === 'taxi' && state.visitSupport.requirements.wheelchair ? `<label class="checkbox"><input id="support-wheelchair-confirmed" name="wheelchairConfirmed" type="checkbox" ${selected.wheelchairConfirmed ? 'checked' : ''} ${!canRespond ? 'disabled' : ''}/><span>휠체어 탑승 조건을 확인한 응답 재현</span></label>` : ''}${kind === 'taxi' && provider.serviceType === 'accessible_transport' ? `<label class="checkbox"><input id="support-eligibility-confirmed" name="eligibilityConfirmed" type="checkbox" ${selected.eligibilityConfirmed ? 'checked' : ''} ${!canRespond ? 'disabled' : ''}/><span>이용대상·회원등록을 확인한 응답 재현</span></label>` : ''}<button class="button primary" type="submit" ${!canRespond ? 'disabled' : ''}>합성 응답 반영${icon('phone')}</button></form>${selected.response ? `<p class="support-response ${supportTone(selected.status)}" role="status">${escape(selected.response)}<small>출처 · 합성 문의 응답</small></p>` : ''}</div>` : ''}` }<p class="support-boundary">실제 예약·배차·동행인 배정은 제공기관 확인이 필요합니다.</p></section>`;
}
function plan() {
  return `${pageTitle('이동·동행', '병원에 가는 날, 이동과 함께 갈 사람까지 준비해요.')}<p class="page-description">아래는 다음 방문 1건의 지원 준비입니다. 필요한 조건에 따라 지역 문의처와 질문이 바뀌며, 실제 예약·배차는 확정하지 않습니다.</p>${supportRequirementsPanel()}<div class="support-planning-grid">${supportKindPanel('taxi')}${supportKindPanel('companion')}</div><div class="subpage-grid plan-details"><div class="column">${patientPanel()}${costsPanel()}</div><div class="column">${planPanel()}${mapPanel()}<section class="panel"><div class="panel-top"><h2>이동 경로 확인</h2>${icon('map')}</div><p class="help-text">시연용 두 지점으로 외부 지도를 엽니다. 선택 기관의 실제 경로·이동시간은 따로 확인하세요.</p><a class="button outline" href="${googleMapUrl(true)}" target="_blank" rel="noopener noreferrer">Google 지도에서 경로 확인${icon('external')}</a></section></div></div>`;
}

function render() {
  const focused = document.activeElement?.id;
  const retainedMap = ['overview', 'plan'].includes(currentView) ? document.getElementById('care-map') : null;
  if (retainedMap) retainedMap.remove();
  else destroyMap();
  const content = { overview, documents, calls, plan, data }[currentView]();
  document.getElementById('app').innerHTML = `<div class="app-layout"><aside class="sidebar" aria-label="주 탐색"><a class="brand" href="#overview" data-nav="overview" aria-label="제주 진료 나침반, 진료 준비로"><img class="brand-image" src="/assets/jeju-mark-v1.png" alt="" width="46" height="46"/><span class="brand-name">제주<br>진료 나침반</span></a><p class="sidebar-caption">가족 진료 수첩</p><nav class="nav-list">${Object.entries(views).map(([key, [label, symbol]]) => `<button class="nav-item ${key === currentView ? 'active' : ''}" data-nav="${key}" ${key === currentView ? 'aria-current="page"' : ''} title="${label}">${icon(symbol)}<span class="nav-label">${label}</span>${key === 'documents' ? `<span class="nav-count">${getProgress(state).total - getProgress(state).prepared}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-spacer"></div><div class="sidebar-note"><span>제주데이터허브</span><button class="text-button" data-nav="data">기관·이동·돌봄 자료${icon('chevron')}</button></div><div class="profile"><div class="avatar">${escape((state.patient.caregiver || '보호자').slice(-2))}</div><div><strong>${escape(state.patient.caregiver)} 님</strong><small>보호자 · 시연 계정</small></div></div></aside><div class="workspace"><header class="topbar"><a class="mobile-brand" href="#overview" data-nav="overview" aria-label="제주 진료 나침반"><img src="/assets/jeju-mark-v1.png" alt="" width="30" height="30"/><span>제주 진료 나침반</span></a><div class="breadcrumb"><span>${escape(state.patient.name)} 님의 진료 연결</span>${icon('chevron')}<strong>${views[currentView][0]}</strong></div><div class="topbar-actions"><span class="demo-pill">시연 모드 · 실제 발신 없음</span><button class="icon-button" data-report title="진행 보고서 내려받기" aria-label="진행 보고서 내려받기">${icon('download')}</button><button class="icon-button" data-reset title="시연 처음으로" aria-label="시연 처음으로">${icon('refresh')}</button></div></header><main class="main" id="main" tabindex="-1">${content}<footer class="footnote"><span>${icon('shield')}전화·배차·동행 배정·의료진 회신은 시뮬레이션입니다. 실제 예약·협진은 확정되지 않았어요.</span><button class="text-button" data-report>진행 보고서 저장${icon('download')}</button></footer></main></div></div><div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;
  if (focused && document.getElementById(focused)) document.getElementById(focused).focus({ preventScroll: true });
  if (retainedMap && document.getElementById('care-map')) {
    document.getElementById('care-map').replaceWith(retainedMap);
    refreshMap();
  } else if (document.getElementById('care-map')) mountMap();
}

function notify(message, error = false) {
  clearTimeout(toastTimer);
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${error ? 'error' : ''}`;
  toast.hidden = false;
  toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 7000 : 4500);
}
function dispatch(action, message) {
  try { state = applyAction(state, action); assistantAnswer = ''; render(); if (message) notify(message); return true; }
  catch (error) { notify(error.message || '작업을 반영하지 못했어요. 입력 내용을 확인해 주세요.', true); return false; }
}
function navigate(view, target) {
  if (!views[view]) return;
  currentView = view; render();
  if (target) document.getElementById(target)?.scrollIntoView({ behavior: 'auto', block: target.startsWith('visit-support') ? 'start' : 'center' });
  else { window.scrollTo({ top: 0, behavior: 'auto' }); document.getElementById('main').focus({ preventScroll: true }); }
}
function answerQuestion(question) {
  const q = question.trim();
  if (/자료|서류|문서/.test(q)) {
    const missing = state.documents.filter(doc => isRequired(doc.id) && doc.status !== 'ready');
    assistantAnswer = missing.length ? `아직 준비하지 않은 자료는 ${missing.map(doc => doc.label || documentLabels[doc.id]).join(', ')}예요. 진찰 소견과 의뢰서는 의료진의 실제 기록이 필요합니다. ‘진료 자료’에서 출처를 확인해 주세요.` : '현재 요구된 자료를 모두 준비했어요. 두 기관의 절차 확인과 공유 허용을 점검한 뒤 검토 접수를 시연할 수 있어요.';
  } else if (/비용|부담|동행|돈/.test(q)) {
    const burden = calculateBurden(state.plan);
    assistantAnswer = `입력한 예산의 예상 소계는 ${money(burden.estimatedSubtotal)}원이며, 동행 미배정은 ${burden.careGap}회예요. ${burden.unknownItems.length ? `미확인 비용 ${burden.unknownItems.length}개가 있어 총비용은 아직 알 수 없어요.` : '실제 견적과 일정을 별도로 확인해 주세요.'} ‘일정·이동’에서 조건을 바꿔 볼 수 있어요.`;
  } else if (/다음|먼저|상황|진행|뭐|무엇/.test(q)) assistantAnswer = getSummary(state);
  else assistantAnswer = '이 시연 도우미는 현재 진행 상황, 필요한 자료, 동행·비용 가정을 정리해요. “다음에 뭘 할까?” 또는 “어떤 자료가 필요해?”라고 물어보세요. 환자의 진료 장소와 치료 계획은 의료진이 판단합니다.';
  render();
}
function downloadReport() {
  const url = URL.createObjectURL(new Blob([buildReport(state)], { type: 'text/markdown;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = '제주-진료-나침반-시연-보고서.md'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  notify('출처와 미확인 항목이 담긴 시연 보고서를 저장했어요.');
}

document.addEventListener('click', event => {
  const nav = event.target.closest('[data-nav]');
  if (nav) { event.preventDefault(); navigate(nav.dataset.nav, nav.dataset.focus); return; }
  const task = event.target.closest('[data-task]');
  if (task) {
    const action = task.dataset.task;
    navigate(action === 'call' ? 'calls' : action === 'plan' ? 'plan' : 'documents', action === 'call' ? `inquiry-${task.dataset.target}` : action === 'document' ? `document-${task.dataset.target}` : undefined);
    return;
  }
  const supportProvider = event.target.closest('[data-support-select]');
  if (supportProvider) {
    const provider = supportRegistry?.providers.find(item => item.id === supportProvider.dataset.supportSelect);
    if (provider && dispatch({type:'SUPPORT_SELECT_PROVIDER',kind:supportProvider.dataset.supportKind,provider},'문의할 지원기관을 선택했습니다. 실제 이용 가능 여부는 아직 확인 전입니다.')) document.getElementById(`visit-support-${supportProvider.dataset.supportKind}`)?.scrollIntoView({behavior:'auto',block:'start'});
    return;
  }
  const prepareSupport = event.target.closest('[data-support-prepare]');
  if (prepareSupport) { dispatch({type:'SUPPORT_PREPARE_INQUIRY',kind:prepareSupport.dataset.supportPrepare},'현재 조건으로 문의 초안을 만들었습니다. 실제 발신은 하지 않았습니다.'); return; }
  const copySupport = event.target.closest('[data-support-copy]');
  if (copySupport) {
    const draft=document.getElementById(`support-inquiry-${copySupport.dataset.supportCopy}`);
    if(draft) { const fallback=()=>{draft.focus();draft.select();notify('브라우저에서 복사하지 못했습니다. 선택된 초안을 직접 복사해 주세요.',true);}; if(navigator.clipboard?.writeText) navigator.clipboard.writeText(draft.value).then(()=>notify('문의 초안을 복사했습니다.')).catch(fallback); else fallback(); }
    return;
  }
  const saveSupport=event.target.closest('[data-support-download]');
  if(saveSupport) {
    const kind=saveSupport.dataset.supportDownload;
    const url=URL.createObjectURL(new Blob([inquiryDraft(kind)],{type:'text/plain;charset=utf-8'}));
    const link=document.createElement('a');link.href=url;link.download=`제주-방문-${kind==='taxi'?'택시':'동행'}-문의초안.txt`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('지원 문의 초안을 저장했습니다.');return;
  }
  const selected = event.target.closest('[data-select-hospital]');
  if (selected) { const hospital=hospitalRecords.find(record=>record.id===selected.dataset.selectHospital); if(hospital && dispatch({type:'SELECT_LOCAL_HOSPITAL',hospital},'선택한 기관의 접수 절차를 새로 확인할 수 있어요.')) navigate('calls','inquiry-jeju'); return; }
  const sample = event.target.closest('[data-example-document]');
  if (sample) {
    const id = sample.dataset.exampleDocument;
    dispatch({ type: 'ADD_DOCUMENT', id, source: '시연용 합성 기록 · 실제 환자 자료 아님', content: `합성 예시: ${documentLabels[id]}의 제출 여부를 확인하기 위한 시연 자료입니다. 실제 진찰·검사·의뢰를 수행하거나 환자의 상태를 판정한 내용이 아닙니다.` }, '합성 자료를 추가하고 다음 할 일을 갱신했어요.');
    return;
  }
  const remove = event.target.closest('[data-remove-document]');
  if (remove) { dispatch({ type: 'REMOVE_DOCUMENT', id: remove.dataset.removeDocument }, '자료를 제거하고 검토 상태를 다시 확인했어요.'); return; }
  if (event.target.closest('[data-submit-packet]')) { dispatch({ type: 'SUBMIT_PACKET' }, '협진 검토 접수를 재현했어요. 실제 외부 전송은 하지 않았습니다.'); return; }
  const question = event.target.closest('[data-question]');
  if (question) { answerQuestion(question.dataset.question); return; }
  if (event.target.closest('[data-report]')) { downloadReport(); return; }
  if (event.target.closest('[data-reset]')) {
    state = createDemoCase(); assistantAnswer = ''; hospitalRecords=[...publicHospitals]; candidateOrigin='public-preview'; importProfile=undefined; hospitalFilters={department:'',area:''}; busyTargets.clear(); navigate('overview'); notify('합성 사례의 처음 단계로 돌아왔어요.');
  }
});
document.addEventListener('change', async event => {
  if(event.target.id==='hospital-file') {
    const file=event.target.files?.[0]; if(!file || !dataTools)return;
    try { if(file.size>2*1024*1024)throw new Error('기관 자료는 2MB 이하 파일로 가져와 주세요.'); const imported=dataTools.parseHospitalImport(await file.text(),file.name,{retrievedAt:new Date().toISOString(),kind:'user-import'}); hospitalRecords=imported.records; candidateOrigin='user-import'; importProfile=imported.profile; hospitalFilters={department:'',area:''}; render(); notify(`사용자 자료에서 ${hospitalRecords.length}개 등록 행을 읽었어요.`); } catch(error) {notify(error.message,true);}
    return;
  }
  if (event.target.matches('[data-permission]')) dispatch({ type: 'SET_PERMISSION', permission: event.target.dataset.permission, value: event.target.checked }, '시연의 허용 범위를 반영했어요.');
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
  if(form.id==='support-requirements-form') {
    dispatch({type:'SUPPORT_UPDATE_REQUIREMENTS',values:{transportNeeded:data.has('transportNeeded'),companionNeeded:data.has('companionNeeded'),wheelchair:data.has('wheelchair'),appointmentTime:String(data.get('appointmentTime')||'')}},'지원 조건을 반영하고 다시 확인할 항목을 갱신했습니다.');return;
  }
  if(form.dataset.supportResponseForm) {
    dispatch({type:'SUPPORT_RECORD_RESPONSE',kind:form.dataset.supportResponseForm,outcome:String(data.get('outcome')),wheelchairConfirmed:data.has('wheelchairConfirmed'),eligibilityConfirmed:data.has('eligibilityConfirmed')},'합성 응답을 반영했습니다. 실제 예약·배차·동행 배정은 확정하지 않았습니다.');return;
  }
  if (form.id === 'hospital-filter') {hospitalFilters={department:String(data.get('department')||''),area:String(data.get('area')||'')};render();return;}
  if (form.id === 'assistant-form') { answerQuestion(String(data.get('question') || '')); return; }
  if (form.dataset.documentForm) {
    dispatch({ type: 'ADD_DOCUMENT', id: form.dataset.documentForm, source: String(data.get('source') || ''), content: String(data.get('content') || '') }, '출처가 있는 자료를 준비 목록에 반영했어요.'); return;
  }
  if (form.dataset.callForm) {
    const target = form.dataset.callForm;
    const outcome = String(data.get('outcome'));
    busyTargets.add(target); render();
    await new Promise(resolve => setTimeout(resolve, 500));
    if (!busyTargets.has(target)) return;
    busyTargets.delete(target);
    dispatch({ type: 'RECORD_CALL', target, outcome }, '합성 문의 응답을 반영해 자료와 할 일을 갱신했어요.'); return;
  }
  if (form.id === 'review-form') {
    dispatch({ type: 'RECORD_REVIEW', outcome: String(data.get('outcome')) }, '합성 의료진 회신을 반영했어요. 실제 진료 판단이 아닙니다.'); return;
  }
  if (form.id === 'cost-form') {
    const values = Object.fromEntries(costFields.map(([key]) => [key, data.get(key) === '' ? null : Number(data.get(key))]));
    dispatch({ type: 'UPDATE_PLAN', values }, '방문·동행 가정으로 예산과 돌봄 공백을 다시 계산했어요.'); return;
  }
  if (form.id === 'patient-form') dispatch({ type: 'UPDATE_PATIENT', values: Object.fromEntries(data) }, '가족·일정 정보를 반영했어요.');
});

render();
loadSupportRegistry().then(registry=>{supportRegistry=registry;if(['overview','plan','data'].includes(currentView))render();}).catch(error=>{supportLoadError=error.message || '지원 문의처를 불러오지 못했습니다.';if(['overview','plan','data'].includes(currentView))render();});
import('./datahub.js').then(async tools => {
  dataTools=tools;
  const results=await Promise.allSettled([tools.loadDataProfile(),tools.loadHospitalCandidates()]);
  if(results[0].status==='fulfilled')dataProfile=results[0].value;
  else dataProfileError=results[0].reason.message;
  if(results[1].status==='fulfilled') {
    candidateSnapshot=results[1].value;
    publicHospitals=candidateSnapshot.records;
    if(candidateOrigin!=='user-import')hospitalRecords=[...publicHospitals];
  } else dataProfileError=results[1].reason.message;
  if(['overview','data'].includes(currentView))render();
}).catch(() => {
  dataProfileError='공개 기관 자료를 불러오지 못했어요. 잠시 후 다시 시도하거나 보유한 파일을 가져와 주세요.';
  if(currentView==='data')render();
});

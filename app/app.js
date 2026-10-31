import { createDemoCase, applyAction, getTasks, getProgress, getSummary, calculateBurden, buildReport, DOCUMENT_DEFINITIONS } from './domain.js';
import { icon } from './icons.js';
import { mountMap, destroyMap, refreshMap, googleMapUrl } from './map.js';

let state = createDemoCase();
let currentView = 'overview';
let assistantAnswer = '';
let toastTimer;
const busyTargets = new Set();
const views = { overview: ['진료 준비', 'home'], documents: ['진료 자료', 'folder'], calls: ['병원 문의', 'phone'], plan: ['일정·이동', 'calendar'] };
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
  const labels = { call: '병원 문의 시연', document: '자료 준비하기', submit: '자료 묶음 확인', wait: '회신 단계 보기', plan: '실행 계획 보기' };
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
  return `<section class="panel assistant-panel" aria-labelledby="assistant-title"><div class="assistant-title">${icon('compass')}<h2 id="assistant-title">나침반 도우미</h2></div><p class="assistant-message" id="assistant-response" aria-live="polite">${escape(assistantAnswer || getSummary(state))}</p><p class="assistant-attribution">현재 진행 상태를 정리하는 규칙 기반 시연</p><div class="assistant-quick"><button class="quick-chip" data-question="자료">어떤 자료가 필요해?</button><button class="quick-chip" data-question="다음">다음엔 뭘 할까?</button><button class="quick-chip" data-question="비용">동행 부담은?</button></div><form class="assistant-form" id="assistant-form"><label class="visually-hidden" for="assistant-input">진행 상황에 관해 물어보기</label><input id="assistant-input" name="question" placeholder="진료 준비에 대해 물어보세요" maxlength="300" autocomplete="off" required/><button type="submit" aria-label="도우미에게 질문 보내기">${icon('send')}</button></form></section>`;
}
function mapPanel() {
  return `<section class="panel map-panel" aria-labelledby="map-title"><div class="panel-top"><h2 id="map-title">제주에서 이어지는 진료</h2>${icon('pin')}</div><div class="map-legend"><span><i></i>부모님 댁</span><span><i></i>제주 협진 병원</span></div><div id="care-map" class="map-canvas" role="region" aria-label="애월과 제주 시내의 가상 진료 지점 지도"></div><div class="map-foot"><p>지도는 실제 지형, 두 지점은 시연용 가상 위치예요.</p><p class="map-load-state">외부 지도 배경을 불러오고 있어요.</p><a href="${googleMapUrl()}" target="_blank" rel="noopener noreferrer">Google 지도에서 위치 보기${icon('external')}</a></div></section>`;
}
function activitiesPanel() {
  const events = state.events.slice(-5).reverse();
  return `<section class="panel activity-panel" aria-labelledby="activity-title"><div class="panel-top"><h2 id="activity-title">최근 진행 기록</h2><span class="panel-meta">작업과 출처를 함께 남겨요</span></div>${events.length ? events.map(event => `<div class="activity-row"><span class="activity-dot"></span><div class="activity-text"><strong>${escape(event.title)}</strong><p>${escape(event.detail)}${event.source ? ` · ${escape(event.source)}` : ''}</p></div><time class="activity-time">${formatTime(event.at)}</time></div>`).join('') : '<p class="empty-note">첫 병원 문의를 시연하면 응답과 다음 작업이 여기에 기록됩니다.</p>'}</section>`;
}
function formatTime(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '시연 기록' : date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function isRequired(id) { return id !== 'referral' || Object.values(state.inquiries).some(inquiry => inquiry.requestedDocuments?.includes(id)); }

function overview() {
  return `${pageTitle('우리 가족의 진료 준비', '김하늘 님, 오늘도 함께 차근차근 준비해요.')}<section class="hero" aria-label="제주 해안 일러스트"><div class="hero-copy"><h2>멀리 있어도,<br>진료는 함께 이어가요.</h2><p>제주의 진찰부터 기존 주치의의 회신까지.<br>가족이 챙길 일을 나침반이 함께 정리해요.</p><span class="hero-label">${icon('leaf')}제주에서, 우리 가족의 일상 가까이</span></div></section>${patientStrip()}${progressPanel()}<div class="dashboard-grid"><div class="column">${tasksPanel()}${documentsPanel()}</div><div class="column right-column">${assistantPanel()}${mapPanel()}</div></div>${activitiesPanel()}`;
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
  const pending = state.packet.status === 'submitted';
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
  return `${pageTitle('병원 문의', '한 번의 문의를, 다음 준비로 이어가요.')}<p class="page-description">병원에서 무엇을 요구했는지에 따라 할 일과 자료 목록이 바뀝니다. 아래는 가상 기관의 응답을 재현하는 시연이며 실제 발신은 하지 않아요.</p><div class="subpage-grid"><section class="panel"><div class="panel-top"><h2>제주와 기존 병원 연결</h2>${badge('통화 시뮬레이션', 'orange')}</div>${inquiryPanel('mainland')}${inquiryPanel('jeju')}</section><div class="column"><section class="panel permission-panel"><h2>문의 범위</h2><p class="help-text">보호자가 허용한 범위에서 절차를 확인해요.</p><label class="checkbox"><input type="checkbox" data-permission="inquiry" ${state.permissions.inquiry ? 'checked' : ''}/><span><strong>접수 절차 문의 허용</strong>가상 병원의 창구·서류·협진 참여 절차를 묻는 단계를 재현합니다.</span></label><p class="help-text">임상 판단과 예약 확정은 문의 응답과 별도로 확인합니다.</p></section>${assistantPanel()}<section class="panel"><div class="panel-top"><h2>후보 정보의 출처</h2>${icon('info')}</div><p class="help-text">제주데이터허브 ‘병·의원 정보’는 기관명·주소·진료과 후보 조회에 활용할 예정입니다. 현재 기관명과 위치는 합성이며, 운영 데이터 연결·이용조건 확인이 남아 있어요.</p><a class="text-button" href="https://jejudatahub.net/data/view/data/859" target="_blank" rel="noopener noreferrer">공공데이터 출처 보기${icon('external')}</a></section></div></div>`;
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
  return `<section class="panel" id="patient-settings"><div class="panel-top"><h2>가족·일정 정보</h2>${badge('시연용 입력')}</div><form id="patient-form" class="patient-form"><div class="field"><label for="patient-name">가상 환자 이름</label><input id="patient-name" name="name" value="${escape(state.patient.name)}" maxlength="60" required/></div><div class="field"><label for="patient-caregiver">보호자 이름</label><input id="patient-caregiver" name="caregiver" value="${escape(state.patient.caregiver)}" maxlength="60" required/></div><div class="field"><label for="patient-area">거주 지역</label><input id="patient-area" name="area" value="${escape(state.patient.area)}" maxlength="120" required/></div><div class="field"><label for="patient-date">기존 다음 외래 일정</label><input id="patient-date" name="nextVisit" type="date" value="${escape(state.patient.nextVisit)}" required/></div><div class="form-actions"><button class="button outline small" type="submit">가족 정보 반영${icon('check')}</button></div></form><p class="help-text" style="margin-top:12px">이 정보는 외부 지도나 병원으로 전송하지 않습니다.</p></section>`;
}
function plan() {
  return `${pageTitle('일정·이동', '진료 계획을 가족의 일상에 맞춰 준비해요.')}<p class="page-description">의료진 회신을 바탕으로 할 일을 확인하고, 방문 횟수나 동행 조건이 바뀔 때 생활 부담을 계산해 보세요. 이동시간과 예약은 실제 확인 전까지 확정하지 않아요.</p><div class="subpage-grid"><div class="column">${planPanel()}${costsPanel()}${patientPanel()}</div><div class="column">${mapPanel()}<section class="panel"><div class="panel-top"><h2>이동 경로 확인</h2>${icon('map')}</div><p class="help-text">아래 링크는 시연용 두 지점으로 Google 지도를 엽니다. 실제 경로·이동시간·교통편은 외부 지도에서 확인해 주세요.</p><a class="button outline" href="${googleMapUrl(true)}" target="_blank" rel="noopener noreferrer" style="margin-top:16px">Google 지도에서 경로 확인${icon('external')}</a></section>${assistantPanel()}</div></div>`;
}

function render() {
  const focused = document.activeElement?.id;
  const retainedMap = ['overview', 'plan'].includes(currentView) ? document.getElementById('care-map') : null;
  if (retainedMap) retainedMap.remove();
  else destroyMap();
  const content = { overview, documents, calls, plan }[currentView]();
  document.getElementById('app').innerHTML = `<div class="app-layout"><aside class="sidebar" aria-label="주 탐색"><a class="brand" href="#overview" data-nav="overview" aria-label="제주 진료 나침반, 진료 준비로"><span class="brand-mark">${icon('compass')}</span><span class="brand-name">제주<br><span>진료 나침반</span></span></a><p class="sidebar-caption">우리 가족 워크스페이스</p><nav class="nav-list">${Object.entries(views).map(([key, [label, symbol]]) => `<button class="nav-item ${key === currentView ? 'active' : ''}" data-nav="${key}" ${key === currentView ? 'aria-current="page"' : ''} title="${label}">${icon(symbol)}<span class="nav-label">${label}</span>${key === 'documents' ? `<span class="nav-count">${getProgress(state).total - getProgress(state).prepared}</span>` : ''}</button>`).join('')}</nav><div class="sidebar-spacer"></div><div class="sidebar-note">${icon('leaf')}<strong>제주에서, 함께</strong>진료 준비의 작은 빈틈까지<br>가족과 나침반이 함께 챙겨요.</div><div class="profile"><div class="avatar">${escape((state.patient.caregiver || '보호자').slice(-2))}</div><div><strong>${escape(state.patient.caregiver)} 님</strong><small>보호자 · 시연 계정</small></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb"><span>가족 진료 워크스페이스</span>${icon('chevron')}<strong>${views[currentView][0]}</strong></div><div class="topbar-actions"><span class="demo-pill">합성 사례 · 시연 모드</span><button class="icon-button" data-report title="진행 보고서 내려받기" aria-label="진행 보고서 내려받기">${icon('download')}</button><button class="icon-button" data-reset title="시연 처음으로" aria-label="시연 처음으로">${icon('refresh')}</button></div></header><main class="main" id="main" tabindex="-1">${content}<footer class="footnote"><span>${icon('shield')}전화·자료 전송·의료진 회신은 시뮬레이션입니다. 실제 예약·협진은 확정되지 않았어요.</span><button class="text-button" data-report>진행 보고서 저장${icon('download')}</button></footer></main></div></div><div class="toast" id="toast" role="status" aria-live="polite" hidden></div>`;
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
  if (target) document.getElementById(target)?.scrollIntoView({ behavior: 'auto', block: 'center' });
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
    state = createDemoCase(); assistantAnswer = ''; busyTargets.clear(); navigate('overview'); notify('합성 사례의 처음 단계로 돌아왔어요.');
  }
});
document.addEventListener('change', event => {
  if (event.target.matches('[data-permission]')) dispatch({ type: 'SET_PERMISSION', permission: event.target.dataset.permission, value: event.target.checked }, '시연의 허용 범위를 반영했어요.');
});
document.addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const data = new FormData(form);
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

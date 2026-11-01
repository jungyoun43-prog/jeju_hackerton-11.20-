import { getJourneyContactContext } from './care-journey.js';
import { callRecipientId, getCallRecoveryHandoffs } from './call-recovery.js';

/** 단일 방문의 이동·동행 문의 준비. 실제 발신·예약·배차·결제를 수행하지 않는다. */
const KINDS = ['taxi', 'companion'];
const STATUSES = ['not_selected', 'selected', 'prepared', 'available_demo', 'unavailable_demo', 'unreachable_demo', 'needs_recheck'];
const OUTCOMES = ['available', 'unavailable', 'unreachable'];
const REQUIREMENTS = ['transportNeeded', 'companionNeeded', 'wheelchair', 'appointmentTime'];
const MAX_EVENTS = 200;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const clean = (value, label, max = 300, empty = false) => {
  assert(typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), `${label} 형식과 길이를 확인해 주세요.`);
  const normalized = value.trim();
  assert(empty || normalized.length > 0, `${label}이 필요합니다.`);
  return normalized;
};
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
const validRetrieved = value => typeof value === 'string' && value.length <= 40 && /^\d{4}-\d{2}-\d{2}(?:T[^\s]+)?$/.test(value) && validDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value));
const neededKey = kind => kind === 'taxi' ? 'transportNeeded' : 'companionNeeded';
const kindName = kind => kind === 'taxi' ? '이동' : '동행';
const md = value => String(value ?? '').replace(/[<>]/g, char => char === '<' ? '&lt;' : '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');

export function createVisitSupport() {
  return {
    requirements: { transportNeeded: true, companionNeeded: true, wheelchair: false, appointmentTime: '' },
    taxi: { provider: null, status: 'not_selected', response: '', wheelchairConfirmed: false, eligibilityConfirmed: false },
    companion: { provider: null, status: 'not_selected', response: '' },
  };
}

function validateRequirements(requirements) {
  assert(object(requirements) && Object.keys(requirements).every(key => REQUIREMENTS.includes(key)), '지원 조건을 확인해 주세요.');
  for (const key of REQUIREMENTS.slice(0, 3)) assert(typeof requirements[key] === 'boolean', '이동·동행·휠체어 필요 여부를 확인해 주세요.');
  assert(typeof requirements.appointmentTime === 'string' && (requirements.appointmentTime === '' || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(requirements.appointmentTime)), '예약 시각은 HH:mm 형식으로 입력하거나 미확인으로 비워 주세요.');
}

function httpsUrl(value, hosts, label) {
  const raw = clean(value, label, 1000);
  let url;
  try { url = new URL(raw); } catch { throw new Error(`${label} URL을 확인해 주세요.`); }
  assert(url.protocol === 'https:' && !url.username && !url.password && hosts.includes(url.hostname) && !url.port, `${label}는 확인된 공식 HTTPS 출처여야 합니다.`);
  return url;
}

function providerRecord(provider, kind) {
  assert(object(provider) && Object.keys(provider).length <= 24 && provider.kind === kind, '지원 종류에 맞는 문의처를 선택해 주세요.');
  const serviceTypes = kind === 'taxi' ? ['call_taxi', 'accessible_transport'] : ['care_contact', 'hospital_escort'];
  assert(serviceTypes.includes(provider.serviceType), '문의처의 지원 유형을 확인해 주세요.');
  const id = clean(provider.id, '문의처 식별자', 120);
  assert(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(id), '문의처 식별자를 확인해 주세요.');
  const source = provider.source;
  assert(object(source) && Object.keys(source).length <= 12, '문의처의 출처가 필요합니다.');
  const datasetId = clean(source.datasetId, '데이터 식별자', 20, true);
  const scope = clean(source.scope, '자료 범위', 60);
  let url, hubUrl = '';
  if (provider.serviceType === 'call_taxi') {
    assert(datasetId === '327' && scope === 'linked-public-file', '콜택시327의 연결 공개 자료를 선택해 주세요.');
    url = httpsUrl(source.url, ['www.data.go.kr', 'data.go.kr'], '콜택시 원출처');
    assert(url.pathname === '/data/15056321/fileData.do', '콜택시 연결 원출처를 확인해 주세요.');
  } else if (provider.serviceType === 'care_contact') {
    assert(datasetId === '254' && scope === 'public-preview', '돌봄254 공개 미리보기의 문의처를 선택해 주세요.');
    url = httpsUrl(source.url, ['jejudatahub.net', 'www.jejudatahub.net'], '돌봄 원출처');
    assert(url.pathname === '/data/view/data/254', '돌봄 공개 자료 출처를 확인해 주세요.');
  } else {
    assert(datasetId === '' && scope === 'official-service-page', '공식 서비스 소개 출처를 확인해 주세요.');
    const hosts = provider.serviceType === 'hospital_escort' ? ['www.jjcsc.co.kr', 'jjcsc.co.kr'] : ['www.jejuhappycall.com', 'jejuhappycall.com'];
    url = httpsUrl(source.url, hosts, '공식 서비스');
  }
  if (datasetId) {
    const hub = httpsUrl(source.hubUrl, ['jejudatahub.net', 'www.jejudatahub.net'], '허브 출처');
    assert(hub.pathname === `/data/view/data/${datasetId}`, '허브 데이터 식별자와 출처가 다릅니다.');
    hubUrl = hub.href;
  } else if (source.hubUrl) {
    throw new Error('공식 보완 서비스는 허브 데이터로 표시하지 않습니다.');
  }
  const asOf = clean(source.asOf, '자료 기준일', 10, true);
  assert(datasetId ? validDate(asOf) : asOf === '' || validDate(asOf), '자료 기준일을 확인해 주세요.');
  assert(validRetrieved(source.retrievedAt), '자료 조회일을 확인해 주세요.');
  const phone = clean(provider.phone, '대표 연락처', 80, true);
  assert(phone === '' || /^[+0-9][0-9()\s./-]*$/.test(phone), '대표 연락처 형식을 확인해 주세요.');
  return {
    id, kind, name: clean(provider.name, '문의처 이름', 300), region: clean(provider.region, '등록 지역', 150),
    address: clean(provider.address, '기관 주소', 1000, true), phone, serviceType: provider.serviceType,
    description: clean(provider.description, '지원 설명', 1200, true),
    source: { datasetId, url: url.href, hubUrl, scope, asOf, retrievedAt: source.retrievedAt },
  };
}

function supportOf(state) {
  assert(object(state) && object(state.patient), '방문 사례 정보가 필요합니다.');
  const support = state.visitSupport ?? createVisitSupport();
  assert(object(support), '이동·동행 준비 상태를 확인해 주세요.');
  validateRequirements(support.requirements);
  for (const kind of KINDS) {
    const entry = support[kind];
    assert(object(entry) && STATUSES.includes(entry.status) && typeof entry.response === 'string' && entry.response.length <= 2000, '지원 문의 상태를 확인해 주세요.');
    if (entry.provider !== null) providerRecord(entry.provider, kind);
    assert(entry.provider !== null || entry.status === 'not_selected', '선택한 문의처가 필요합니다.');
    assert(entry.inquiry === undefined || typeof entry.inquiry === 'string' && entry.inquiry.length <= 12000, '문의 초안 길이를 확인해 주세요.');
    assert(entry.contextKey === undefined || typeof entry.contextKey === 'string' && entry.contextKey.length <= 5000, '문의 조건을 확인해 주세요.');
  }
  return support;
}

function contextOf(state) {
  const support = supportOf(state);
  return {
    area: clean(state.patient.area, '출발 지역', 200, true),
    date: clean(state.patient.nextVisit, '방문일', 10, true),
    destination: clean(state.selectedHospital?.companyName ?? state.patient.localHospital ?? '', '방문 기관', 300, true),
    address: clean(state.selectedHospital?.address ?? '', '공개 기관 주소', 1000, true),
    ...support.requirements,
    inquiryAllowed: state.permissions?.inquiry !== false,
    journeyMobility: getJourneyContactContext(state, 'taxi').filter(line => !line.startsWith('변경 전 ')),
  };
}
const contextKey = state => JSON.stringify(contextOf(state));

const LOCAL_AREAS = ['애월', '한림', '한경', '구좌', '조천', '우도', '추자', '대정', '남원', '성산', '안덕', '표선'];
function definitelyDifferentRegion(provider, area) {
  const region = provider.region.replace(/제주특별자치도|제주도/g, '').trim();
  if (provider.serviceType === 'accessible_transport' || /^(?:제주|전역|제주 전역)?$/.test(region)) return false;
  const local = LOCAL_AREAS.filter(name => region.includes(name));
  if (local.length) return !local.some(name => area.includes(name));
  const city = region.includes('서귀포') ? '서귀포' : region.includes('제주시') ? '제주시' : '';
  return Boolean(city && (city === '서귀포' ? area.includes('제주시') : area.includes('서귀포')));
}

function log(state, title, detail, source = '이동·동행 문의 시뮬레이터 · 실제 발신 없음') {
  const events = Array.isArray(state.events) ? state.events : [];
  const sequence = events.reduce((max, event) => Math.max(max, Number(/^event-(\d+)$/.exec(event.id)?.[1]) || 0), 0) + 1;
  events.push({ id: `event-${sequence}`, at: new Date().toISOString(), title, detail, kind: 'support', source });
  state.events = events.slice(-MAX_EVENTS);
}

function resetResponse(entry) {
  entry.response = '';
  if ('wheelchairConfirmed' in entry) entry.wheelchairConfirmed = false;
  if ('eligibilityConfirmed' in entry) entry.eligibilityConfirmed = false;
}

export function reconcileVisitSupport(previous, nextState) {
  const previousSupport = supportOf(previous);
  const next = structuredClone(nextState);
  next.visitSupport ??= createVisitSupport();
  const support = supportOf(next);
  const oldContext = contextOf(previous), newContext = contextOf(next);
  if (JSON.stringify(oldContext) === JSON.stringify(newContext)) return next;
  for (const kind of KINDS) {
    const entry = support[kind];
    if (!entry.provider) continue;
    if (oldContext.area !== newContext.area && definitelyDifferentRegion(entry.provider, newContext.area)) {
      support[kind] = structuredClone(createVisitSupport()[kind]);
      continue;
    }
    const recorded = ['available_demo', 'unavailable_demo', 'unreachable_demo', 'needs_recheck'].includes(previousSupport[kind].status);
    resetResponse(entry);
    if (recorded) entry.status = 'needs_recheck';
    if (entry.inquiry !== undefined || entry.status === 'prepared' || recorded) {
      entry.inquiry = buildSupportInquiry(next, kind);
      entry.contextKey = contextKey(next);
    }
  }
  log(next, '이동·동행 조건을 다시 확인해요', '방문일·기관·출발 지역·지원 조건이 바뀌었습니다. 이전 합성 응답을 새 조건의 확인으로 사용하지 않습니다.');
  return next;
}

function questionsFor(state, kind) {
  const support = supportOf(state), serviceType = support[kind].provider?.serviceType;
  const questions = [];
  if (kind === 'taxi') {
    if (serviceType === 'accessible_transport') questions.push('이용 대상에 해당하는지와 회원 등록·사전 신청 절차는 무엇인가요?', '휠체어 탑승 가능한 차량과 왕복 이동을 지원하나요?');
    else questions.push('요청한 출발 지역에서 병원까지 이동 가능한 차량이 있나요?', '왕복 이용과 진료 후 귀가 차량을 어떻게 요청하나요?');
    questions.push('예약 시각에 맞춘 출발 시각과 접수 방법은 무엇인가요?', '요금·추가 비용·취소 조건을 확인할 수 있나요?');
    if (support.requirements.wheelchair) questions.push('휠체어를 탄 채 탑승 가능한지, 이동 보조나 별도 차량이 필요한지 확인해 주세요.');
  } else if (serviceType === 'care_contact') {
    questions.push('현재 병원 동행을 제공하나요? 제공하지 않으면 문의할 다른 기관을 안내받을 수 있나요?', '서비스 대상·이용 자격과 신청 절차는 무엇인가요?', '요청 날짜의 방문·접수·진료·귀가 중 어느 범위까지 지원하나요?', '이동 차량 포함 여부·비용·준비할 사항을 확인할 수 있나요?');
  } else {
    questions.push('요청한 날짜와 예약 시각에 병원 동행이 가능한가요?', '서비스 지역·이용 대상·신청 자격은 어떻게 되나요?', '방문·접수·진료·약국·귀가 중 지원 범위와 이동 차량 포함 여부는 무엇인가요?', '이용 비용·취소 조건·접수 절차를 확인할 수 있나요?');
  }
  if (kind === 'companion' && support.requirements.wheelchair) questions.push('휠체어 이동 보조를 어느 범위까지 지원하나요?');
  return [...questions, ...getJourneyContactContext(state, kind)];
}

export function buildSupportInquiry(state, kind) {
  assert(KINDS.includes(kind), '지원 문의 종류를 확인해 주세요.');
  const support = supportOf(state), entry = support[kind], context = contextOf(state);
  const label = kind === 'taxi' ? '이동 지원' : '병원 동행 지원';
  return [
    `[${label} 문의 초안 · 시연, 실제 발신 없음]`,
    `문의처: ${entry.provider?.name || '선택 전'}`,
    `출발 지역: ${context.area || '미확인'}`,
    `방문일: ${context.date || '미확인'} / 예약 시각: ${context.appointmentTime || '미확인'}`,
    `방문 기관: ${context.destination || '미확인'}${context.address ? ` / 공개 주소: ${context.address}` : ''}`,
    `휠체어 지원: ${context.wheelchair ? '필요 · 탑승·보조 가능 여부 미확인' : '현재 입력에서는 필요하지 않음'}`,
    `보호자 외 동행 지원: ${context.companionNeeded ? '필요' : '현재 입력에서는 필요하지 않음'}`,
    '', '확인할 질문:', ...questionsFor(state, kind).map(question => `- ${question}`),
    '', '환자 실명·진단명·병력·검사 결과는 이 초안에 포함하지 않았습니다. 배차·예약·비용은 확정하지 않았습니다.',
  ].join('\n');
}

export function applyVisitSupportAction(state, action) {
  const current = supportOf(state);
  assert(object(action) && typeof action.type === 'string' && action.type.startsWith('SUPPORT_'), '지원 문의 작업을 확인해 주세요.');
  let provider;
  if (action.type === 'SUPPORT_SELECT_PROVIDER') {
    assert(KINDS.includes(action.kind), '지원 문의 종류를 확인해 주세요.');
    provider = providerRecord(action.provider, action.kind);
    assert(!definitelyDifferentRegion(provider, state.patient.area), '출발 지역에 맞는 문의처를 선택해 주세요.');
  }
  const next = structuredClone(state);
  next.visitSupport ??= createVisitSupport();
  const support = next.visitSupport;
  if (action.type === 'SUPPORT_UPDATE_REQUIREMENTS') {
    assert(object(action.values) && Object.keys(action.values).length > 0 && Object.keys(action.values).every(key => REQUIREMENTS.includes(key)), '변경할 지원 조건을 확인해 주세요.');
    support.requirements = { ...current.requirements, ...action.values };
    validateRequirements(support.requirements);
    return reconcileVisitSupport(state, next);
  }
  assert(KINDS.includes(action.kind), '지원 문의 종류를 확인해 주세요.');
  const entry = support[action.kind];
  if (action.type === 'SUPPORT_SELECT_PROVIDER') {
    if (JSON.stringify(entry.provider) === JSON.stringify(provider)) return next;
    support[action.kind] = { ...createVisitSupport()[action.kind], provider, status: 'selected' };
    log(next, `${kindName(action.kind)} 문의처를 선택했어요`, `${provider.name}의 공개 등록 정보·서비스 소개를 참고했습니다. 현재 제공·가능 시간은 미확인입니다.`, `${provider.source.datasetId ? `제주데이터허브 ${provider.source.datasetId} · ` : ''}${provider.source.scope} · ${provider.source.url}`);
    return next;
  }
  assert(entry.provider, '먼저 지원 문의처를 선택해 주세요.');
  assert(support.requirements[neededKey(action.kind)], '필요하지 않은 지원의 문의 응답을 진행할 수 없습니다.');
  if (action.type === 'SUPPORT_PREPARE_INQUIRY') {
    entry.inquiry = buildSupportInquiry(next, action.kind);
    entry.contextKey = contextKey(next);
    entry.status = 'prepared';
    resetResponse(entry);
    log(next, `${kindName(action.kind)} 문의 초안을 준비했어요`, '출발 지역·일정·공개 기관과 지원 조건으로 질문을 만들었습니다. 의료기록을 포함하거나 실제 전화를 걸지 않았습니다.');
    return next;
  }
  if (action.type === 'SUPPORT_RECORD_RESPONSE') {
    assert(OUTCOMES.includes(action.outcome), '가능·불가·불통의 시연 응답을 선택해 주세요.');
    assert(next.permissions?.inquiry !== false, '전화 문의 위임을 허용한 뒤 응답을 재현해 주세요.');
    assert(entry.status === 'prepared' && entry.contextKey === contextKey(next), '현재 조건의 문의 초안을 먼저 준비해 주세요. 변경된 조건은 다시 문의해야 합니다.');
    for (const key of ['wheelchairConfirmed', 'eligibilityConfirmed']) assert(action[key] === undefined || typeof action[key] === 'boolean', '추가 확인 항목은 확인 여부로 입력해 주세요.');
    entry.status = `${action.outcome}_demo`;
    const responses = {
      available: '요청한 일정·지원의 가능 응답을 재현했습니다. 합성 응답이며 실제 제공·예약·배차·요금은 확정되지 않았습니다.',
      unavailable: '요청 조건을 지원하기 어렵다는 합성 응답입니다. 다른 문의처나 일정 변경을 확인해 주세요.',
      unreachable: '연락이 닿지 않은 상황을 재현했습니다. 지원 가능 여부는 미확인이며 재문의나 다른 문의처가 필요합니다.',
    };
    entry.response = responses[action.outcome];
    if (action.kind === 'taxi') {
      entry.wheelchairConfirmed = action.outcome === 'available' && action.wheelchairConfirmed === true;
      entry.eligibilityConfirmed = action.outcome === 'available' && action.eligibilityConfirmed === true;
    }
    log(next, `${kindName(action.kind)} 합성 응답을 기록했어요`, entry.response);
    return next;
  }
  throw new Error('지원하지 않는 이동·동행 작업입니다.');
}

export function getVisitSupportSummary(state) {
  const support = supportOf(state), context = contextOf(state);
  const destinationKnown = Boolean(object(state.selectedHospital) && state.selectedHospital.companyName?.trim() && context.address);
  const unresolved = [], nextActions = [];
  let preparedCount = 0, totalNeeded = 0;
  let handoffs;
  const result = {};
  for (const kind of KINDS) {
    const entry = support[kind], needed = support.requirements[neededKey(kind)], name = kindName(kind);
    const labels = { not_selected: '문의처 선택 전', selected: '문의처 선택', prepared: '초안 준비 · 응답 전', available_demo: '가능 응답 · 시연', unavailable_demo: '불가 응답 · 시연', unreachable_demo: '불통 · 시연', needs_recheck: '조건 변경 · 재확인 필요' };
    const recovery = state.callRecovery?.targets[kind];
    const handoff = needed && entry.status !== 'needs_recheck' && recovery?.reason && recovery.recipientId === callRecipientId(state, kind)
      ? (handoffs ??= getCallRecoveryHandoffs(state)).find(item => item.target === kind) : null;
    const label = !needed ? '필요 없음' : handoff ? `${handoff.title} · 시연` : labels[entry.status];
    result[kind] = { status: needed ? entry.status : 'not_needed', label, providerName: entry.provider?.name || '', source: entry.provider ? { ...entry.provider.source } : null, questions: needed ? questionsFor(state, kind) : [], ready: false, unresolved: [] };
    if (!needed) continue;
    totalNeeded += 1;
    const gaps = [];
    if (!entry.provider) gaps.push(`${name} 문의처가 정해지지 않았습니다.`);
    else if (entry.status !== 'available_demo') gaps.push(`${name} ${label} 상태입니다.`);
    if (!context.area) gaps.push('출발 지역이 미확인입니다.');
    if (!validDate(context.date)) gaps.push('방문 날짜가 미확인입니다.');
    if (!context.appointmentTime) gaps.push('예약 시각이 미확인입니다.');
    if (!destinationKnown) gaps.push('방문기관·주소 확인이 필요합니다.');
    if (entry.provider && !entry.provider.phone) gaps.push(`${name} 대표 연락처가 미확인입니다.`);
    if (!context.inquiryAllowed) gaps.push('기관 문의 위임을 확인해야 합니다.');
    if (kind === 'taxi' && support.requirements.wheelchair && !entry.wheelchairConfirmed) gaps.push('휠체어 탑승 차량·지원 여부가 미확인입니다.');
    if (kind === 'taxi' && entry.provider?.serviceType === 'accessible_transport' && !entry.eligibilityConfirmed) gaps.push('교통약자 이동지원 이용자격·회원등록이 미확인입니다.');
    result[kind].unresolved = [...gaps];
    result[kind].ready = entry.status === 'available_demo' && gaps.length === 0;
    if (result[kind].ready) preparedCount += 1;
    else {
      unresolved.push(...gaps);
      const title = !entry.provider ? `${name} 문의처 선택` : ['unavailable_demo', 'unreachable_demo'].includes(entry.status) ? `${name} 재문의 또는 다른 문의처 확인` : entry.status === 'needs_recheck' ? `${name} 변경 조건으로 재문의` : entry.status === 'selected' ? `${name} 문의 초안 준비` : `${name} 빠진 조건 확인`;
      nextActions.push({ kind, title, reason: gaps.join(' ') });
    }
  }
  return { ...result, unresolved: [...new Set(unresolved)], nextActions, preparedCount, totalNeeded };
}

export function buildVisitSupportReport(state) {
  const support = supportOf(state), summary = getVisitSupportSummary(state), context = contextOf(state);
  const lines = ['## 이번 방문의 이동·동행 문의', '', '단일 방문의 준비 상태입니다. 합성 응답은 실제 예약·배차·동행인 배정이 아닙니다.', `방문일: ${md(context.date || '미확인')} / 예약 시각: ${md(context.appointmentTime || '미확인')}`, `조건을 확인한 합성 지원: ${summary.preparedCount}/${summary.totalNeeded}`, ''];
  for (const kind of KINDS) {
    const entry = support[kind], item = summary[kind];
    lines.push(`- ${kindName(kind)}: ${md(item.label)} · ${md(item.providerName || '문의처 미선택')}`);
    if (entry.provider) lines.push(`  - 대표 연락처: ${md(entry.provider.phone || '미확인')}`, `  - 출처: ${md(entry.provider.source.url)} · ${md(entry.provider.source.scope)} · 기준일 ${md(entry.provider.source.asOf || '미표기')} · 조회일 ${md(entry.provider.source.retrievedAt)}`);
    if (entry.response) lines.push(`  - 응답: ${md(entry.response)} (출처: 합성 응답 · 실제 발신 없음)`);
  }
  lines.push('', '추가 확인:', ...(summary.unresolved.length ? summary.unresolved.map(gap => `- ${md(gap)}`) : ['- 입력한 조건의 시연 확인을 마쳤습니다. 실제 예약·배차·비용은 확정하지 않았습니다.']));
  return lines.join('\n');
}

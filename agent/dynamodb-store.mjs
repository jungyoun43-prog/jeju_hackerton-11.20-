import { validateCallRecoveryState } from '../app/call-recovery.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { GetCommand, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createDemoCase, applyAction, getTasks, calculateBurden } from '../app/domain.js';
import { getVisitSupportSummary } from '../app/visit-support.js';
import { validateCareJourneyState, getCareJourneySummary } from '../app/care-journey.js';
import { AGENT_TOOLS } from './tools.mjs';
import hospitalData from '../app/data/hospital-candidates.json' with { type: 'json' };
import supportData from '../app/data/visit-support-providers.json' with { type: 'json' };
import { AgentError } from './errors.mjs';

const MAX_ITEM_BYTES = 192 * 1024;
const OPERATION_TIMEOUT_MS = 4000;
const SESSION_ID = /^[A-Za-z0-9_-]{43}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/;
const forbidden = /^(?:__proto__|constructor|prototype|messages?|history|reply|context|providerContext|encrypted_content|ciphertext|authorization|apiKey|OPENAI_API_KEY)$/i;
const credential = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const ownErrors = new WeakSet();
const storeError = (code, message, status) => { const error = new AgentError(code, message, status); ownErrors.add(error); return error; };
const unavailable = () => storeError('SESSION_STORE_UNAVAILABLE', '대화 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
const invalidState = () => storeError('SESSION_STATE_INVALID', '저장할 합성 준비 상태를 확인하지 못했습니다.', 503);
const expired = () => storeError('SESSION_EXPIRED', '대화 세션이 만료되었습니다. 새 대화를 시작해 주세요.', 404);
const busy = () => storeError('SESSION_BUSY', '앞선 요청을 처리 중입니다. 응답을 기다려 주세요.', 409);
const lost = () => storeError('SESSION_LEASE_LOST', '대화 처리 권한이 만료되었습니다. 다시 요청해 주세요.', 409);
const timeout = () => storeError('AGENT_TIMEOUT', '처리 시간이 길어 요청을 중단했습니다. 다시 시도해 주세요.', 504);
const conditional = error => error?.name === 'ConditionalCheckFailedException';
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function requireValue(value) { if (!value) throw invalidState(); }
function keys(value, allowed, required = allowed) {
  requireValue(plain(value) && Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)));
}
function oneOf(value, values) { requireValue(values.includes(value)); }
function string(value, max = 2000) { requireValue(typeof value === 'string' && value.length <= max); }
function timestamp(value) { requireValue(value === null || typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value))); }
function integer(value, min, max) { requireValue(Number.isSafeInteger(value) && value >= min && value <= max); }
function sessionKey(sessionId) {
  if (typeof sessionId !== 'string' || !SESSION_ID.test(sessionId)) throw storeError('INVALID_SESSION', '세션 식별자 형식을 확인해 주세요.', 400);
  return { pk: `session#${sessionId}` };
}

// JSON 모양만 통과시킨다. 원문·모델 context를 숨겨 넣는 추가 필드는 중첩 위치에서도 거절한다.
function jsonClone(value, depth = 0, count = { nodes: 0 }) {
  if (++count.nodes > 10000 || depth > 16) throw invalidState();
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') { requireValue(Number.isSafeInteger(value)); return value; }
  if (typeof value === 'string') {
    requireValue(value.length <= 20000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value) && !credential.test(value));
    return value;
  }
  if (Array.isArray(value)) { requireValue(value.length <= 200); return value.map(item => jsonClone(item, depth + 1, count)); }
  requireValue(plain(value));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => {
    requireValue(!forbidden.test(key));
    return [key, jsonClone(item, depth + 1, count)];
  }));
}

const areas = AGENT_TOOLS.find(tool => tool.name === 'update_visit').inputSchema.properties.area.enum;
const hospitalStates = hospitalData.records.map(hospital => applyAction(createDemoCase(), { type: 'SELECT_LOCAL_HOSPITAL', hospital }).selectedHospital);
const supportStates = new Map(supportData.providers.map(provider => {
  const state = createDemoCase(); state.patient.area = provider.region;
  return [provider.id, applyAction(state, { type: 'SUPPORT_SELECT_PROVIDER', kind: provider.kind, provider }).visitSupport[provider.kind].provider];
}));
const reportText = '[고정 합성 판독문 보유 예시] 최근 검사 자료의 파일이 있는 것으로 시연합니다. 실제 검사 결과·병변·치료 판단은 포함하지 않습니다. 의료진이 원본과 시행일을 확인해야 합니다.';
function normalizedState(value) {
  const baseline = createDemoCase(), state = jsonClone(value);
  keys(state, [...Object.keys(baseline), 'selectedHospital'], Object.keys(baseline).filter(key => !['careJourney','callRecovery'].includes(key)));
  if (state.careJourney !== undefined) validateCareJourneyState(state.careJourney);
  if (state.callRecovery !== undefined) validateCallRecoveryState(state.callRecovery);
  requireValue(state.version === 1);
  keys(state.patient, Object.keys(baseline.patient));
  for (const field of ['name', 'age', 'caregiver', 'existingHospital', 'purpose']) requireValue(state.patient[field] === baseline.patient[field]);
  oneOf(state.patient.area, areas);
  requireValue(/^\d{4}-\d{2}-\d{2}$/.test(state.patient.nextVisit) && new Date(`${state.patient.nextVisit}T00:00:00Z`).toISOString().slice(0, 10) === state.patient.nextVisit);
  if (state.selectedHospital !== undefined) requireValue(hospitalStates.some(hospital => isDeepStrictEqual(hospital, state.selectedHospital)));
  requireValue(state.patient.localHospital === (state.selectedHospital?.companyName ?? baseline.patient.localHospital));
  keys(state.permissions, ['inquiry', 'share']);
  requireValue(Object.values(state.permissions).every(item => typeof item === 'boolean'));
  requireValue(Array.isArray(state.documents) && state.documents.length === baseline.documents.length);
  for (const original of baseline.documents) {
    const documents = state.documents.filter(doc => doc.id === original.id);
    requireValue(documents.length === 1);
    const doc = documents[0]; keys(doc, ['id', 'label', 'status', 'source', 'content']);
    requireValue(doc.label === original.label); oneOf(doc.status, ['ready', 'missing', 'not_performed']);
    if (doc.status !== 'ready') requireValue(doc.source === '' && doc.content === '');
    else if (doc.id === 'history') requireValue(doc.source === original.source && doc.content === original.content);
    else requireValue(doc.id === 'report' && doc.content === reportText && doc.source === '서버 고정 합성 판독문 보유 예시 · 실제 진료기록 아님');
  }
  keys(state.inquiries, ['mainland', 'jeju']);
  for (const inquiry of Object.values(state.inquiries)) {
    keys(inquiry, ['status', 'response', 'requestedDocuments', 'transcript', 'at']);
    oneOf(inquiry.status, ['not_contacted', 'confirmed', 'unreachable', 'not_participating']); string(inquiry.response);
    requireValue(Array.isArray(inquiry.requestedDocuments) && inquiry.requestedDocuments.length <= 4 && inquiry.requestedDocuments.every(id => baseline.documents.some(doc => doc.id === id)));
    requireValue(Array.isArray(inquiry.transcript) && inquiry.transcript.length <= 8);
    for (const line of inquiry.transcript) { keys(line, ['speaker', 'text']); string(line.speaker, 100); string(line.text); }
    timestamp(inquiry.at);
  }
  keys(state.packet, ['status', 'submittedAt']); oneOf(state.packet.status, ['draft', 'submitted']); timestamp(state.packet.submittedAt);
  keys(state.review, ['status', 'outcome', 'note', 'source']);
  oneOf(state.review.status, ['not_requested', 'pending', 'needs_information', 'completed']);
  oneOf(state.review.outcome, [null, 'needs_information', 'local_followup', 'mainland_visit', 'local_transfer', 'shared_care', 'mainland_continues']); string(state.review.note, 10000); string(state.review.source, 300);
  keys(state.plan, Object.keys(baseline.plan)); calculateBurden(state.plan);
  keys(state.visitSupport, ['requirements', 'taxi', 'companion']);
  keys(state.visitSupport.requirements, Object.keys(baseline.visitSupport.requirements));
  for (const kind of ['taxi', 'companion']) {
    const entry = state.visitSupport[kind], required = Object.keys(baseline.visitSupport[kind]);
    keys(entry, [...required, 'inquiry', 'contextKey'], required);
    if (entry.provider !== null) {
      keys(entry.provider, ['id', 'kind', 'name', 'region', 'address', 'phone', 'serviceType', 'description', 'source']);
      keys(entry.provider.source, ['datasetId', 'url', 'hubUrl', 'scope', 'asOf', 'retrievedAt']);
      requireValue(isDeepStrictEqual(supportStates.get(entry.provider.id), entry.provider));
    }
  }
  requireValue(Array.isArray(state.events) && state.events.length <= 200);
  for (const event of state.events) {
    keys(event, ['id', 'at', 'title', 'detail', 'kind', 'source']);
    requireValue(/^event-\d+$/.test(event.id)); timestamp(event.at);
    for (const field of ['title', 'detail', 'kind', 'source']) string(event[field]);
  }
  // 현재 dispatcher와 같은 reducer의 불변 조건도 검사한다. 도메인 오류 원문은 공개하지 않는다.
  getTasks(state); getVisitSupportSummary(state); getCareJourneySummary(state);
  return state;
}

/**
 * 합성 사례 전용 DocumentClient 저장소. client의 자격증명·재시도/HTTP 설정은 호출자가 관리한다.
 * 확인: 2026-10-31, 공식 원문은 insane-search로 읽었다.
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.UpdateExpressions.html
 * https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/ttl-expired-items.html
 * https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
 */
export function createDynamoSessionStore({ client, tableName, region = 'ap-northeast-2', now = () => Date.now(), ttlSeconds = 3600, leaseSeconds = 65 } = {}) {
  if (typeof client?.send !== 'function' || typeof tableName !== 'string' || !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName)
    || typeof region !== 'string' || !/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(region) || typeof now !== 'function'
    || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 86400
    || !Number.isSafeInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > 300) throw unavailable();
  // store 인스턴스마다 독립한다. client를 공유해도 다른 실행의 token을 차용하지 않는다.
  const held = new Map();
  const seconds = () => {
    const time = now();
    if (!Number.isSafeInteger(time) || time < 0 || time > 8640000000000000) throw unavailable();
    return Math.floor(time / 1000);
  };
  async function send(command, { signal } = {}) {
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), OPERATION_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    let onAbort;
    try {
      if (combined.aborted) throw timeout();
      const aborted = new Promise((_, reject) => { onAbort = () => reject(signal?.aborted ? timeout() : unavailable()); combined.addEventListener('abort', onAbort, { once: true }); });
      return await Promise.race([Promise.resolve().then(() => client.send(command, { abortSignal: combined })), aborted]);
    } finally { clearTimeout(timer); if (onAbort) combined.removeEventListener('abort', onAbort); }
  }
  const safe = async operation => {
    try { return await operation(); } catch (error) { if (ownErrors.has(error)) throw error; throw unavailable(); }
  };
  function itemFor(item, expiresAt) {
    try {
      const key = sessionKey(item?.sessionId);
      integer(item.turns, 0, 40);
      requireValue(Array.isArray(item.requestIds) && item.requestIds.length <= 41 && item.requestIds.every(id => typeof id === 'string' && REQUEST_ID.test(id) && !credential.test(id)));
      const normalized = { ...key, sessionId: item.sessionId, state: normalizedState(item.state), turns: item.turns, requestIds: item.requestIds.slice(-40), expiresAt };
      requireValue(Buffer.byteLength(JSON.stringify(normalized), 'utf8') <= MAX_ITEM_BYTES);
      return normalized;
    } catch { throw invalidState(); }
  }
  function readItem(item, sessionId) {
    if (!item) throw expired();
    try {
      keys(item, ['pk', 'sessionId', 'state', 'turns', 'requestIds', 'expiresAt', 'leaseOwner', 'leaseUntil'], ['pk', 'sessionId', 'state', 'turns', 'requestIds', 'expiresAt']);
      integer(item.expiresAt, 0, Number.MAX_SAFE_INTEGER);
      requireValue(item.pk === `session#${sessionId}` && item.sessionId === sessionId);
      const normalized = itemFor(item, item.expiresAt);
      if (item.expiresAt <= seconds()) throw expired();
      const { pk, ...result } = normalized;
      return result;
    } catch (error) { if (ownErrors.has(error)) throw error; throw invalidState(); }
  }
  return {
    kind: 'dynamodb',
    async loadOrCreate(sessionId, options) {
      return safe(async () => {
        if (sessionId !== undefined && sessionId !== null) {
          const key = sessionKey(sessionId);
          const result = await send(new GetCommand({ TableName: tableName, Key: key, ConsistentRead: true }), options);
          return readItem(result?.Item, sessionId);
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          const id = randomBytes(32).toString('base64url');
          const item = itemFor({ sessionId: id, state: createDemoCase(), turns: 0, requestIds: [] }, seconds() + ttlSeconds);
          try {
            await send(new PutCommand({ TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(#pk)', ExpressionAttributeNames: { '#pk': 'pk' } }), options);
            const { pk, ...result } = item; return result;
          } catch (error) { if (!conditional(error)) throw error; }
        }
        throw unavailable();
      });
    },
    async acquire(sessionId, options) {
      return safe(async () => {
        const key = sessionKey(sessionId);
        if (held.has(sessionId)) throw busy();
        const time = seconds(), lock = { token: randomUUID(), until: time + leaseSeconds, ready: false };
        held.set(sessionId, lock);
        try {
          await send(new UpdateCommand({ TableName: tableName, Key: key,
            UpdateExpression: 'SET #owner = :owner, #lease = :lease',
            ConditionExpression: '#expires > :now AND (attribute_not_exists(#lease) OR #lease < :now)',
            ExpressionAttributeNames: { '#owner': 'leaseOwner', '#lease': 'leaseUntil', '#expires': 'expiresAt' },
            ExpressionAttributeValues: { ':owner': lock.token, ':lease': lock.until, ':now': time } }), options);
          lock.ready = true;
        } catch (error) { held.delete(sessionId); if (conditional(error)) throw busy(); throw error; }
      });
    },
    async release(sessionId, options) {
      return safe(async () => {
        const key = sessionKey(sessionId), lock = held.get(sessionId);
        if (!lock?.ready) return;
        try {
          await send(new UpdateCommand({ TableName: tableName, Key: key,
            UpdateExpression: 'REMOVE #owner, #lease', ConditionExpression: '#owner = :owner',
            ExpressionAttributeNames: { '#owner': 'leaseOwner', '#lease': 'leaseUntil' },
            ExpressionAttributeValues: { ':owner': lock.token } }), options);
        } catch (error) { if (!conditional(error)) throw error; }
        finally { if (held.get(sessionId) === lock) held.delete(sessionId); }
      });
    },
    async save(item, options) {
      return safe(async () => {
        sessionKey(item?.sessionId);
        const lock = held.get(item.sessionId), time = seconds();
        if (!lock?.ready || lock.until <= time) throw lost();
        const normalized = { ...itemFor(item, time + ttlSeconds), leaseOwner: lock.token, leaseUntil: lock.until };
        try {
          await send(new PutCommand({ TableName: tableName, Item: normalized,
            ConditionExpression: '#owner = :owner AND #lease > :now AND #expires > :now',
            ExpressionAttributeNames: { '#owner': 'leaseOwner', '#lease': 'leaseUntil', '#expires': 'expiresAt' },
            ExpressionAttributeValues: { ':owner': lock.token, ':now': time } }), options);
        } catch (error) { if (conditional(error)) throw lost(); throw error; }
      });
    },
    async consumeTurn(limit, options) {
      return safe(async () => {
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 80) throw unavailable();
        const time = seconds(), day = new Date(time * 1000).toISOString().slice(0, 10);
        const expiresAt = Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000) + 86400;
        try {
          await send(new UpdateCommand({ TableName: tableName, Key: { pk: `budget#${day}` },
            UpdateExpression: 'SET #expires = if_not_exists(#expires, :expires) ADD #used :one',
            ConditionExpression: 'attribute_not_exists(#used) OR (#used >= :zero AND #used < :limit)',
            ExpressionAttributeNames: { '#expires': 'expiresAt', '#used': 'used' },
            ExpressionAttributeValues: { ':expires': expiresAt, ':one': 1, ':zero': 0, ':limit': limit } }), options);
        } catch (error) {
          if (conditional(error)) throw storeError('DAILY_LIMIT', '오늘의 대화 시연 한도에 도달했습니다.', 429);
          throw error;
        }
      });
    },
  };
}

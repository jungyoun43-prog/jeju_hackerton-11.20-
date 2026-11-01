import { AgentError, assertKeys, fail, isObject } from './errors.mjs';
import { JOURNEY_SCENARIOS, CALL_RECOVERY_SCENARIOS } from '../app/care-journey.js';
import { normalizeCarePreferences } from '../app/care-preferences.js';
import { isProgressToken } from './progress.mjs';
import { isVisitToken, containsCredential } from './visit-recovery.mjs';

export const LIMITS = Object.freeze({ bodyBytes: 24576, messageChars: 4000, historyTurns: 8, historyChars: 2000, totalTextChars: 16000 });
const noControl = value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const validTime = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
export function readBody(input) {
  let serialized;
  try { serialized = typeof input === 'string' ? input : JSON.stringify(input); } catch { throw new AgentError('INVALID_JSON', '올바른 JSON 요청이 필요합니다.'); }
  fail(typeof serialized === 'string', 'INVALID_JSON', '올바른 JSON 요청이 필요합니다.');
  fail(Buffer.byteLength(serialized, 'utf8') <= LIMITS.bodyBytes, 'BODY_TOO_LARGE', '요청 내용이 너무 깁니다.', 413);
  try { return JSON.parse(serialized); } catch { throw new AgentError('INVALID_JSON', '올바른 JSON 요청이 필요합니다.'); }
}
export function validateRequestId(value) {
  fail(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/.test(value) && !containsCredential(value), 'INVALID_REQUEST_ID', '요청 식별자 형식을 확인해 주세요.');
  return value;
}
export function validateMessageRequest(body) {
  assertKeys(body, ['message', 'sessionId', 'history', 'requestId', 'preferences', 'applyPreferences', 'progressToken', 'visitToken', 'guidedPreparation']);
  const requestId = validateRequestId(body.requestId);
  fail(typeof body.message === 'string' && body.message.trim().length > 0 && body.message.length <= LIMITS.messageChars && noControl(body.message), 'INVALID_MESSAGE', '요청은 4,000자 이내의 텍스트로 입력해 주세요.');
  if (body.sessionId !== undefined) fail(typeof body.sessionId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.sessionId), 'INVALID_SESSION', '세션 식별자 형식을 확인해 주세요.');
  if (Object.hasOwn(body,'progressToken')) validateProgressToken(body.progressToken);
  if (Object.hasOwn(body,'visitToken')) validateVisitToken(body.visitToken);
  const history = body.history ?? [];
  fail(Array.isArray(history) && history.length <= LIMITS.historyTurns, 'INVALID_HISTORY', '대화 이력은 최근 8개까지 보낼 수 있습니다.');
  let chars = body.message.length;
  for (const turn of history) {
    assertKeys(turn, ['role', 'text'], '대화 이력');
    fail(['user', 'assistant'].includes(turn.role) && typeof turn.text === 'string' && turn.text.trim().length > 0 && turn.text.length <= LIMITS.historyChars && noControl(turn.text), 'INVALID_HISTORY', '대화 이력 형식을 확인해 주세요.');
    chars += turn.text.length;
  }
  for(const token of [body.visitToken,body.progressToken].filter(value=>typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value))) {
    fail(!requestId.includes(token) && !body.message.includes(token) && !history.some(turn=>turn.text.includes(token)),'INVALID_INPUT','전송용 식별자를 요청 본문이나 요청 ID에 포함할 수 없습니다.');
  }
  fail(chars <= LIMITS.totalTextChars, 'INVALID_HISTORY', '대화 이력이 너무 깁니다. 최근 대화만 보내 주세요.');
  let preferences;
  if (Object.hasOwn(body,'preferences')) {
    try { preferences = normalizeCarePreferences(body.preferences,{strict:true}); }
    catch { throw new AgentError('INVALID_PREFERENCES','공개 택시 문의처와 휠체어·동행 필요 여부를 확인해 주세요.'); }
  }
  if (Object.hasOwn(body,'applyPreferences')) fail(typeof body.applyPreferences === 'boolean' && (body.applyPreferences === false || preferences !== undefined), 'INVALID_PREFERENCES','기본 설정을 적용하려면 올바른 설정을 함께 보내 주세요.');
  if (Object.hasOwn(body,'guidedPreparation')) fail(typeof body.guidedPreparation === 'boolean','INVALID_GUIDED_PREPARATION','방문 준비 방식은 boolean 값이어야 합니다.');
  return {message:body.message.trim(),sessionId:body.sessionId,history,requestId,...(preferences ? {preferences} : {}),...(Object.hasOwn(body,'applyPreferences') ? {applyPreferences:body.applyPreferences} : {}),...(Object.hasOwn(body,'progressToken') ? {progressToken:body.progressToken} : {}),...(Object.hasOwn(body,'visitToken') ? {visitToken:body.visitToken} : {}),...(Object.hasOwn(body,'guidedPreparation') ? {guidedPreparation:body.guidedPreparation} : {})};
}
function validateVisitToken(value) {
  fail(isVisitToken(value),'INVALID_VISIT_TOKEN','준비 이어하기 식별자 형식을 확인해 주세요.');
  return value;
}
export function validateResumeRequest(body) {
  assertKeys(body,['visitToken']);
  return {visitToken:validateVisitToken(body.visitToken)};
}
function validateProgressToken(value) {
  fail(isProgressToken(value),'INVALID_PROGRESS_TOKEN','진행 조회 식별자 형식을 확인해 주세요.');
  return value;
}
export function validateProgressRequest(body) {
  assertKeys(body,['progressToken']);
  return {progressToken:validateProgressToken(body.progressToken)};
}
export function validatePreviewRequest(body) {
  assertKeys(body, ['scenarioId', 'requestId']);
  validateRequestId(body.requestId);
  fail(['aewol-parent-visit',...JOURNEY_SCENARIOS.map(item => item.id),...CALL_RECOVERY_SCENARIOS.map(item=>item.id)].includes(body.scenarioId), 'UNKNOWN_PREVIEW', '지원하는 고정 대화 예시를 선택해 주세요.');
  return body;
}

/** 모델이 보내는 인자에도 HTTP 입력과 별개로 스키마를 강제한다. */
export function validateSchema(value, schema, path = 'arguments') {
  const reject = () => { throw new AgentError('INVALID_TOOL_ARGUMENTS', '도구 인자의 항목·형식·허용 범위를 확인해 주세요.'); };
  if (schema.type === 'object') {
    if (!isObject(value)) reject();
    if (schema.additionalProperties === false && Object.keys(value).some(key => !Object.hasOwn(schema.properties ?? {}, key))) reject();
    if ((schema.required ?? []).some(key => !Object.hasOwn(value, key))) reject();
    if (schema.minProperties !== undefined && Object.keys(value).length < schema.minProperties) reject();
    for (const [key, item] of Object.entries(value)) if (schema.properties?.[key]) validateSchema(item, schema.properties[key], `${path}.${key}`);
  } else if (schema.type === 'array') {
    if (!Array.isArray(value) || value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 100) || !schema.items) reject();
    for (let index=0; index<value.length; index++) validateSchema(value[index],schema.items,`${path}[${index}]`);
    if (schema.uniqueItems && new Set(value.map(item=>JSON.stringify(item))).size!==value.length) reject();
  } else if (schema.type === 'string') {
    if (typeof value !== 'string' || !noControl(value) || value.length > (schema.maxLength ?? 1000) || value.length < (schema.minLength ?? 0)) reject();
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) reject();
    if (schema.format === 'date' && !validDate(value)) reject();
    if (schema.format === 'time' && !validTime(value)) reject();
  } else if (schema.type === 'boolean') { if (typeof value !== 'boolean') reject();
  } else if (schema.type === 'integer') { if (!Number.isSafeInteger(value) || value < (schema.minimum ?? 0) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) reject();
  } else reject();
  if (schema.enum && !schema.enum.includes(value)) reject();
  return value;
}

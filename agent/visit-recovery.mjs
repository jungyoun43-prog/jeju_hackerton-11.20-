import { createHash } from 'node:crypto';
import { AgentError, fail } from './errors.mjs';

export const MAX_REQUEST_RECEIPTS = 40;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/;
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export const containsCredential = value => /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value);
export const isVisitToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function visitSessionId(token) {
  fail(isVisitToken(token),'INVALID_VISIT_TOKEN','준비 이어하기 식별자 형식을 확인해 주세요.');
  return createHash('sha256').update('hondi-visit-v1\0').update(token).digest('base64url');
}

export function supportsVisitRecovery(store) {
  try { return Object.getOwnPropertyDescriptor(store,'visitRecovery')?.value === true; }
  catch { return false; }
}

export function requestFingerprint(request) {
  // HTTP 시도마다 달라지는 진행/세션/방문 토큰은 업무 내용의 지문에 넣지 않는다.
  return createHash('sha256').update(JSON.stringify({
    message:request.message,history:(request.history ?? []).map(turn=>({role:turn.role,text:turn.text})),
    preferences:request.preferences?{taxiProviderId:request.preferences.taxiProviderId,wheelchair:request.preferences.wheelchair,companionNeeded:request.preferences.companionNeeded}:null,
    applyPreferences:request.applyPreferences ?? false,
    ...(request.guidedPreparation===true?{guidedPreparation:true}:{}),
  })).digest('hex');
}

export function normalizeRequestReceipts(value,requestIds = []) {
  const invalid = () => { throw new TypeError('요청 처리 기록 형식을 확인해 주세요.'); };
  if (!Array.isArray(value) || value.length > MAX_REQUEST_RECEIPTS) invalid();
  const seen = new Set();
  return Array.from(value,receipt => {
    if (!plain(receipt) || Object.keys(receipt).length !== 4 || !['requestId','digest','status','at'].every(key=>Object.hasOwn(receipt,key))
      || typeof receipt.requestId !== 'string' || !REQUEST_ID.test(receipt.requestId) || containsCredential(receipt.requestId) || seen.has(receipt.requestId)
      || typeof receipt.digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.digest)
      || !['started','completed','failed'].includes(receipt.status)
      || !Number.isSafeInteger(receipt.at) || receipt.at < 0 || receipt.at > 8640000000000000
      || (receipt.status === 'completed') !== requestIds.includes(receipt.requestId)) invalid();
    seen.add(receipt.requestId);
    return {requestId:receipt.requestId,digest:receipt.digest,status:receipt.status,at:receipt.at};
  });
}

export function receiptStatus(receipt,now = Date.now()) {
  return receipt.status === 'completed' ? 'completed'
    : receipt.status === 'started' && receipt.at + 65000 > now ? 'running' : 'interrupted';
}
export function assertMatchingReceipt(receipt,digest,now) {
  if (!receipt) return;
  fail(receipt.digest === digest,'REQUEST_CONFLICT','같은 요청 식별자에 다른 내용이 들어왔습니다. 새 요청으로 보내 주세요.',409);
  if (receipt.status === 'completed') return;
  const running = receiptStatus(receipt,now) === 'running';
  throw new AgentError(running?'REQUEST_IN_PROGRESS':'REQUEST_INTERRUPTED',running
    ? '같은 요청의 처리 결과를 아직 확인 중입니다. 준비 이어하기에서 마지막 확인 상태를 불러와 주세요.'
    : '앞선 요청의 완료를 확인하지 못했습니다. 자동으로 다시 실행하지 않았습니다. 준비 이어하기에서 남은 일을 확인해 주세요.',409);
}
export function recoverySummary(session,now = Date.now()) {
  const receipts = session.requestReceipts ?? [], last = receipts.at(-1), completed = receipts.filter(item=>item.status === 'completed').at(-1);
  return {savedAt:completed?new Date(completed.at).toISOString():null,expiresAt:session.expiresAt,
    request:last?{requestId:last.requestId,status:receiptStatus(last,now)}:null};
}

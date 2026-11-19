import { randomBytes } from 'node:crypto';
import { createDemoCase } from '../app/domain.js';
import { AgentError, fail } from './errors.mjs';
import { isProgressKey, isProgressWriterId, normalizeProgressSnapshot, PROGRESS_TTL_SECONDS } from './progress.mjs';
import { normalizeRequestReceipts } from './visit-recovery.mjs';
import { createMemoryModelBudget } from './model-budget.mjs';

/**
 * 저장 허용 대상: 합성 준비 상태, requestId/고정 receipt, 횟수, TTL.
 * message/history/model 출력은 저장하지 않는다. 운영 저장소는 같은 인터페이스로 교체한다.
 * 이 메모리 한도는 인스턴스별이며 공개 유료 모델의 전역 quota를 대체하지 않는다.
 */
export function createMemorySessionStore({ now = () => Date.now(), ttlSeconds = 3600, maxSessions = 200, maxProgress = 200 } = {}) {
  const sessions = new Map(), budgets = new Map(), busy = new Set(), progress = new Map();
  const clone = value => structuredClone(value);
  const cleanup = () => {
    for (const [id, item] of sessions) if (item.expiresAt <= Math.floor(now() / 1000) && !busy.has(id)) sessions.delete(id);
    const today = new Date(now()).toISOString().slice(0, 10);
    for (const day of budgets.keys()) if (day !== today) budgets.delete(day);
  };
  return {
    ...createMemoryModelBudget({now}),
    kind: 'memory',
    visitRecovery: true,
    async loadOrCreate(sessionId,{initialSessionId} = {}) {
      cleanup();
      if (sessionId) {
        const item = sessions.get(sessionId);
        fail(item && item.expiresAt > Math.floor(now() / 1000), 'SESSION_EXPIRED', '대화 세션이 만료되었습니다. 새 대화를 시작해 주세요.', 404);
        return clone(item);
      }
      if(initialSessionId !== undefined) {
        fail(typeof initialSessionId === 'string' && /^[A-Za-z0-9_-]{43}$/.test(initialSessionId),'INVALID_SESSION','세션 식별자 형식을 확인해 주세요.');
        const existing=sessions.get(initialSessionId);
        if(existing) {
          fail(existing.expiresAt > Math.floor(now() / 1000),'SESSION_EXPIRED','대화 세션이 만료되었습니다. 새 대화를 시작해 주세요.',404);
          return clone(existing);
        }
      }
      fail(sessions.size < maxSessions, 'SESSION_LIMIT', '현재 대화가 많습니다. 잠시 후 다시 시도해 주세요.', 429);
      const item = { sessionId: initialSessionId ?? randomBytes(32).toString('base64url'), state: createDemoCase(), turns: 0, requestIds: [], expiresAt: Math.floor(now() / 1000) + ttlSeconds };
      sessions.set(item.sessionId, clone(item));
      return item;
    },
    async acquire(sessionId) {
      fail(!busy.has(sessionId), 'SESSION_BUSY', '앞선 요청을 처리 중입니다. 응답을 기다려 주세요.', 409);
      busy.add(sessionId);
    },
    async release(sessionId) { busy.delete(sessionId); },
    async save(item) {
      // 필드 allowlist로 원문·응답 저장을 방지한다. state는 검증된 도구만 수정한다.
      const requestIds=item.requestIds.slice(-40);
      sessions.set(item.sessionId, clone({sessionId:item.sessionId, state:item.state, turns:item.turns, requestIds,
        ...(item.requestReceipts !== undefined?{requestReceipts:normalizeRequestReceipts(item.requestReceipts,requestIds)}:{}),expiresAt:Math.floor(now() / 1000) + ttlSeconds}));
    },
    async consumeTurn(limit) {
      cleanup();
      const day = new Date(now()).toISOString().slice(0, 10), used = budgets.get(day) ?? 0;
      if (used >= limit) throw new AgentError('DAILY_LIMIT', '오늘의 대화 시연 한도에 도달했습니다.', 429);
      budgets.set(day, used + 1);
    },
    async writeProgress(key,value,{expiresAt,writerId,signal} = {}) {
      if(signal?.aborted)return false;
      const time=Math.floor(now()/1000),snapshot=normalizeProgressSnapshot(value);
      if(!isProgressKey(key) || !isProgressWriterId(writerId) || !Number.isSafeInteger(expiresAt) || expiresAt <= time || expiresAt > time + PROGRESS_TTL_SECONDS)throw new TypeError('진행 저장 형식을 확인해 주세요.');
      for(const [id,item] of progress)if(item.expiresAt <= time)progress.delete(id);
      const current=progress.get(key);
      if(current ? current.writerId !== writerId || current.expiresAt !== expiresAt || current.sequence >= snapshot.sequence : progress.size >= maxProgress)return false;
      progress.set(key,clone({pk:key,writerId,expiresAt,sequence:snapshot.sequence,progress:snapshot}));
      return true;
    },
    async readProgress(key,{signal} = {}) {
      if(!isProgressKey(key))throw new TypeError('진행 조회 형식을 확인해 주세요.');
      if(signal?.aborted)return null;
      const item=progress.get(key);
      if(!item)return null;
      if(item.expiresAt <= Math.floor(now()/1000)){progress.delete(key);return null;}
      return normalizeProgressSnapshot(item.progress);
    },
    // 검사 전용 읽기. 입력 원문·모델 답변이 남지 않는지 검증한다.
    inspect() { return clone([...sessions.values()]); },
    inspectProgress() {return clone([...progress.values()]);},
  };
}

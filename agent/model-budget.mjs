import { mkdir, lstat, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { AgentError } from './errors.mjs';

export const modelDailyLimit = () => new AgentError('MODEL_DAILY_LIMIT', '오늘의 AI 이용 한도에 도달했습니다. 저장된 준비 내용과 직접 선택 기능은 계속 이용할 수 있습니다.', 429);
const unavailable = () => new AgentError('MODEL_BUDGET_UNAVAILABLE', '이용 한도를 확인하지 못해 요청을 보내지 않았습니다. 잠시 후 다시 시도해 주세요.', 503);
const aborted = () => new AgentError('AGENT_TIMEOUT', '요청이 중단되어 추가 처리를 멈췄습니다.', 504);
export function validateModelCallLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 80) throw unavailable();
}

/** 검사에 명시적으로 주입하는 카운터. 실제 로컬 실행은 파일 저장소를 쓴다. */
export function createMemoryModelBudget({ now = Date.now } = {}) {
  let day = '', used = 0;
  return {
    async consumeModelCall(limit, { signal } = {}) {
      validateModelCallLimit(limit);
      if (signal?.aborted) throw aborted();
      const today = new Date(now()).toISOString().slice(0, 10);
      if (today !== day) { day = today; used = 0; }
      if (used >= limit) throw modelDailyLimit();
      used++;
    },
  };
}

/**
 * 외부 Responses 시도마다 빈 번호 파일을 원자적으로 선점한다.
 * O_EXCL로 프로세스·재시작 간 일일 한도를 공유하며, 실패·중단분은 환불하지 않는다.
 * 날짜/번호만 남기고 키·입력·응답·환자 정보는 저장하지 않는다.
 * 잠금 TTL이나 삭제로 횟수를 복구하지 않아 중간 종료로도 한도를 우회하지 못한다.
 */
export function createFileModelBudget({ directory = resolve('.runtime/openai-usage'), now = Date.now } = {}) {
  const root = resolve(directory);
  return {
    async consumeModelCall(limit, { signal } = {}) {
      validateModelCallLimit(limit);
      try {
        if (signal?.aborted) throw aborted();
        const folder = join(root, new Date(now()).toISOString().slice(0, 10));
        await mkdir(root, { recursive: true, mode: 0o700 });
        const rootStat = await lstat(root);
        if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw unavailable();
        await mkdir(folder, { recursive: true, mode: 0o700 });
        const folderStat = await lstat(folder);
        if (!folderStat.isDirectory() || folderStat.isSymbolicLink()) throw unavailable();
        for (let slot = 1; slot <= limit; slot++) {
          if (signal?.aborted) throw aborted();
          let ticket;
          try { ticket = await open(join(folder, `${String(slot).padStart(3, '0')}.call`), 'wx', 0o600); }
          catch (error) { if (error.code === 'EEXIST') continue; throw error; }
          await ticket.close();
          return;
        }
        throw modelDailyLimit();
      } catch (error) {
        if (error instanceof AgentError) throw error;
        throw unavailable();
      }
    },
  };
}

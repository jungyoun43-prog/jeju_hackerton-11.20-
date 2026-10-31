/** 공개 응답에는 정해진 오류 문구만 사용한다. SDK/입력 원문은 기록하지 않는다. */
export class AgentError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status; }
}
export const fail = (condition, code, message, status = 400) => {
  if (!condition) throw new AgentError(code, message, status);
};
export const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function assertKeys(value, keys, label = '요청') {
  fail(isObject(value) && Object.keys(value).every(key => keys.includes(key)), 'INVALID_INPUT', `${label} 형식을 확인해 주세요.`);
}
export function publicError(error) {
  return error instanceof AgentError ? error : new AgentError('AGENT_UNAVAILABLE', '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
}

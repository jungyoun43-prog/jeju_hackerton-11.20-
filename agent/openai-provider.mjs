import { createHash } from 'node:crypto';
import { AgentError, isObject } from './errors.mjs';

const ENDPOINT = 'https://api.openai.com/v1/responses';
const MODELS = new Set(['gpt-6.1-sol', 'gpt-6.1-terra']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_CALLS = 8;
const invalid = () => new AgentError('INVALID_MODEL_RESPONSE', '모델 응답 형식을 확인하지 못했습니다. 다시 시도해 주세요.', 502);
const contextError = () => new AgentError('INVALID_PROVIDER_CONTEXT', '대화 처리 상태를 확인하지 못했습니다. 새 요청으로 다시 시도해 주세요.', 502);
const timeoutError = () => new AgentError('AGENT_TIMEOUT', '처리 시간이 길어 요청을 중단했습니다. 다시 시도해 주세요.', 504);
const disconnected = () => new AgentError('MODEL_NOT_CONNECTED', '모델 API 키 또는 모델 접근 설정을 확인해 주세요.', 503);
const configurationError = () => new AgentError('MODEL_CONFIGURATION_INVALID', '모델 API 설정의 모델명·추론 수준·한도를 확인해 주세요.', 503);
const noControl = value => typeof value === 'string' && !/[\u0000-\u001f\u007f]/u.test(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('base64url');
function serialize(value, maxBytes = MAX_REQUEST_BYTES) {
  let result;
  try { result = JSON.stringify(value); } catch { throw invalid(); }
  if (typeof result !== 'string' || Buffer.byteLength(result, 'utf8') > maxBytes) throw invalid();
  return result;
}
function normalizeCallId(raw) {
  if (!noControl(raw) || raw.length < 1 || raw.length > 256) throw invalid();
  return /^[A-Za-z0-9_-]{1,100}$/.test(raw) ? raw : `openai_${digest(raw)}`;
}
function validateTools(tools) {
  if (!Array.isArray(tools) || tools.length > 32) throw configurationError();
  const names = new Set();
  const mapped = tools.map(tool => {
    if (!isObject(tool) || typeof tool.name !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(tool.name) || names.has(tool.name)
      || typeof tool.description !== 'string' || tool.description.length > 3000 || !isObject(tool.inputSchema)) throw configurationError();
    names.add(tool.name);
    serialize(tool.inputSchema, 65536);
    // 기존 optional 필드 의미를 보존한다. 세부 인자·권한 검증은 domain dispatcher가 수행한다.
    return {type:'function', name:tool.name, description:tool.description, parameters:tool.inputSchema, strict:false};
  });
  return {mapped, names};
}
function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length < 1 || messages.length > 40) throw contextError();
  for (const message of messages) if (!isObject(message) || !['user','assistant'].includes(message.role) || !Array.isArray(message.content) || message.content.length < 1 || message.content.length > 16) throw contextError();
}
function initialInput(messages) {
  return messages.map(message => {
    if (message.content.some(block => !isObject(block) || typeof block.text !== 'string' || Object.keys(block).length !== 1)) throw contextError();
    return {role:message.role, content:message.content.map(block => block.text).join('\n')};
  });
}
function continuationInput(messages, contextState) {
  const {cursor, prefixHash, assistantHash, pendingIds, callIds} = contextState;
  if (messages.length <= cursor || digest(messages.slice(0, cursor - 1)) !== prefixHash || digest(messages[cursor - 1]) !== assistantHash) throw contextError();
  const seen = new Set(), outputs = [];
  for (const message of messages.slice(cursor)) {
    if (message.role !== 'user') throw contextError();
    for (const block of message.content) {
      const result = block?.toolResult;
      if (!isObject(block) || Object.keys(block).length !== 1 || !isObject(result) || !pendingIds.has(result.toolUseId) || seen.has(result.toolUseId)
        || !['success','error'].includes(result.status) || !Array.isArray(result.content) || result.content.length < 1 || result.content.length > 12) throw contextError();
      for (const part of result.content) if (!isObject(part) || Object.keys(part).length !== 1 || (!Object.hasOwn(part,'json') && typeof part.text !== 'string')) throw contextError();
      seen.add(result.toolUseId);
      outputs.push({type:'function_call_output', call_id:callIds.get(result.toolUseId), output:serialize({status:result.status, content:result.content}, 131072)});
    }
  }
  if (seen.size !== pendingIds.size) throw contextError();
  return outputs;
}
async function withAbort(promise, signal) {
  if (signal.aborted) throw timeoutError();
  let onAbort;
  const interrupted = new Promise((_,reject) => { onAbort = () => reject(timeoutError()); signal.addEventListener('abort', onAbort, {once:true}); });
  try { return await Promise.race([promise,interrupted]); } finally { signal.removeEventListener('abort',onAbort); }
}
function cancelBody(response) {
  try { response?.body?.cancel()?.catch?.(() => {}); } catch { /* 응답·SDK 오류 원문을 기록하지 않는다. */ }
}
async function readBoundedJson(response, signal) {
  const length = response.headers?.get?.('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_RESPONSE_BYTES)) { cancelBody(response); throw invalid(); }
  const type = response.headers?.get?.('content-type');
  if (type && !/^application\/json(?:;|$)/i.test(type)) { cancelBody(response); throw invalid(); }
  if (!response.body?.getReader) throw invalid();
  const reader = response.body.getReader(), chunks = [];
  let size = 0, completed = false;
  try {
    while (true) {
      const {done,value} = await withAbort(reader.read(),signal);
      if (done) { completed = true; break; }
      if (!(value instanceof Uint8Array)) throw invalid();
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw invalid();
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks, size))); } catch { throw invalid(); }
  } finally {
    if (!completed) { try { reader.cancel().catch(() => {}); } catch { /* 취소 실패는 공개하지 않는다. */ } }
    try { reader.releaseLock(); } catch { /* 진행 중 read가 취소되면 자동 해제된다. */ }
  }
}
function normalizeOutput(response, toolNames, knownCallIds) {
  if (!isObject(response)) throw invalid();
  if (response.status === 'incomplete') throw new AgentError('MODEL_INCOMPLETE', '모델이 응답을 끝내지 못했습니다. 요청을 나누거나 출력 한도를 확인해 주세요.', 502);
  if (['failed','cancelled','queued','in_progress'].includes(response.status)) throw new AgentError('MODEL_UNAVAILABLE', '모델 API가 응답을 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
  if (response.status !== 'completed' || response.error || !Array.isArray(response.output) || response.output.length < 1 || response.output.length > 32) throw invalid();
  const texts = [], calls = [], callIds = new Map(knownCallIds), pendingIds = new Set();
  for (const item of response.output) {
    if (!isObject(item)) throw invalid();
    if (item.type === 'reasoning') {
      if (typeof item.id !== 'string' || item.id.length > 256 || !Array.isArray(item.summary) || item.summary.length > 100
        || (item.encrypted_content !== undefined && item.encrypted_content !== null && typeof item.encrypted_content !== 'string')) throw invalid();
      for (const part of item.summary) if (!isObject(part) || part.type !== 'summary_text' || typeof part.text !== 'string') throw invalid();
      // 원 reasoning item 전체는 응답 본문이 아닌 request-scoped context에만 보존한다.
      continue;
    }
    if (item.type === 'message') {
      if (item.role !== 'assistant' || (item.status !== undefined && item.status !== 'completed') || !Array.isArray(item.content) || item.content.length > 32) throw invalid();
      for (const part of item.content) {
        if (part?.type === 'refusal') throw new AgentError('MODEL_REFUSAL', '모델이 이 요청을 수행하지 못했습니다. 진료 준비 범위로 요청을 바꾸어 주세요.', 422);
        if (!isObject(part) || part.type !== 'output_text' || typeof part.text !== 'string') throw invalid();
        texts.push(part.text);
      }
      continue;
    }
    if (item.type === 'function_call') {
      if ((item.status !== undefined && item.status !== 'completed') || typeof item.name !== 'string' || !toolNames.has(item.name)
        || typeof item.arguments !== 'string' || Buffer.byteLength(item.arguments,'utf8') > 4096) throw invalid();
      const id = normalizeCallId(item.call_id);
      if (callIds.has(id) || pendingIds.has(id) || calls.length >= MAX_CALLS) throw invalid();
      let args; try { args = JSON.parse(item.arguments); } catch { throw invalid(); }
      if (!isObject(args)) throw invalid();
      callIds.set(id,item.call_id); pendingIds.add(id);
      calls.push({toolUse:{toolUseId:id,name:item.name,input:args}});
      continue;
    }
    throw invalid();
  }
  const text = texts.join('\n').trim();
  if (text.length > 6000 || (!calls.length && !text)) throw invalid();
  return {content:[...(text ? [{text}] : []),...calls],stopReason:calls.length ? 'tool_use' : 'end_turn',callIds,pendingIds};
}

/**
 * GPT-6.1 Sol/Terra는 Responses function calling을 사용한다.
 * 공식 자료: https://developers.openai.com/api/docs/guides/function-calling
 * https://developers.openai.com/api/docs/guides/migrate-to-responses
 * connected는 키/모델 설정 여부다. 인증·계정 접근의 성공 증거가 아니다.
 * context는 같은 turn에서만 넘기는 opaque handle이며 DB/HTTP/로그로 보내지 않는다.
 */
export function createOpenAIProvider({apiKey,model = 'gpt-6.1-sol',reasoningEffort = 'low',maxOutputTokens = 4096,timeoutMs = 40000,fetchImpl = globalThis.fetch} = {}) {
  if (!MODELS.has(model) || (!EFFORTS.has(reasoningEffort) && !(model === 'gpt-6.1-terra' && reasoningEffort === 'none'))
    || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 16384
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 45000 || typeof fetchImpl !== 'function') throw configurationError();
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (key.length > 4096 || (key && !/^[\x21-\x7e]+$/.test(key))) throw configurationError();
  let available = key.length > 0;
  // weak key는 요청 종료 후 raw reasoning·대화가 provider 전역에 남지 않게 한다.
  const contexts = new WeakMap();
  return {
    get connected() { return available; }, model,
    async respond({system,messages,tools,signal,context} = {}) {
      if (!available) throw disconnected();
      let timer;
      const deadline = new AbortController();
      try {
        if (typeof system !== 'string' || system.length > 20000) throw configurationError();
        validateMessages(messages);
        const validatedTools = validateTools(tools);
        let previous;
        if (context !== undefined) {
          if (!isObject(context) || !(previous = contexts.get(context))) throw contextError();
          if (previous.systemHash !== digest(system) || previous.toolsHash !== digest(validatedTools.mapped)) throw contextError();
        }
        const input = previous ? [...previous.input,...continuationInput(messages,previous)] : initialInput(messages);
        const body = serialize({model,instructions:system,input,tools:validatedTools.mapped,reasoning:{effort:reasoningEffort},max_output_tokens:maxOutputTokens,store:false,include:['reasoning.encrypted_content'],parallel_tool_calls:true});
        timer = setTimeout(() => deadline.abort(),timeoutMs);
        const combined = AbortSignal.any([deadline.signal,...(signal ? [signal] : [])]);
        if (combined.aborted) throw timeoutError();
        const response = await withAbort(Promise.resolve().then(() => fetchImpl(ENDPOINT,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body,signal:combined,redirect:'error',credentials:'omit',cache:'no-store'})),combined);
        if (!response || !Number.isInteger(response.status) || response.redirected) { cancelBody(response); throw invalid(); }
        if ([401,403,404].includes(response.status)) { available = false; cancelBody(response); throw disconnected(); }
        if (response.status === 429) { cancelBody(response); throw new AgentError('MODEL_RATE_LIMITED','모델 API 이용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.',429); }
        if (response.status < 200 || response.status >= 300) { cancelBody(response); throw new AgentError('MODEL_UNAVAILABLE','모델 API 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',503); }
        const raw = await readBoundedJson(response,combined);
        const normalized = normalizeOutput(raw,validatedTools.names,previous?.callIds ?? new Map());
        const nextContext = Object.freeze({cursor:messages.length + 1});
        const nextInput = [...input,...raw.output];
        serialize(nextInput);
        contexts.set(nextContext,{cursor:nextContext.cursor,input:nextInput,callIds:normalized.callIds,pendingIds:normalized.pendingIds,prefixHash:digest(messages),assistantHash:digest({role:'assistant',content:normalized.content}),systemHash:digest(system),toolsHash:digest(validatedTools.mapped)});
        return {content:normalized.content,stopReason:normalized.stopReason,context:nextContext};
      } catch (error) {
        if (error instanceof AgentError) throw error;
        if (deadline.signal.aborted || signal?.aborted || error?.name === 'AbortError' || error?.name === 'TimeoutError') throw timeoutError();
        // 네트워크 오류·응답·Authorization·키·provider context를 출력하지 않는다.
        throw new AgentError('MODEL_UNAVAILABLE','모델 API 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.',503);
      } finally { clearTimeout(timer); }
    },
  };
}

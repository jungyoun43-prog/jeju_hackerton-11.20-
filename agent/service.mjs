import { CAREGIVER_SYSTEM_PROMPT } from '../prompts/caregiver-system.mjs';
import { AGENT_TOOLS, createToolDispatcher, getPendingActions } from './tools.mjs';
import { createMemorySessionStore } from './store.mjs';
import { createDisconnectedProvider } from './providers.mjs';
import { AgentError, fail, isObject, publicError } from './errors.mjs';
import { readBody, validateMessageRequest, validatePreviewRequest } from './validation.mjs';
import { buildFixedPreview } from './preview.mjs';

const builtRevision = typeof __APP_REVISION__ === 'string' ? __APP_REVISION__ : 'development';
const positiveInteger = (value,fallback,max) => Number.isSafeInteger(Number(value)) && Number(value) > 0 && Number(value) <= max ? Number(value) : fallback;
const headers = Object.freeze({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
const response = (statusCode,body,revision) => ({statusCode,headers:{...headers,'x-app-revision':revision},body:JSON.stringify(body)});
const dedupe = items => [...new Map(items.map(item => [item.id,item])).values()].slice(0,12);

async function bounded(promise,signal) {
  if (signal.aborted) throw new AgentError('AGENT_TIMEOUT','처리 시간이 길어 요청을 중단했습니다. 다시 시도해 주세요.',504);
  let onAbort;
  const aborted = new Promise((_,reject) => { onAbort = () => reject(new AgentError('AGENT_TIMEOUT','처리 시간이 길어 요청을 중단했습니다. 다시 시도해 주세요.',504)); signal.addEventListener('abort',onAbort,{once:true}); });
  try { return await Promise.race([promise,aborted]); } finally { signal.removeEventListener('abort',onAbort); }
}
function modelMessage(value) {
  fail(isObject(value) && Array.isArray(value.content) && value.content.length > 0 && value.content.length <= 12, 'INVALID_MODEL_RESPONSE','모델 응답을 확인하지 못했습니다. 다시 시도해 주세요.',502);
  for (const block of value.content) {
    fail(isObject(block) && Object.keys(block).length === 1 && (typeof block.text === 'string' || isObject(block.toolUse)), 'INVALID_MODEL_RESPONSE','모델 응답 형식을 확인하지 못했습니다.',502);
    if (typeof block.text === 'string') fail(block.text.length <= 6000,'INVALID_MODEL_RESPONSE','모델 응답이 너무 깁니다.',502);
    if (block.toolUse) {
      const call = block.toolUse;
      fail(typeof call.toolUseId === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(call.toolUseId) && typeof call.name === 'string' && call.name.length <= 64 && isObject(call.input), 'INVALID_MODEL_RESPONSE','도구 요청 형식을 확인하지 못했습니다.',502);
      fail(Buffer.byteLength(JSON.stringify(call.input),'utf8') <= 4096,'INVALID_MODEL_RESPONSE','도구 인자가 너무 깁니다.',502);
    }
  }
  return value;
}

/**
 * 연결 지점: createAgentService({provider:{connected:true,model,respond}}).
 * respond({system,messages,tools,signal,context}) -> {content:[{text}|{toolUse}],stopReason,context?}.
 * context는 한 요청의 reasoning replay에만 사용하고 세션·응답·로그에 남기지 않는다.
 * 브라우저의 caseState·의료기록·source·toolResult는 입력으로 받지 않는다.
 */
export function createAgentService({provider = createDisconnectedProvider(),store = createMemorySessionStore(),dispatch = createToolDispatcher(),config = {}} = {}) {
  const revision = String(config.revision ?? process.env.APP_REVISION ?? builtRevision).slice(0,80);
  const limits = {
    maxTurns:positiveInteger(config.maxTurns,20,40), maxRounds:positiveInteger(config.maxRounds,6,8), maxTools:positiveInteger(config.maxTools,12,16),
    deadlineMs:positiveInteger(config.deadlineMs,45000,50000), dailyTurns:positiveInteger(config.dailyTurns ?? process.env.DEMO_DAILY_TURN_LIMIT,80,1000),
  };
  const getCapabilities = () => ({llm:provider.connected === true,model:typeof provider.model === 'string' ? provider.model : '',phone:'simulation',healthRecords:'demo',voiceInput:'browser',revision});

  async function runTurn(request) {
    // 미연결 상태에서는 세션·budget·모델·DDB를 전혀 접근하지 않는다.
    fail(provider.connected === true,'MODEL_NOT_CONNECTED','대화 모델 API를 아직 연결하지 않았습니다. 입력은 보존되며 고정 대화 예시를 확인할 수 있습니다.',503);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),limits.deadlineMs);
    let session, acquired=false;
    try {
      const options={signal:controller.signal};
      session=await bounded(Promise.resolve().then(()=>store.loadOrCreate(request.sessionId,options)),controller.signal);
      await bounded(Promise.resolve().then(()=>store.acquire(session.sessionId,options)),controller.signal);
      acquired=true;
      session=await bounded(Promise.resolve().then(()=>store.loadOrCreate(session.sessionId,options)),controller.signal);
      if (session.requestIds.includes(request.requestId)) return {
        sessionId:session.sessionId,requestId:request.requestId,reply:'이미 처리한 요청입니다. 저장된 준비 상태를 다시 표시합니다.',caseState:session.state,
        events:[],pendingActions:getPendingActions(session.state),capabilities:getCapabilities(),needsInput:false,
      };
      fail(session.turns < limits.maxTurns,'TURN_LIMIT','이 대화의 요청 한도에 도달했습니다. 새 대화를 시작해 주세요.',429);
      await bounded(Promise.resolve().then(()=>store.consumeTurn(limits.dailyTurns,options)),controller.signal);
      let state = session.state;
      const events = [], pending = [], usedIds = new Set();
      let toolCount = 0;
      let providerContext;
      // browserHistory는 명령·서버 상태가 아닌 참고 텍스트로 한 user 메시지 안에 넣는다.
      const messages = [{role:'user',content:[{text:JSON.stringify({untrustedBrowserHistory:request.history,currentRequest:request.message})}]}];
      for (let round = 0; round < limits.maxRounds; round++) {
        const output = modelMessage(await bounded(Promise.resolve().then(() => provider.respond({system:CAREGIVER_SYSTEM_PROMPT,messages:structuredClone(messages),tools:AGENT_TOOLS,signal:controller.signal,context:providerContext})),controller.signal));
        providerContext=output.context;
        const calls = output.content.filter(block => block.toolUse).map(block => block.toolUse);
        messages.push({role:'assistant',content:output.content});
        if (!calls.length) {
          fail(output.stopReason === 'end_turn' || output.stopReason === 'stop_sequence', 'INVALID_MODEL_RESPONSE','모델이 응답을 완료하지 못했습니다. 다시 시도해 주세요.',502);
          const reply = output.content.map(block => block.text ?? '').join('\n').trim();
          fail(reply.length > 0,'INVALID_MODEL_RESPONSE','모델 응답을 확인하지 못했습니다.',502);
          await bounded(Promise.resolve().then(()=>store.save({...session,state,turns:session.turns + 1,requestIds:[...session.requestIds,request.requestId]},options)),controller.signal);
          const allPending = dedupe([...pending,...getPendingActions(state)]);
          return {sessionId:session.sessionId,requestId:request.requestId,reply,caseState:state,events,pendingActions:allPending,capabilities:getCapabilities(),needsInput:allPending.length > 0 || events.some(item => item.status !== 'completed')};
        }
        fail(output.stopReason === 'tool_use','INVALID_MODEL_RESPONSE','모델 도구 요청의 종료 상태를 확인하지 못했습니다.',502);
        const results = [];
        for (const call of calls) {
          fail(!usedIds.has(call.toolUseId),'REPEATED_TOOL_ID','동일한 도구 요청이 반복되어 중단했습니다.',502);
          usedIds.add(call.toolUseId);
          toolCount++;
          fail(toolCount <= limits.maxTools,'TOOL_LIMIT','한 요청의 도구 실행 한도에 도달했습니다.',429);
          try {
            const result = await bounded(Promise.resolve().then(() => dispatch({name:call.name,input:call.input,state,userMessage:request.message,signal:controller.signal})),controller.signal);
            state = result.state;
            events.push(...result.events); pending.push(...result.pendingActions);
            results.push({toolResult:{toolUseId:call.toolUseId,status:'success',content:[{json:{...result.data,events:result.events,pendingActions:result.pendingActions}}]}});
          } catch (error) {
            if (controller.signal.aborted || error?.code === 'AGENT_TIMEOUT') throw error;
            const safe = error instanceof AgentError ? error : new AgentError('TOOL_REJECTED','현재 준비 상태에서 도구를 실행할 수 없습니다. 필요한 조건을 확인해 주세요.');
            events.push({id:`tool-error-${toolCount}`,tool:call.name,label:'도구 요청 확인 필요',status:'error',detail:safe.message,isSimulation:false});
            results.push({toolResult:{toolUseId:call.toolUseId,status:'error',content:[{json:{error:{code:safe.code,message:safe.message}}}]}});
          }
        }
        messages.push({role:'user',content:results});
      }
      throw new AgentError('LOOP_LIMIT','대화 처리 단계가 많아 중단했습니다. 요청 범위를 나누어 다시 시도해 주세요.',429);
    } finally {
      clearTimeout(timer);
      controller.abort();
      if(acquired) {
        const cleanup=AbortSignal.timeout(2500);
        // 저장 결과는 유지하고, 정리 실패 시 만료 lease로 회복한다. 원문·SDK 오류는 기록하지 않는다.
        try {await bounded(Promise.resolve().then(()=>store.release(session.sessionId,{signal:cleanup})),cleanup);}
        catch { /* 영속 lease는 Lambda 수명보다 긴 65초 후 다시 획득할 수 있다. */ }
      }
    }
  }

  async function handleAgentRequest({method = 'GET',path = '/',body,headers:requestHeaders = {}} = {}) {
    let requestId = '';
    try {
      const route = path.split('?')[0];
      if (route === '/api/agent/capabilities' && method === 'GET') return response(200,getCapabilities(),revision);
      fail(['/api/agent','/api/agent/preview','/api/agent/capabilities'].includes(route),'NOT_FOUND','요청한 API가 없습니다.',404);
      fail(method === 'POST' && route !== '/api/agent/capabilities','METHOD_NOT_ALLOWED','지원하지 않는 요청 방식입니다.',405);
      const contentType = Object.entries(requestHeaders).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
      fail(contentType === undefined || /^application\/json(?:;|$)/i.test(String(contentType)),'UNSUPPORTED_MEDIA_TYPE','JSON 형식의 요청이 필요합니다.',415);
      const parsed = readBody(body);
      if (typeof parsed?.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/.test(parsed.requestId)) requestId = parsed.requestId;
      if (route === '/api/agent/preview') {
        const request = validatePreviewRequest(parsed);
        return response(200,await buildFixedPreview({capabilities:getCapabilities(),requestId:request.requestId}),revision);
      }
      const request = validateMessageRequest(parsed);
      return response(200,await runTurn(request),revision);
    } catch (error) {
      const safe = publicError(error);
      return response(safe.status,{error:{code:safe.code,message:safe.message},requestId},revision);
    }
  }
  return {handleAgentRequest,getCapabilities,runTurn};
}

import { CAREGIVER_SYSTEM_PROMPT } from '../prompts/caregiver-system.mjs';
import { AGENT_TOOLS, createToolDispatcher, getPendingActions, getGuidedPreparationKinds, getGuidedPreparationChanges } from './tools.mjs';
import { createMemorySessionStore } from './store.mjs';
import { createDisconnectedProvider } from './providers.mjs';
import { AgentError, fail, isObject, publicError } from './errors.mjs';
import { readBody, validateMessageRequest, validatePreviewRequest, validateProgressRequest, validateResumeRequest } from './validation.mjs';
import { buildFixedPreview } from './preview.mjs';
import { applyAction } from '../app/domain.js';
import { getPreparationWorkflow } from '../app/preparation-workflow.js';
import { createProgressReporter, readProgress, supportsProgress } from './progress.mjs';
import { visitSessionId, supportsVisitRecovery, requestFingerprint, assertMatchingReceipt, recoverySummary, MAX_REQUEST_RECEIPTS, containsCredential } from './visit-recovery.mjs';

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
 * respond({system,messages,tools,signal,context,toolChoice:'auto'|'none'}) -> {content:[{text}|{toolUse}],stopReason,context?}.
 * context는 한 요청의 reasoning replay에만 사용하고 세션·응답·로그에 남기지 않는다.
 * 브라우저의 caseState·의료기록·source·toolResult는 입력으로 받지 않는다.
 */
export function createAgentService({provider = createDisconnectedProvider(),store = createMemorySessionStore(),dispatch = createToolDispatcher(),config = {},progressReadOnly = false,now = Date.now} = {}) {
  const revision = String(config.revision ?? process.env.APP_REVISION ?? builtRevision).slice(0,80);
  const limits = {
    maxTurns:positiveInteger(config.maxTurns,20,40), maxRounds:positiveInteger(config.maxRounds,6,8), maxTools:positiveInteger(config.maxTools,12,16),
    deadlineMs:positiveInteger(config.deadlineMs,45000,45000), dailyTurns:positiveInteger(config.dailyTurns ?? process.env.DEMO_DAILY_TURN_LIMIT,80,80),
  };
  const progressAvailable = () => (provider.connected === true || progressReadOnly === true) && supportsProgress(store);
  const capabilities = progress => ({llm:provider.connected === true,model:typeof provider.model === 'string' ? provider.model : '',phone:'simulation',healthRecords:'demo',voiceInput:'browser',progress,visitRecovery:supportsVisitRecovery(store)?'token':'unavailable',revision});
  const getCapabilities = () => capabilities(progressAvailable()?'poll':'unavailable');

  async function runTurn(request) {
    // 미연결 상태에서는 세션·budget·모델·DDB를 전혀 접근하지 않는다.
    fail(provider.connected === true,'MODEL_NOT_CONNECTED','대화 모델 API를 아직 연결하지 않았습니다. 입력은 보존되며 고정 대화 예시를 확인할 수 있습니다.',503);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(),limits.deadlineMs);
    const progress = createProgressReporter({store,token:request.progressToken});
    let session, acquired=false,receiptStarted=false,completionAttempted=false,completed=false;
    try {
      const options={signal:controller.signal};
      const initialSessionId=request.visitToken?visitSessionId(request.visitToken):undefined;
      if(initialSessionId) {
        fail(supportsVisitRecovery(store),'VISIT_RECOVERY_UNAVAILABLE','준비 이어하기를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',503);
        fail(!request.sessionId || request.sessionId === initialSessionId,'INVALID_SESSION','이 방문의 세션 식별자를 확인해 주세요.');
      }
      const digest=requestFingerprint(request);
      session=await bounded(Promise.resolve().then(()=>store.loadOrCreate(request.sessionId,{...options,...(initialSessionId?{initialSessionId}:{})})),controller.signal);
      assertMatchingReceipt(session.requestReceipts?.find(item=>item.requestId === request.requestId),digest,now());
      if(!session.requestIds.includes(request.requestId)) {
        await bounded(Promise.resolve().then(()=>store.acquire(session.sessionId,options)),controller.signal);
        acquired=true;
        session=await bounded(Promise.resolve().then(()=>store.loadOrCreate(session.sessionId,options)),controller.signal);
        assertMatchingReceipt(session.requestReceipts?.find(item=>item.requestId === request.requestId),digest,now());
      }
      if (session.requestIds.includes(request.requestId)) {
        const pendingActions=getPendingActions(session.state),needsInput=pendingActions.length > 0;
        progress.completed();
        await progress.flush({signal:controller.signal});
        return {
          sessionId:session.sessionId,requestId:request.requestId,reply:'이미 처리한 요청입니다. 저장된 준비 상태를 다시 표시합니다.',caseState:session.state,
          events:[],pendingActions,capabilities:getCapabilities(),needsInput,
        };
      }
      fail(session.turns < limits.maxTurns,'TURN_LIMIT','이 대화의 요청 한도에 도달했습니다. 새 대화를 시작해 주세요.',429);
      fail((session.requestReceipts?.length ?? 0) < MAX_REQUEST_RECEIPTS,'REQUEST_LIMIT','이 방문의 요청 처리 기록 한도에 도달했습니다. 새 대화를 시작해 주세요.',429);
      session={...session,requestReceipts:[...(session.requestReceipts ?? []),{requestId:request.requestId,digest,status:'started',at:now()}]};
      await bounded(Promise.resolve().then(()=>store.save(session,options)),controller.signal);
      receiptStarted=true;
      await bounded(Promise.resolve().then(()=>store.consumeTurn(limits.dailyTurns,options)),controller.signal);
      let state = session.state;
      const events = [], pending = [], usedIds = new Set();
      let toolCount = 0;
      let providerContext;
      const attemptedDrafts=new Set(),blockedDrafts=new Set(),appliedConditions=new Set();
      let contextRejected=false;
      const execute=async(name,input)=>{
        toolCount++;
        if(name==='prepare_inquiries')attemptedDrafts.add(input.kind);
        progress.started(name,input);
        try {
          const result=await bounded(Promise.resolve().then(()=>dispatch({name,input,state,userMessage:request.message,preferences:request.preferences,requestId:request.requestId,signal:controller.signal})),controller.signal);
          state=result.state;events.push(...result.events);pending.push(...result.pendingActions);
          if(result.events.every(item=>item.status==='completed')){
            if(name==='update_visit')for(const field of Object.keys(input))appliedConditions.add(field);
            if(name==='select_hospital_contact')appliedConditions.add('hospital');
          }
          if(['update_visit','select_hospital_contact'].includes(name)&&result.events.some(item=>item.status!=='completed'))contextRejected=true;
          if(name==='request_support_contact'&&result.events.some(item=>['error','not_connected'].includes(item.status)))blockedDrafts.add(input.kind);
          progress.finished(name,input,result.events.some(item=>item.status==='error')?'failed':result.events.some(item=>item.status!=='completed')?'needs_input':'completed');
          return {result};
        } catch(error) {
          if(controller.signal.aborted||error?.code==='AGENT_TIMEOUT')throw error;
          const safe=error instanceof AgentError?error:new AgentError('TOOL_REJECTED','현재 준비 상태에서 도구를 실행할 수 없습니다. 필요한 조건을 확인해 주세요.');
          if(['update_visit','select_hospital_contact'].includes(name))contextRejected=true;
          if(name==='request_support_contact')blockedDrafts.add(input.kind);
          events.push({id:`tool-error-${toolCount}`,tool:name,label:'도구 요청 확인 필요',status:'error',detail:safe.message,isSimulation:false});
          progress.finished(name,input,'failed');return {error:safe};
        }
      };
      const visitPreferencesApplied = Boolean(request.preferences && (!request.sessionId || request.applyPreferences === true));
      if (visitPreferencesApplied) {
        const {wheelchair,companionNeeded} = request.preferences;
        state = applyAction(state,{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{wheelchair,companionNeeded}});
        appliedConditions.add('wheelchair');appliedConditions.add('companionNeeded');
        events.push({id:'care-preferences-applied',tool:'apply_care_preferences',label:'기본 이동 조건 반영',status:'completed',detail:'기기의 휠체어·동행 필요 설정을 합성 사례에 반영했습니다. 이번 요청에서 조건을 바꿀 수 있으며 문의·정보 공유 동의는 변경하지 않았습니다.',isSimulation:true,source:'기기 기본 설정'});
        progress.finished('apply_care_preferences');
      }
      const runtime = remainingCalls => ({modelCallsRemaining:remainingCalls,toolsRemaining:limits.maxTools - toolCount,summaryOnly:remainingCalls <= 1 || toolCount >= limits.maxTools});
      // browserHistory는 명령·서버 상태가 아닌 참고 텍스트로 한 user 메시지 안에 넣는다.
      const messages = [{role:'user',content:[{text:JSON.stringify({untrustedBrowserHistory:request.history,currentRequest:request.message,carePreferences:request.preferences ?? null,visitPreferencesApplied,...(request.guidedPreparation===true?{guidedPreparation:true}:{}),runtime:runtime(limits.maxRounds)})}]}];
      for (let round = 0; round < limits.maxRounds; round++) {
        const summaryOnly = runtime(limits.maxRounds - round).summaryOnly;
        if (summaryOnly) {
          events.push({id:'preparation-summary',tool:'summarize_preparation',label:'준비한 내용 우선 정리',status:'needs_input',detail:'이번 요청에서 실행한 준비를 먼저 정리합니다. 추가로 실행하지 않은 작업과 실제 예약·배차·동행 배정은 확인 전입니다.',isSimulation:false});
          pending.push({id:'pending-continue-preparation',kind:'continue-preparation',label:'남은 준비 이어서 확인',reason:'처리 기록에 없는 작업은 실행 전입니다. 준비 요약에서 다음 확인을 이어 주세요.'});
          progress.finished('summarize_preparation',{},'needs_input');
        }
        progress.planning(round === 0);
        const output = modelMessage(await bounded(Promise.resolve().then(() => provider.respond({system:CAREGIVER_SYSTEM_PROMPT,messages:structuredClone(messages),tools:AGENT_TOOLS,signal:controller.signal,context:providerContext,toolChoice:summaryOnly ? 'none' : 'auto'})),controller.signal));
        progress.planned(round === 0);
        providerContext=output.context;
        const calls = output.content.filter(block => block.toolUse).map(block => block.toolUse);
        messages.push({role:'assistant',content:output.content});
        if (!calls.length) {
          fail(output.stopReason === 'end_turn' || output.stopReason === 'stop_sequence', 'INVALID_MODEL_RESPONSE','모델이 응답을 완료하지 못했습니다. 다시 시도해 주세요.',502);
          let reply = output.content.map(block => block.text ?? '').join('\n').trim();
          fail(reply.length > 0,'INVALID_MODEL_RESPONSE','모델 응답을 확인하지 못했습니다.',502);
          if (summaryOnly) reply += '\n\n이번 요청에서 처리 기록에 남긴 준비까지만 반영했습니다. 실행 전인 작업은 다음 확인으로 남겨두었습니다.';
          const scope=request.guidedPreparation===true?getGuidedPreparationKinds(request.message,state):[];
          if(scope.length){
            const prepared=[];
            let interrupted=false;
            let stopped='안전하게 추가할 새 초안이 없어 기존 준비·응답·인계 상태를 유지했습니다.';
            const candidates=getPreparationWorkflow(state).nextAutomaticActions.filter(action=>scope.includes(action.input.kind)&&!attemptedDrafts.has(action.input.kind)&&!blockedDrafts.has(action.input.kind)).slice(0,2);
            if(contextRejected||getGuidedPreparationChanges(request.message,state).some(field=>!appliedConditions.has(field)))stopped='방문 조건 또는 문의 기관 변경을 반영하지 못해 자동 초안을 추가하지 않았습니다.';
            else for(const action of candidates){
              if(toolCount>=limits.maxTools){stopped='이번 요청의 도구 한도에 도달해 남은 초안은 추가하지 않았습니다.';interrupted=true;break;}
              const outcome=await execute(action.name,action.input);
              if(outcome.error||outcome.result.events.some(item=>['error','not_connected'].includes(item.status))){stopped='일부 초안을 준비하지 못해 해당 대상은 멈췄습니다. 처리 기록과 남은 조건을 확인해 주세요.';interrupted=true;continue;}
              if(state.visitSupport[action.input.kind].status==='prepared')prepared.push(action.input.kind==='taxi'?'이동':'동행');
            }
            const workflow=getPreparationWorkflow(state);
            reply+=`\n\n추가 준비 확인: ${prepared.length?`${prepared.join('·')} 문의 초안을 기존 도구로 준비했습니다.${interrupted?` ${stopped}`:''}`:stopped} ${workflow.currentTask?`남은 일: ${workflow.currentTask.title}. ${workflow.currentTask.detail}`:workflow.summary.label} 실제 전화·예약·배차·자료 조회나 전송은 수행하지 않았습니다.`;
          }
          completionAttempted=true;
          await bounded(Promise.resolve().then(()=>store.save({...session,state,turns:session.turns + 1,requestIds:[...session.requestIds,request.requestId],
            requestReceipts:session.requestReceipts.map(item=>item.requestId === request.requestId?{...item,status:'completed',at:now()}:item)},options)),controller.signal);
          completed=true;
          const allPending = dedupe([...pending,...getPendingActions(state)]);
          const needsInput = allPending.length > 0 || events.some(item => item.status !== 'completed');
          progress.completed(needsInput);
          await progress.flush({signal:controller.signal});
          return {sessionId:session.sessionId,requestId:request.requestId,reply,caseState:state,events,pendingActions:allPending,capabilities:getCapabilities(),needsInput};
        }
        fail(!summaryOnly,'INVALID_MODEL_RESPONSE','준비 요약에서 추가 도구 요청이 발생해 중단했습니다. 다시 시도해 주세요.',502);
        fail(output.stopReason === 'tool_use','INVALID_MODEL_RESPONSE','모델 도구 요청의 종료 상태를 확인하지 못했습니다.',502);
        const results = [];
        for (const call of calls) {
          fail(!usedIds.has(call.toolUseId),'REPEATED_TOOL_ID','동일한 도구 요청이 반복되어 중단했습니다.',502);
          usedIds.add(call.toolUseId);
          if (toolCount >= limits.maxTools) {
            events.push({id:`tool-deferred-${call.toolUseId}`,tool:call.name,label:'다음 준비로 남김',status:'needs_input',detail:'이번 요청에서는 추가 실행하지 않았습니다. 앞서 준비한 내용은 보존하고 남은 작업으로 안내합니다.',isSimulation:false});
            results.push({toolResult:{toolUseId:call.toolUseId,status:'error',content:[{json:{error:{code:'TOOL_LIMIT',message:'추가 도구는 실행하지 않았습니다. 완료한 준비와 실행 전인 작업을 정리해 주세요.'}}}]}});
            progress.finished(call.name,call.input,'needs_input');
            continue;
          }
          const outcome=await execute(call.name,call.input);
          if(outcome.result)results.push({toolResult:{toolUseId:call.toolUseId,status:'success',content:[{json:{...outcome.result.data,events:outcome.result.events,pendingActions:outcome.result.pendingActions}}]}});
          else results.push({toolResult:{toolUseId:call.toolUseId,status:'error',content:[{json:{error:{code:outcome.error.code,message:outcome.error.message}}}]}});
        }
        for (const result of results) result.toolResult.content[0].json.runtime = runtime(limits.maxRounds - round - 1);
        messages.push({role:'user',content:results});
      }
      throw new AgentError('LOOP_LIMIT','대화 처리 단계가 많아 중단했습니다. 요청 범위를 나누어 다시 시도해 주세요.',429);
    } catch(error) {
      progress.failed();
      await progress.flush({signal:controller.signal});
      throw error;
    } finally {
      clearTimeout(timer);
      controller.abort();
      if(acquired) {
        const cleanup=AbortSignal.timeout(2500);
        // 최종 저장의 ack가 유실됐을 수 있으므로 완료 시도 뒤에는 이전 상태로 덮지 않는다.
        if(receiptStarted && !completionAttempted && !completed) {
          try {await bounded(Promise.resolve().then(()=>store.save({...session,requestReceipts:session.requestReceipts.map(item=>item.requestId === request.requestId?{...item,status:'failed',at:now()}:item)},{signal:cleanup})),cleanup);}
          catch { /* started 기록은 lease 시간 뒤 중단 상태로 읽고 자동 재실행하지 않는다. */ }
        }
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
      fail(['/api/agent','/api/agent/preview','/api/agent/capabilities','/api/agent/progress','/api/agent/resume'].includes(route),'NOT_FOUND','요청한 API가 없습니다.',404);
      fail(method === 'POST' && route !== '/api/agent/capabilities','METHOD_NOT_ALLOWED','지원하지 않는 요청 방식입니다.',405);
      const contentType = Object.entries(requestHeaders).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
      fail(contentType === undefined || /^application\/json(?:;|$)/i.test(String(contentType)),'UNSUPPORTED_MEDIA_TYPE','JSON 형식의 요청이 필요합니다.',415);
      const parsed = readBody(body);
      if(route === '/api/agent/resume') {
        const request=validateResumeRequest(parsed);
        fail(supportsVisitRecovery(store),'VISIT_RECOVERY_UNAVAILABLE','준비 이어하기를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.',503);
        const session=await store.loadOrCreate(visitSessionId(request.visitToken));
        return response(200,{sessionId:session.sessionId,caseState:session.state,pendingActions:getPendingActions(session.state),recovery:recoverySummary(session,now())},revision);
      }
      if(route === '/api/agent/progress') {
        const request = validateProgressRequest(parsed);
        return response(200,progressAvailable()?await readProgress(store,request.progressToken):{available:false,progress:null},revision);
      }
      if (typeof parsed?.requestId === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{11,79}$/.test(parsed.requestId) && !containsCredential(parsed.requestId)
        && ![parsed.visitToken,parsed.progressToken].some(token=>typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) && parsed.requestId.includes(token))) requestId = parsed.requestId;
      if (route === '/api/agent/preview') {
        const request = validatePreviewRequest(parsed);
        return response(200,await buildFixedPreview({capabilities:capabilities('unavailable'),requestId:request.requestId,scenarioId:request.scenarioId}),revision);
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

import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { AGENT_EVAL_CASES,evaluateTaskResult } from './agent-eval-cases.mjs';
import { openAISettings } from '../agent/config.mjs';
import { createOpenAIProvider } from '../agent/openai-provider.mjs';
import { createAgentService } from '../agent/service.mjs';
import { createToolDispatcher } from '../agent/tools.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { createDemoCase } from '../app/domain.js';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const help='키/네트워크 없는 목록: npm run eval:agent -- --list\n실제 합성 과업: npm run eval:agent -- --live [--case id,id] [--output name.json]\n공개 데모: npm run eval:agent -- --live --public [--case id,id]\n--live 없이는 모델을 호출하지 않습니다. 실제 전화/개인기록/예약은 수행하지 않습니다.';
const secretPattern=/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/;
const safeText=value=>secretPattern.test(String(value))?'[보호된 값 생략]':String(value);

export function parseEvaluationArgs(args) {
  const result={live:false,public:false,caseIds:[],output:'agent-evaluation.json'};
  const seen=new Set();
  for(let i=0;i<args.length;i++) {
    const arg=args[i];if(seen.has(arg))throw new Error('중복 옵션입니다.');seen.add(arg);
    if(arg==='--live')result.live=true;
    else if(arg==='--public')result.public=true;
    else if(arg==='--list'||arg==='--help')result.list=true;
    else if(arg==='--case') {const value=args[++i];if(!value)throw new Error('case ID가 필요합니다.');result.caseIds=value.split(',');}
    else if(arg==='--output') {const value=args[++i];if(!value || !/^[a-z0-9][a-z0-9_-]{0,90}\.json$/.test(value))throw new Error('출력 파일명은 영문·숫자 JSON 이름만 허용합니다.');result.output=value;}
    else throw new Error('알 수 없는 옵션입니다.');
  }
  if(result.caseIds.some(id=>!AGENT_EVAL_CASES.some(item=>item.id===id)) || new Set(result.caseIds).size!==result.caseIds.length)throw new Error('알 수 없거나 중복된 case ID입니다.');
  return result;
}

export function publicEvaluationContext(capability,publicRevision,expectedRevision) {
  if(capability?.llm!==true || capability.phone!=='simulation' || capability.healthRecords!=='demo') throw new Error('공개 API의 모델 연결과 전화·기록 시연 범위를 확인하지 못했습니다.');
  if(!publicRevision || publicRevision!==expectedRevision) throw new Error('공개 API가 평가한 현재 커밋과 다릅니다. 배포를 확인해 주세요.');
  return {publicRevision,recoveryAvailable:capability.visitRecovery==='token',modelIdentity:'not-verified-by-public-api'};
}

export async function runAgentEvaluation(options) {
  if(!options.live || options.list)return {mode:'list',cases:AGENT_EVAL_CASES.map(({id,flow,message})=>({id,flow,message})),help};
  const selected=AGENT_EVAL_CASES.filter(task=>!options.caseIds.length || options.caseIds.includes(task.id));
  const sourceHash=await runtimeFingerprint(root),flows=new Map(),trace=[];
  let nativeModelRequests=0;
  const report={checkedAt:new Date().toISOString(),result:'fail',mode:options.public?'public-model':'local-model',sourceHash,definitionHash:createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).update(await readFile(resolve(root,'scripts/agent-eval-cases.mjs'))).digest('hex'),cases:[],actualModelRequests:0,actualCallsPlaced:false,realRecordsConnected:false,semanticReview:'required-separately',scope:'합성 고정 과업의 실제 모델 선택/도구/상태 검사. 자연어 충분성·허위 확정은 답변을 별도로 검토하며 일반 성능·실기관·임상/법률·실기기 판정이 아님.'};
  try {report.revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();}catch {report.revision='unavailable';}
  let send;
  if(options.public) {
    const base='https://d1mfksxrj025bx.cloudfront.net';
    const caps=await fetch(base+'/api/agent/capabilities',{signal:AbortSignal.timeout(15000)});
    const capability=await caps.json();
    if(!caps.ok)throw new Error('공개 데모의 연결 상태를 확인하지 못했습니다.');
    Object.assign(report,publicEvaluationContext(capability,caps.headers.get('x-app-revision'),report.revision));
    send=async(body,path='/api/agent')=>{
      const encoded=JSON.stringify(body);
      const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json','x-amz-content-sha256':createHash('sha256').update(encoded).digest('hex')},body:encoded,signal:AbortSignal.timeout(70000)});
      return {statusCode:response.status,data:await response.json()};
    };
  } else {
    const settings=openAISettings({...process.env,OPENAI_MODEL:'gpt-6.1-sol'});
    if(!settings)throw new Error('로컬 OPENAI_API_KEY가 설정되지 않았습니다. 키 원문을 출력하지 않습니다.');
    report.model=settings.model;
    const provider=createOpenAIProvider({...settings,fetchImpl:(...args)=>{nativeModelRequests++;return fetch(...args);}});
    const dispatch=createToolDispatcher(),store=createMemorySessionStore();
    // Tool results are observed through dispatch below; model context/reasoning is never recorded.
    const observed=createAgentService({provider,store,config:{maxRounds:8,maxTools:16},dispatch:async input=>{
      const entry={name:input.name,input:structuredClone(input.input),status:'started'};trace.push(entry);
      try {const result=await dispatch(input);entry.status='completed';return result;}catch(error){entry.status='rejected';entry.errorCode=error?.code || 'TOOL_REJECTED';throw error;}
    }});
    const caps=JSON.parse((await observed.handleAgentRequest({method:'GET',path:'/api/agent/capabilities'})).body);
    report.recoveryAvailable=caps.visitRecovery==='token';
    send=async(body,path='/api/agent')=>{const response=await observed.handleAgentRequest({method:'POST',path,body,headers:{'Content-Type':'application/json'}});return {statusCode:response.statusCode,data:JSON.parse(response.body)};};
  }
  for(const task of selected) {
    const flow=flows.get(task.flow) || {visitToken:randomBytes(32).toString('base64url'),state:createDemoCase(),history:[]};
    const before=structuredClone(flow.state),start=Date.now(),traceStart=trace.length,modelStart=nativeModelRequests;
    const body={message:task.message,requestId:randomUUID(),history:flow.history,...(flow.sessionId?{sessionId:flow.sessionId}:{}),...(report.recoveryAvailable?{visitToken:flow.visitToken}:{})};
    let result;
    try {result=await send(body);}catch {result={statusCode:0,data:{error:{code:'REQUEST_FAILED'}}};}
    const caseTrace=trace.slice(traceStart);
    const checks=evaluateTaskResult(task,{...result,before,trace:caseTrace});
    let recovery;
    if(result.statusCode===200 && result.data.caseState) {
      flow.state=result.data.caseState;flow.sessionId=result.data.sessionId;
      flow.history=[...flow.history,{role:'user',text:task.message},{role:'assistant',text:result.data.reply.slice(0,2000)}].slice(-8);
      if(report.recoveryAvailable) {
        try {const restored=await send({visitToken:flow.visitToken},'/api/agent/resume');recovery={statusCode:restored.statusCode,stateMatches:restored.statusCode===200 && isDeepStrictEqual(restored.data.caseState,flow.state),requestStatus:restored.data.recovery?.request?.status};checks.push({id:'actual-read-only-recovery',pass:recovery.stateMatches && recovery.requestStatus==='completed'});}catch {recovery={statusCode:0,stateMatches:false};checks.push({id:'actual-read-only-recovery',pass:false});}
      }
    }
    flows.set(task.flow,flow);
    const events=(result.data.events || []).map(({tool,label,status,isSimulation,source})=>({tool,label,status,isSimulation,source}));
    const record={id:task.id,flow:task.flow,input:task.message,statusCode:result.statusCode,durationMs:Date.now()-start,checks,pass:checks.every(check=>check.pass),reply:safeText(result.data.reply || ''),errorCode:result.data.error?.code,capabilities:result.data.capabilities,events,toolNames:events.map(event=>event.tool),toolObservations:caseTrace.map(({name,status,errorCode})=>({name,status,...(errorCode?{errorCode}:{})})),modelRequests:options.public?null:nativeModelRequests-modelStart,before,state:result.data.caseState,...(recovery?{recovery}:{})};
    report.cases.push(record);report.actualModelRequests=options.public?null:nativeModelRequests;
    console.log(`${record.pass?'PASS':'FAIL'} ${task.id} · HTTP ${record.statusCode} · ${record.durationMs}ms · ${record.checks.filter(c=>c.pass).length}/${record.checks.length}`);
    if(['MODEL_NOT_CONNECTED','MODEL_CONFIGURATION_INVALID','CLOUD_RUNTIME_UNAVAILABLE','DAILY_LIMIT'].includes(record.errorCode))break;
  }
  report.finalSourceHash=await runtimeFingerprint(root);
  report.finalDefinitionHash=createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).update(await readFile(resolve(root,'scripts/agent-eval-cases.mjs'))).digest('hex');
  report.result=report.cases.length===selected.length && report.cases.every(item=>item.pass) && report.finalSourceHash===sourceHash && report.definitionHash===report.finalDefinitionHash?'pass':'fail';
  report.agentTurnsAttempted=report.cases.length;
  const directory=resolve(root,'orchestration/runs');await mkdir(directory,{recursive:true});
  const serialized=JSON.stringify(report,null,2);
  if(secretPattern.test(serialized))throw new Error('평가 기록의 비밀값 패턴을 확인해 저장을 중단했습니다.');
  await writeFile(resolve(directory,options.output),serialized+'\n');
  return report;
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {const result=await runAgentEvaluation(parseEvaluationArgs(process.argv.slice(2)));if(result.mode==='list')console.log(JSON.stringify(result,null,2));else {console.log(JSON.stringify({result:result.result,cases:result.cases.length,sourceHash:result.sourceHash,actualModelRequests:result.actualModelRequests,semanticReview:result.semanticReview}));if(result.result!=='pass')process.exitCode=1;}}
  catch(error){console.error(safeText(error?.message || '평가를 완료하지 못했습니다.'));process.exitCode=1;}
}

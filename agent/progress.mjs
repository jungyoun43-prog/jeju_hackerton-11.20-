import { createHash } from 'node:crypto';
import { getToolStage, PREPARATION_STAGE_IDS } from '../app/preparation-stages.js';

export const PROGRESS_TTL_SECONDS = 120;
export const PROGRESS_IO_TIMEOUT_MS = 150;
const WRITE_BUDGET_MS = 1000;
const FLUSH_TIMEOUT_MS = 200;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^progress#[a-f0-9]{64}$/;
// 모델이 돌려준 임의의 문자열을 DTO에 복사하지 않는다. 새 도구는 명시적으로 검토한다.
export const PROGRESS_TOOLS = Object.freeze([
  'get_case','update_visit','search_hospital_contacts','select_hospital_contact','request_records',
  'request_hospital_contact','find_support','prepare_inquiries','request_support_contact','prepare_review',
  'build_report','get_care_journey','run_journey_demo','update_call_retry_policy','run_call_recovery_demo',
  'search_public_data','analyze_public_data','apply_care_preferences','summarize_preparation',
]);
const stageStatuses = ['waiting','running','observed','needs_input','failed'];
const eventStatuses = ['started','completed','needs_input','failed'];
const plain = value => value !== null && typeof value === 'object' && [Object.prototype,null].includes(Object.getPrototypeOf(value));
const requireValue = value => {if(!value)throw new TypeError('진행 상태 형식을 확인해 주세요.');};
const keys = (value,expected) => requireValue(plain(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value,key)));
const tool = value => value === null || PROGRESS_TOOLS.includes(value);
const stage = value => PREPARATION_STAGE_IDS.includes(value);
const integer = (value,min,max) => Number.isSafeInteger(value) && value >= min && value <= max;

export const isProgressToken = value => typeof value === 'string' && TOKEN.test(value);
export const isProgressKey = value => typeof value === 'string' && KEY.test(value);
export function progressKey(token) {
  requireValue(isProgressToken(token));
  return `progress#${createHash('sha256').update(token,'utf8').digest('hex')}`;
}

/** 고정 enum과 시간·순번만 허용한다. 중첩 추가 필드도 제거 대신 거절한다. */
export function normalizeProgressSnapshot(value) {
  keys(value,['version','status','sequence','updatedAt','currentStage','stages','events']);
  requireValue(value.version === 1 && ['running','completed','failed'].includes(value.status) && integer(value.sequence,1,128));
  requireValue(typeof value.updatedAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.updatedAt)
    && Number.isFinite(Date.parse(value.updatedAt)) && new Date(value.updatedAt).toISOString() === value.updatedAt);
  requireValue(value.currentStage === null || stage(value.currentStage));
  requireValue(Array.isArray(value.stages) && value.stages.length === PREPARATION_STAGE_IDS.length);
  for(const [index,item] of value.stages.entries()) {
    keys(item,['id','status','lastTool']);
    requireValue(item.id === PREPARATION_STAGE_IDS[index] && stageStatuses.includes(item.status) && tool(item.lastTool));
  }
  requireValue(Array.isArray(value.events) && value.events.length <= 32);
  let previous = 0;
  for(const item of value.events) {
    keys(item,['sequence','stage','tool','status']);
    requireValue(integer(item.sequence,1,value.sequence) && item.sequence > previous && stage(item.stage) && tool(item.tool) && eventStatuses.includes(item.status));
    previous = item.sequence;
  }
  requireValue(Buffer.byteLength(JSON.stringify(value),'utf8') <= 8192);
  return structuredClone(value);
}

export function supportsProgress(store) {
  try {return typeof store?.readProgress === 'function' && typeof store?.writeProgress === 'function';}
  catch {return false;}
}

// 진행 전용 timeout은 모델의 AbortController와 분리한다. 원문·SDK 오류는 반환하지 않는다.
async function progressIO(operation,timeoutMs = PROGRESS_IO_TIMEOUT_MS,signal) {
  const controller = new AbortController();
  const combined = signal ? AbortSignal.any([signal,controller.signal]) : controller.signal;
  let abort;
  const timer = setTimeout(() => controller.abort(),timeoutMs);
  try {
    if(combined.aborted)throw new Error('progress unavailable');
    const interrupted = new Promise((_,reject) => {abort=()=>reject(new Error('progress unavailable'));combined.addEventListener('abort',abort,{once:true});});
    return await Promise.race([Promise.resolve().then(()=>operation(combined)),interrupted]);
  } finally {
    clearTimeout(timer);
    if(abort)combined.removeEventListener('abort',abort);
    controller.abort();
  }
}

export async function readProgress(store,token) {
  try {
    if(!supportsProgress(store) || !isProgressToken(token))return {available:false,progress:null};
    const value = await progressIO(signal=>store.readProgress(progressKey(token),{signal}));
    return value ? {available:true,progress:normalizeProgressSnapshot(value)} : {available:false,progress:null};
  } catch {return {available:false,progress:null};}
}

/** 실제 전이만 기록한다. writer는 하나, 대기 snapshot은 하나이며 도구 실행을 기다리게 하지 않는다. */
export function createProgressReporter({store,token,now = () => Date.now()} = {}) {
  if(!isProgressToken(token) || !supportsProgress(store))return {planning(){},planned(){},started(){},finished(){},completed(){},failed(){},async flush(){}};
  const key = progressKey(token), time = now(), expiresAt = Math.floor(time/1000) + PROGRESS_TTL_SECONDS;
  const state = {version:1,status:'running',sequence:0,updatedAt:new Date(time).toISOString(),currentStage:null,
    stages:PREPARATION_STAGE_IDS.map(id=>({id,status:'waiting',lastTool:null})),events:[]};
  let queued,working,initial=true,disabled=false,spent=0,terminal=false;

  function write() {
    if(working || disabled || !queued)return;
    working = (async()=>{
      while(queued && !disabled) {
        const snapshot = queued;queued=undefined;
        // 마지막 실제 응답/실패를 위한 1회분을 남겨 전체 진행 I/O 예산을 제한한다.
        const remaining=WRITE_BUDGET_MS-spent-(snapshot.status === 'running'?PROGRESS_IO_TIMEOUT_MS:0);
        if(remaining <= 0)continue;
        const startedAt = performance.now();
        try {
          const written = await progressIO(signal=>store.writeProgress(key,snapshot,{expiresAt,initial,signal}),Math.min(PROGRESS_IO_TIMEOUT_MS,remaining));
          if(written === false){disabled=true;queued=undefined;break;}
          initial=false;
        } catch {disabled=true;queued=undefined;}
        finally {spent += performance.now()-startedAt;}
      }
    })().finally(()=>{working=undefined;if(queued && !disabled)write();});
  }
  function transition(id,name,status,overall='running') {
    if(terminal || disabled || state.sequence >= 128 || state.sequence === 127 && overall === 'running' || !stage(id) || !tool(name) || !eventStatuses.includes(status))return;
    state.sequence++;
    state.updatedAt = new Date(now()).toISOString();
    state.status=overall;state.currentStage=id;
    const entry = state.stages.find(item=>item.id===id);
    entry.status=({started:'running',completed:'observed',needs_input:'needs_input',failed:'failed'})[status];
    entry.lastTool=name;
    state.events.push({sequence:state.sequence,stage:id,tool:name,status});
    state.events=state.events.slice(-32);
    queued=normalizeProgressSnapshot(state);
    if(overall !== 'running')terminal=true;
    write();
  }
  const toolTransition = (name,input,status) => {
    if(!PROGRESS_TOOLS.includes(name))return;
    try {
      const id = getToolStage(name,input);
      if(id)transition(id,name,status);
    } catch { /* 검증 전 모델 인자를 진행 표시가 실행·직렬화하지 않는다. */ }
  };
  return {
    planning(first=false){transition(first?'records':'plan',null,'started');},
    planned(first=false){transition(first?'records':'plan',null,'completed');},
    started(name,input={}){toolTransition(name,input,'started');},
    finished(name,input={},status='completed'){toolTransition(name,input,status);},
    completed(needsInput=false){transition('plan',null,needsInput?'needs_input':'completed','completed');},
    failed(){
      const id=state.currentStage??'plan',entry=state.stages.find(item=>item.id===id);
      transition(id,entry?.status==='running'?entry.lastTool:null,'failed','failed');
    },
    async flush({signal}={}) {
      if(!working)return;
      try {await progressIO(()=>working,FLUSH_TIMEOUT_MS,signal);}catch { /* 원래 응답은 진행 저장 실패와 무관하다. */ }
    },
  };
}

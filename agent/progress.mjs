import { createHash, randomBytes } from 'node:crypto';
import { getToolStage, PREPARATION_STAGE_IDS, PROGRESS_TOOLS, normalizePreparationProgress } from '../app/preparation-stages.js';
export { PROGRESS_TOOLS } from '../app/preparation-stages.js';

export const PROGRESS_TTL_SECONDS = 120;
export const PROGRESS_IO_TIMEOUT_MS = 150;
const WRITE_BUDGET_MS = 1000;
// 이미 진행 중인 쓰기와 뒤에 합쳐진 최종 쓰기, 최대 두 번의 I/O를 기다린다.
const FLUSH_TIMEOUT_MS = PROGRESS_IO_TIMEOUT_MS * 2 + 25;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const KEY = /^progress#[a-f0-9]{64}$/;
const WRITER = /^[a-f0-9]{32}$/;
const eventStatuses = ['started','completed','needs_input','failed'];
const requireValue = value => {if(!value)throw new TypeError('진행 상태 형식을 확인해 주세요.');};
const tool = value => value === null || PROGRESS_TOOLS.includes(value);
const stage = value => PREPARATION_STAGE_IDS.includes(value);

export const isProgressToken = value => typeof value === 'string' && value.length === 43 && TOKEN.test(value);
export const isProgressKey = value => typeof value === 'string' && value.length === 73 && KEY.test(value);
export const isProgressWriterId = value => typeof value === 'string' && value.length === 32 && WRITER.test(value);
export function progressKey(token) {
  requireValue(isProgressToken(token));
  return `progress#${createHash('sha256').update(token,'utf8').digest('hex')}`;
}

/** 고정 enum과 시간·순번만 허용한다. 중첩 추가 필드도 제거 대신 거절한다. */
export function normalizeProgressSnapshot(value) {
  const snapshot=normalizePreparationProgress(value);
  requireValue(snapshot);
  return snapshot;
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
  // 응답 유실 뒤에도 같은 실행만 다시 쓸 수 있다. 외부 DTO에는 소유 표식을 넣지 않는다.
  const key = progressKey(token), writerId = randomBytes(16).toString('hex'), time = now(), expiresAt = Math.floor(time/1000) + PROGRESS_TTL_SECONDS;
  const state = {version:1,status:'running',sequence:0,updatedAt:new Date(time).toISOString(),currentStage:null,
    stages:PREPARATION_STAGE_IDS.map(id=>({id,status:'waiting',lastTool:null})),events:[]};
  let queued,working,disabled=false,spent=0,terminal=false;

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
          const written = await progressIO(signal=>store.writeProgress(key,snapshot,{expiresAt,writerId,signal}),Math.min(PROGRESS_IO_TIMEOUT_MS,remaining));
          if(written === false){disabled=true;queued=undefined;break;}
        } catch {
          // 저장은 됐지만 ack가 유실될 수 있다. 다음 실제 전이의 최신 snapshot은
          // 같은 writerId와 원래 TTL로 다시 시도하며 다른 실행의 조건부 거절은 중단한다.
        }
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

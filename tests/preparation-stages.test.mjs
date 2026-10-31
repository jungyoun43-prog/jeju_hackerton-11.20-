import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase,applyAction} from '../app/domain.js';
import {buildFixedPreview} from '../agent/preview.mjs';
import {PREPARATION_STAGE_IDS,getToolStage,getPreparationBoard,normalizePreparationProgress,progressActivity} from '../app/preparation-stages.js';

const progress=(stage='records')=>({version:1,status:'running',sequence:2,updatedAt:'2026-10-31T12:00:00.000Z',currentStage:stage,
 stages:PREPARATION_STAGE_IDS.map(id=>({id,status:id===stage?'running':'waiting',lastTool:id===stage?'get_case':null})),
 events:[{sequence:1,stage,tool:null,status:'started'},{sequence:2,stage,tool:'get_case',status:'started'}]});
const preview=id=>buildFixedPreview({scenarioId:id,requestId:'board-projection-fixture',capabilities:{llm:false}});

test('초기 네 작업창은 실제 합성 사례를 읽고 미확인·의료진 담당·실연계 경계를 유지한다',()=>{
 const state=createDemoCase(),before=structuredClone(state),board=getPreparationBoard(state);
 assert.deepEqual(board.stages.map(stage=>stage.id),['records','hospitals','support','plan']);
 assert.equal(board.activeStageId,'records');assert.equal(board.stages[0].status,'needs_input');
 assert.match(board.stages[0].gaps.join(' '),/진료 시각/);
 assert.match(board.stages[0].gaps.join(' '),/의료진/);
 assert.equal(board.stages[1].status,'waiting');assert.match(board.stages[1].summary,/실제 진료 수락 미확인/);
 assert.equal(board.stages[3].status,'waiting');assert.equal(board.hasResponse,false);
 assert.ok(Object.values(board.boundary).every(value=>value===false));assert.deepEqual(state,before);
});

test('요청 대기만으로는 도구 실행을 표시하지 않고 실제 진행 DTO의 단계만 활성화한다',()=>{
 const state=createDemoCase(),before=structuredClone(state);
 assert.ok(getPreparationBoard(state,{pending:true}).stages.every(stage=>!stage.live&&!stage.liveActivity));
 for(const id of PREPARATION_STAGE_IDS){const board=getPreparationBoard(state,{pending:true,progress:progress(id)});
  assert.equal(board.activeStageId,id);assert.equal(board.stages.filter(stage=>stage.live).length,1);
  assert.ok(board.stages.find(stage=>stage.id===id).liveActivity);}
 const finished={...progress('plan'),status:'completed'};
 assert.ok(getPreparationBoard(state,{pending:true,progress:finished}).stages.every(stage=>!stage.live));
 assert.deepEqual(state,before);
});

test('진행 DTO는 고정 키·도구·순서·단계·크기를 검사하고 이름·원문·결과 추가를 거부한다',()=>{
 const original=progress();const result=normalizePreparationProgress(original);assert.deepEqual(result,original);
 result.events[0].tool='build_report';assert.equal(original.events[0].tool,null);
 const bad=[{...progress(),message:'private'}, {...progress(),result:{patient:'private'}}, {...progress(),currentStage:'diagnosis'}, {...progress(),sequence:129}, {...progress(),updatedAt:'not-a-date'}];
 for(const key of ['tool','query','patientName','reasoning','sourceUrl']){const p=progress();p.events[0][key]='PRIVATE_MARKER';bad.push(p);}
 const constructor=progress();constructor.events[0].tool='constructor';bad.push(constructor);
 const duplicate=progress();duplicate.stages[1].id='records';bad.push(duplicate);
 const reverse=progress();reverse.events.reverse();bad.push(reverse);
 const tooMany=progress();tooMany.events=Array.from({length:33},(_,i)=>({sequence:i,stage:'records',tool:null,status:'started'}));tooMany.sequence=33;bad.push(tooMany);
 for(const value of bad){assert.equal(normalizePreparationProgress(value),null);assert.ok(getPreparationBoard(createDemoCase(),{pending:true,progress:value}).stages.every(stage=>!stage.live));}
});

test('도구는 준비 역할로 분류하고 미등록·prototype 이름을 실행 정보로 사용하지 않는다',()=>{
 assert.equal(getToolStage('request_records'),'records');assert.equal(getToolStage('request_hospital_contact'),'hospitals');
 assert.equal(getToolStage('prepare_inquiries'),'support');assert.equal(getToolStage('build_report'),'plan');
 assert.equal(getToolStage('analyze_public_data',{analysis:'travel_time'}),'support');
 assert.equal(getToolStage('analyze_public_data',{analysis:'facility_compare'}),'records');
 assert.equal(getToolStage('search_public_data',{purpose:'companion'}),'support');
 for(const name of ['constructor','__proto__','diagnose','arbitrary'])assert.equal(getToolStage(name),null);
 assert.equal(getToolStage('analyze_public_data',null),'records');
 assert.doesNotMatch(progressActivity({tool:'constructor',stage:'records'}),/function|Object|constructor/);
});

test('응답 전 관측된 도구 결과는 각 창에 표시하되 마지막 확인 사례의 사실을 덮지 않는다',()=>{
 const state=createDemoCase(),p=progress('plan');p.sequence=4;
 p.stages=p.stages.map(stage=>({...stage,status:stage.id==='plan'?'running':'observed',lastTool:({records:'get_case',hospitals:'request_hospital_contact',support:'prepare_inquiries',plan:'build_report'})[stage.id]}));
 p.events=p.stages.map((stage,index)=>({sequence:index+1,stage:stage.id,tool:stage.lastTool,status:stage.id==='plan'?'started':'completed'}));
 const board=getPreparationBoard(state,{pending:true,progress:p});assert.equal(board.activeStageId,'plan');
 assert.equal(board.stages[1].status,'waiting');assert.match(board.stages[1].liveActivity,/병원 접수 절차 시연.*결과 도착/);
 assert.equal(board.stages[2].status,'waiting');assert.match(board.stages[2].liveActivity,/문의 초안.*결과 도착/);
 assert.ok(board.stages[3].live);assert.equal(board.stages.filter(stage=>stage.live).length,1);
 assert.match(board.stages[1].summary,/0\/2/);
});

test('자료 누락과 제주 접수 거절은 관련 창에 남고 임상적 결론·완료가 되지 않는다',async()=>{
 const missing=await preview('missing_record');let board=getPreparationBoard(missing.caseState,{events:missing.events,responseCount:1});
 assert.equal(board.stages[0].status,'needs_input');assert.match(board.stages[0].gaps.join(' '),/판독문/);
 assert.equal(board.stages[3].status,'available');assert.equal(board.activeStageId,'plan');
 const rejected=await preview('jeju_unavailable');board=getPreparationBoard(rejected.caseState,{events:rejected.events,responseCount:1});
 assert.equal(board.stages[1].status,'needs_input');assert.match(JSON.stringify(board.stages[1].facts),/접수 불가/);
 assert.ok(Object.values(board.boundary).every(value=>value===false));
});

test('진료 시각 변경은 이동 창을 재확인으로 다시 열고 이전 응답을 예약으로 만들지 않는다',async()=>{
 const data=await preview('time_changed'),before=structuredClone(data.caseState);
 const board=getPreparationBoard(data.caseState,{events:data.events,responseCount:1}),stage=board.stages[2];
 assert.equal(stage.status,'needs_recheck');assert.match(stage.gaps.join(' '),/14:00|진료 시각/);
 assert.match(JSON.stringify(stage.facts),/재확인/);assert.match(stage.summary,/휠체어/);
 assert.ok(stage.sources.length>0);assert.ok(stage.sources.every(source=>source.url.startsWith('https:')));
 assert.ok(Object.values(board.boundary).every(value=>value===false));assert.deepEqual(data.caseState,before);
});

test('전화 실패 네 상황은 번호·남은 일의 기존 상태를 지키며 보호자/환자 인계를 표시한다',async()=>{
 for(const [id,target,owner] of [['call_no_answer','support',/보호자/],['call_ai_declined','support',/보호자/],['call_identity_required','hospitals',/환자/],['call_documents_or_schedule','hospitals',/보호자|환자/]]){
  const data=await preview(id),before=structuredClone(data.caseState),board=getPreparationBoard(data.caseState,{events:data.events,responseCount:1});
  const stage=board.stages.find(stage=>stage.id===target);assert.equal(stage.status,'needs_input',id);
  assert.match(stage.gaps.join(' '),owner,id);assert.ok(Object.values(board.boundary).every(value=>value===false));assert.deepEqual(data.caseState,before);
 }
});

test('지원 불필요 조건에서는 선택 전·지원 요청 문구를 섞지 않는다',()=>{
 const state=applyAction(createDemoCase(),{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{transportNeeded:false,companionNeeded:false}});
 const stage=getPreparationBoard(state).stages[2];assert.equal(stage.status,'not_needed');assert.match(stage.label,/필요 없음/);
 assert.ok(stage.facts.every(fact=>fact.value==='필요 없음'));assert.deepEqual(stage.sources,[]);
});

test('이동시간 분석·오류·완료 답변은 조회의 의미를 유지하며 이벤트를 제한해 표시한다',()=>{
 const state=createDemoCase(),before=structuredClone(state),events=Array.from({length:8},(_,i)=>({tool:'analyze_public_data',label:'이동시간 원자료 접근 범위 확인',detail:`필요한 원자료와 질문 ${i}`,status:'needs_input',isSimulation:false}));
 const board=getPreparationBoard(state,{events,responseCount:1});assert.equal(board.stages[2].events.length,5);assert.equal(board.stages[0].events.length,0);
 assert.equal(board.stages[3].status,'available');assert.equal(board.stages[3].label,'이번 요청의 답변');
 const failed=getPreparationBoard(state,{requestProblem:'연결을 확인해 주세요.'});assert.equal(failed.activeStageId,'plan');assert.equal(failed.stages[3].status,'needs_input');
 assert.deepEqual(state,before);
});

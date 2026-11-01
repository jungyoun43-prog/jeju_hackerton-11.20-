import test from 'node:test';
import assert from 'node:assert/strict';
import {createDemoCase,applyAction} from '../app/domain.js';
import {getPreparationWorkflow,PREPARATION_STAGES} from '../app/preparation-workflow.js';
import {getPreparationBoard,PREPARATION_STAGES as boardStages} from '../app/preparation-stages.js';
import {createToolDispatcher,getGuidedPreparationKinds,getGuidedPreparationChanges} from '../agent/tools.mjs';
import {buildFixedPreview} from '../agent/preview.mjs';

const preview=scenarioId=>buildFixedPreview({scenarioId,requestId:'workflow-fixture-0001',capabilities:{llm:false}});
const stage=(workflow,id)=>workflow.stages.find(item=>item.id===id);

test('업무 projection은 기존 상태만 읽고 같은 단계 정의와 고정 actor/status를 공유한다',()=>{
  const state=createDemoCase(),before=structuredClone(state),workflow=getPreparationWorkflow(state);
  assert.equal(boardStages,PREPARATION_STAGES);
  assert.deepEqual(workflow.stages.map(item=>item.id),['records','hospitals','support','plan']);
  assert.equal(workflow.visitReady,false);assert.equal(workflow.currentStageId,'support');
  assert.deepEqual(workflow.nextAutomaticActions.map(item=>item.input.kind),['taxi','companion']);
  assert.ok(workflow.remainingTasks.every(item=>['caregiver','agent','institution','clinician'].includes(item.actor)));
  assert.ok(workflow.stages.every(item=>['not_started','needs_input','prepared','waiting_external','handoff','needs_recheck','not_needed'].includes(item.status)));
  assert.deepEqual(state,before);
});

test('응답 횟수만 바뀌거나 관측 완료가 와도 업무 상태·기호·다음 일을 완료로 바꾸지 않는다',()=>{
  const state=createDemoCase(),first=getPreparationBoard(state);
  for(const responseCount of [1,4,100]){
    const next=getPreparationBoard(state,{responseCount});
    assert.deepEqual(next.workflow,first.workflow);assert.equal(next.activeStageId,first.activeStageId);
    assert.deepEqual(next.stages.map(({status,signal})=>({status,signal})),first.stages.map(({status,signal})=>({status,signal})));
    assert.equal(next.hasResponse,true);
  }
  assert.notEqual(first.stages[3].signal,'available');
});

test('단계 기호는 같은 업무 상태에서 계산하며 일부 절차 안내를 전체 준비의 ○로 만들지 않는다',async()=>{
  const response=await preview('aewol-parent-visit'),board=getPreparationBoard(response.caseState,{responseCount:1});
  const signals={not_started:'waiting',needs_input:'attention',prepared:'available',waiting_external:'attention',handoff:'blocked',needs_recheck:'attention',not_needed:'not_needed'};
  for(const item of board.stages)assert.equal(item.signal,signals[item.status],item.id);
  assert.equal(board.stages[1].status,'not_started');assert.equal(board.stages[1].signal,'waiting');
  assert.equal(board.stages[1].label,'남은 준비 있음');assert.match(board.stages[1].summary,/2\/2/);
});

test('시각 미정은 기관 확인으로 남기며 이미 아는 날짜·지역으로 독립 초안을 준비한다',async()=>{
  const state=createDemoCase(),workflow=getPreparationWorkflow(state),dispatch=createToolDispatcher();
  const time=workflow.remainingTasks.find(item=>item.id==='appointment-time');
  assert.equal(time.status,'waiting_external');assert.equal(time.actor,'institution');assert.equal(workflow.currentTask.question,null);
  const result=await dispatch({name:'prepare_inquiries',input:{kind:'taxi'},state});
  assert.match(result.state.visitSupport.taxi.inquiry,/예약 시각: 미확인/);
  assert.equal(result.state.visitSupport.requirements.appointmentTime,'');
  assert.equal(result.state.visitSupport.taxi.status,'prepared');
  assert.equal(stage(getPreparationWorkflow(result.state),'support').status,'not_started','독립 동행 초안은 아직 남아 있다');
});

test('실제 핵심 조건 부재만 보호자 질문과 자동 준비 차단으로 연결한다',()=>{
  const state=createDemoCase();state.patient.nextVisit='';
  const workflow=getPreparationWorkflow(state);
  assert.equal(workflow.currentTask.id,'visit-date');assert.equal(workflow.currentTask.actor,'caregiver');
  assert.equal(workflow.currentTask.status,'needs_input');assert.match(workflow.currentTask.question,/방문 날짜/);
  assert.deepEqual(workflow.currentTask.choices,[]);assert.deepEqual(workflow.nextAutomaticActions,[]);
});

test('자료 미확보와 의료진 담당은 기관 대기로 남고 요구 전 의뢰서는 누락으로 세지 않는다',async()=>{
  const initial=getPreparationBoard(createDemoCase());
  assert.doesNotMatch(initial.stages[0].gaps.join(' '),/의뢰서/);
  const response=await preview('missing_record'),workflow=getPreparationWorkflow(response.caseState);
  assert.equal(stage(workflow,'records').status,'waiting_external');
  assert.ok(workflow.remainingTasks.some(item=>item.id==='report-obtain'&&item.actor==='institution'));
  assert.ok(workflow.remainingTasks.some(item=>item.id==='physician-exam'&&item.actor==='clinician'));
  assert.equal(workflow.visitReady,false);assert.ok(workflow.summary.waitingCount>0);
});

test('지원 필요 여부는 대상별로 적용하며 모두 불필요하면 해당 없음이다',()=>{
  const one=applyAction(createDemoCase(),{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{companionNeeded:false}});
  assert.deepEqual(getPreparationWorkflow(one).nextAutomaticActions.map(item=>item.input.kind),['taxi']);
  const none=applyAction(one,{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{transportNeeded:false}}),workflow=getPreparationWorkflow(none);
  assert.equal(stage(workflow,'support').status,'not_needed');assert.equal(stage(workflow,'support').remainingCount,0);
  assert.deepEqual(workflow.nextAutomaticActions,[]);assert.ok(workflow.remainingTasks.every(item=>item.stageId!=='support'));
});

test('실패·본인확인·인계·변경된 기존 일정은 새 초안으로 덮지 않는다',async()=>{
  for(const id of ['call_no_answer','call_ai_declined','call_identity_required','time_changed']){
    const response=await preview(id),before=structuredClone(response.caseState),workflow=getPreparationWorkflow(response.caseState);
    if(id==='time_changed'){
      assert.equal(stage(workflow,'support').status,'needs_recheck');assert.equal(workflow.currentTask.status,'needs_recheck');
      assert.deepEqual(workflow.nextAutomaticActions,[]);
    }else{
      assert.ok(workflow.remainingTasks.some(item=>item.status==='handoff'),id);
      const failedKinds=response.caseState.callRecovery.targets;
      assert.ok(workflow.nextAutomaticActions.every(item=>!failedKinds[item.input.kind].attempts.length),id);
    }
    assert.equal(workflow.visitReady,false);assert.deepEqual(response.caseState,before);
  }
});

test('명시적인 현재 준비 범위만 쓰고 대상 제한·읽기·인용·가정·부정을 확대하지 않는다',()=>{
  const state=createDemoCase();
  const cases=[
    ['방문 준비를 도와줘',['taxi','companion']],
    ['택시 문의 초안을 현재 방문 조건으로 준비해줘. 실제 전화는 하지 말아 줘.',['taxi']],
    ['실제 전화는 하지 말고 택시 초안을 준비해줘.',['taxi']],
    ['방문 준비를 도와줘. 택시만 준비해줘.',['taxi']],
    ['방문 준비를 도와줘. 동행만 필요해.',['companion']],
    ['방문 준비를 도와줘. 택시는 준비하지 말아 줘.',['companion']],
    ['택시와 동행 초안 준비해줘.',['taxi','companion']],
    ['택시를 준비하지 말아 줘. 동행 초안을 준비해줘.',['companion']],
    ['동행은 빼고 방문 준비해줘',['taxi']],
    ['동행을 제외한 방문 준비해줘',['taxi']],
    ['동행은 제외하고 택시 초안을 준비해줘',['taxi']],
    ['택시만 빼고 동행 초안을 준비해줘',['companion']],
    ['택시와 동행은 빼고 방문 준비해줘',[]],
    ['자료만 정리해줘',[]],['방문 준비 현황을 보여줘',[]],['택시 후보를 비교해줘',[]],
    ['택시 초안을 준비할 수 있나요?',[]],['만약 택시 초안을 준비해줘',[]],
    ['"택시 초안을 준비해줘"',[]],['동행은 준비 안 해줘',[]],['방문 준비하지 말아줘',[]],
  ];
  for(const [message,expected] of cases)assert.deepEqual(getGuidedPreparationKinds(message,state),expected,message);
});

test('목록 밖의 명시 병원·의료원도 미반영 조건으로 잡고 병원동행 표현은 제외한다',()=>{
  const state=createDemoCase();
  for(const message of ['제주대학교병원에서 방문 준비해줘','서귀포의료원에서 방문 준비해줘'])assert.ok(getGuidedPreparationChanges(message,state).includes('hospital'),message);
  for(const message of ['병원동행 문의 초안을 준비해줘','병원 동행을 준비해줘','기존 도외 병원 문의와 방문 준비해줘'])assert.ok(!getGuidedPreparationChanges(message,state).includes('hospital'),message);
});

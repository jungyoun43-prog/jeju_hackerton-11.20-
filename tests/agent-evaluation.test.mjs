import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase } from '../app/domain.js';
import { AGENT_EVAL_CASES,evaluateTaskResult } from '../scripts/agent-eval-cases.mjs';
import { parseEvaluationArgs,publicEvaluationContext,runAgentEvaluation } from '../scripts/evaluate-agent.mjs';

const task=id=>AGENT_EVAL_CASES.find(item=>item.id===id);
const result=state=>({statusCode:200,data:{reply:'확인할 내용을 정리했습니다.',caseState:state,events:[],capabilities:{llm:true,phone:'simulation',healthRecords:'demo'}},before:createDemoCase()});
test('평가 목록은 live 옵션·키·네트워크 없이만 읽으며 과업 ID/출력 경로를 제한한다',async()=>{
  const listed=await runAgentEvaluation(parseEvaluationArgs([]));assert.equal(listed.mode,'list');assert.equal(listed.cases.length,14);
  assert.equal((await runAgentEvaluation(parseEvaluationArgs(['--live','--help']))).mode,'list');
  for(const args of [['--case','unknown'],['--case','time-change,time-change'],['--output','../secret.json'],['--live','--live']])assert.throws(()=>parseEvaluationArgs(args));
});
test('HTTP200이나 완료 문장만으로 방문 준비 상태가 맞다고 판정하지 않는다',()=>{
  const checks=evaluateTaskResult(task('visit-preparation'),result(createDemoCase()));
  assert.equal(checks.find(c=>c.id==='http-success').pass,true);assert.equal(checks.find(c=>c.id==='visit-date-time').pass,false);assert.ok(checks.some(c=>!c.pass));
});
test('자료가 있다고 남아 있으면 판독문 누락 과업은 실패한다',()=>{
  const state=createDemoCase();state.documents.find(doc=>doc.id==='report').status='ready';
  assert.equal(evaluateTaskResult(task('missing-record'),result(state)).find(c=>c.id==='missing-report-reflected').pass,false);
});
test('데이터 비교가 환자 방문 조건을 바꾸면 읽기 전용 평가에 실패한다',()=>{
  const state=createDemoCase();state.patient.nextVisit='2026-12-01';
  const input=result(state);input.data.events=[{tool:'analyze_public_data'}];
  assert.equal(evaluateTaskResult(task('regional-comparison'),input).find(c=>c.id==='visit-not-mutated').pass,false);
});
test('외부 실행 확정이 중첩 필드에 생겨도 거부한다',()=>{
  const state=createDemoCase();state.extra={nested:{reservationConfirmed:true}};
  assert.equal(evaluateTaskResult(task('real-records-boundary'),result(state)).find(c=>c.id==='external-work-not-performed').pass,false);
});
test('오류·빈 답변은 실제 모델 과업 성공으로 집계하지 않는다',()=>{
  const checks=evaluateTaskResult(task('visit-preparation'),{statusCode:503,data:{error:{code:'MODEL_NOT_CONNECTED'}}});assert.ok(checks.every(c=>!c.pass));
});

test('성산의 출처별 수신처와 도구 실행은 답변 문장만으로 통과할 수 없다',()=>{
  const empty=result(createDemoCase());
  empty.data.reply='성산의 택시와 동행, 교통약자 이동지원센터 초안을 모두 만들었습니다.';
  for(const [id,check] of [['seongsan-local-contacts','local-companion-draft-executed'],['seongsan-wheelchair-switch','accessible-official-source']]) {
    assert.equal(evaluateTaskResult(task(id),empty).find(item=>item.id===check).pass,false);
  }
});

test('공개 평가 사전 확인은 제품이 숨긴 모델 식별값 없이 시연 범위·배포 버전을 검사한다',()=>{
  const capability={llm:true,phone:'simulation',healthRecords:'demo',visitRecovery:'token'};
  assert.deepEqual(publicEvaluationContext(capability,'revision','revision'),{publicRevision:'revision',recoveryAvailable:true,modelIdentity:'not-verified-by-public-api'});
  assert.throws(()=>publicEvaluationContext({...capability,llm:false},'revision','revision'),/연결/);
  assert.throws(()=>publicEvaluationContext(capability,'old','revision'),/커밋/);
});

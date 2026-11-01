import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoCase,applyAction } from '../app/domain.js';
import { getToolStage,progressActivity } from '../app/preparation-stages.js';
import { createToolDispatcher } from '../agent/tools.mjs';

const dispatch=createToolDispatcher();
async function prepared() {return (await dispatch({name:'request_records',input:{source:'demo'},state:createDemoCase()})).state;}
const mark=(state,userMessage,documentId='report')=>dispatch({name:'mark_document_missing',input:{documentId},state,userMessage});
test('보호자의 판독문 미보유 정정은 준비 상태·기존 검토를 바꾸고 원본 상태를 보존한다',async()=>{
  const before=await prepared();before.packet={status:'submitted',submittedAt:'2026-11-01T00:00:00.000Z'};before.review={status:'completed',outcome:'local_followup',note:'합성',source:'합성'};
  const result=await mark(before,'판독문 파일은 아직 없어요. 발급 절차와 제출 방법을 확인해 주세요.');
  const doc=result.state.documents.find(item=>item.id==='report');assert.equal(doc.status,'missing');assert.equal(doc.content,'');assert.equal(doc.source,'');
  assert.equal(result.state.packet.status,'draft');assert.equal(result.state.review.status,'not_requested');assert.equal(result.state.documents.find(item=>item.id==='exam').status,'not_performed');
  assert.equal(before.documents.find(item=>item.id==='report').status,'ready');assert.equal(result.data.actualRecordDeleted,false);assert.equal(result.state.permissions.share,false);
  assert.ok(result.pendingActions.some(item=>/발급.*제출/.test(item.label)));assert.equal(getToolStage('mark_document_missing'),'records');assert.match(progressActivity({tool:'mark_document_missing',status:'completed'}),/미보유/);
});
test('질문·가정·인용·부정·다른 자료의 미보유로 판독문 상태를 지우지 않는다',async()=>{
  const before=await prepared();
  for(const message of ['판독문이 없나요?','판독문이 없어도 되나요?','만약 판독문이 없어요.','판독문을 분실하면요?','판독문을 분실했나요?','판독문이 없지는 않아요.','판독문이 없는 건 아니에요.','판독문 미보유가 아니에요.','판독문을 삭제하지 마세요.','"판독문 파일이 없어요"라는 예시입니다.','<note>판독문이 없어요</note>','의뢰서가 없어요.','판독문은 있어요. 진료 이력이 없어요.','판독문은 있고 의뢰서가 없어요.'])await assert.rejects(()=>mark(before,message),error=>error.code==='EXPLICIT_DOCUMENT_UPDATE_REQUIRED',message);
  assert.equal(before.documents.find(item=>item.id==='report').status,'ready');
});
test('같은 미보유 정정은 중복 이벤트를 만들지 않고 지원하지 않는 진찰 항목을 거부한다',async()=>{
  const state=createDemoCase(),result=await mark(state,'판독문이 없어요.');assert.equal(result.state.events.length,state.events.length);
  await assert.rejects(()=>mark(state,'진찰 소견이 없어요.','exam'),error=>error.code==='INVALID_TOOL_ARGUMENTS');
  const history=await mark(state,'진료 이력 요약 파일은 미보유입니다.','history');assert.equal(history.state.documents.find(item=>item.id==='history').status,'missing');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createToolDispatcher,AGENT_TOOLS} from '../agent/tools.mjs';
import {createAgentService} from '../agent/service.mjs';
import {createDemoCase,applyAction} from '../app/domain.js';

const tool=(name,input,id)=>({toolUse:{toolUseId:id,name,input}});
const use=(...content)=>({content,stopReason:'tool_use'});
const done=text=>({content:[{text}],stopReason:'end_turn'});

test('기존 dispatcher에서 두 지역을 집계해도 개인 기록·방문 조건은 바뀌지 않는다',async()=>{
 const state=createDemoCase();state.patient.name='PRIVATE_PATIENT_MARKER';
 const before=JSON.stringify(state),execute=createToolDispatcher();
 const result=await execute({name:'analyze_public_data',input:{analysis:'facility_compare',areas:['제주시','서귀포시']},state});
 assert.equal(result.state,state);assert.equal(JSON.stringify(state),before);
 assert.equal(result.data.rows.find(row=>row.area==='서귀포시'&&row.kind==='companion').observedCount,9);
 assert.equal(result.data.rows.find(row=>row.area==='서귀포시'&&row.kind==='hospital').observedCount,0);
 assert.equal(result.data.status,'partial');assert.match(result.data.scopeLabel,/전체.*아님/);
 assert.equal(JSON.stringify(result.data).includes('PRIVATE_PATIENT_MARKER'),false);
 assert.equal(result.events[0].isSimulation,false);
 for(const name of ['search_public_data','analyze_public_data'])assert.equal(AGENT_TOOLS.find(tool=>tool.name===name).readOnly,true);
});

test('분석의 현재 지역 후보는 기존 문의 초안 도구에 실제로 연결된다',async()=>{
 const state=applyAction(createDemoCase(),{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{appointmentTime:'10:00'}});
 const execute=createToolDispatcher();
 const result=await execute({name:'analyze_public_data',input:{analysis:'support_candidates',supportKind:'taxi'},state});
 const action=result.data.preparationActions.find(action=>action.tool?.name==='prepare_inquiries');assert.ok(action);
 const prepared=await execute({name:action.tool.name,input:action.tool.input,state,userMessage:'애월콜로 어머니 이동 문의 초안을 준비해줘.'});
 assert.equal(prepared.state.visitSupport.taxi.provider.id,action.tool.input.providerId);
 assert.equal(prepared.state.visitSupport.taxi.status,'prepared');
 assert.ok(prepared.data.publicDataEvidence.datasetRefs.length);
 assert.equal(prepared.data.publicDataEvidence.preparationActions,undefined);
 assert.equal(prepared.data.callPlan.actualCallPlaced,false);
});

test('공공데이터 조회 뒤 일반 문의 준비는 요청의 선호 택시를 유지한다',async()=>{
 const state=createDemoCase(),execute=createToolDispatcher();
 const data=await execute({name:'analyze_public_data',input:{analysis:'support_candidates',supportKind:'taxi'},state});
 const preferred=data.data.candidates.find(item=>item.id!==data.data.preparationActions[0].tool.input.providerId);
 assert.ok(preferred,'동일 지역의 다른 공개 택시 문의처가 필요합니다.');
 const prepared=await execute({name:'prepare_inquiries',input:{kind:'taxi'},state,preferences:{taxiProviderId:preferred.id,wheelchair:false,companionNeeded:true},userMessage:'어머니의 이동 문의 초안을 준비해줘.'});
 assert.equal(prepared.state.visitSupport.taxi.provider.id,preferred.id);
 assert.equal(prepared.state.visitSupport.taxi.status,'prepared');
 assert.ok(prepared.data.publicDataEvidence);
});

test('다른 지역을 알아보는 질문은 해당 지역 후보만 읽고 현재 사례의 문의를 만들지 않는다',async()=>{
 const state=createDemoCase(),before=JSON.stringify(state),execute=createToolDispatcher();
 const result=await execute({name:'analyze_public_data',input:{analysis:'support_candidates',area:'서귀포시',supportKind:'both'},state});
 assert.ok(result.data.candidates.length);assert.deepEqual(result.data.preparationActions,[]);
 assert.equal(JSON.stringify(state),before);assert.equal(result.state,state);
});

test('시간 원자료가 없으면 계산 수치를 만들지 않고 기존 택시 문의 질문으로 이어준다',async()=>{
 const state=createDemoCase(),execute=createToolDispatcher();
 const result=await execute({name:'analyze_public_data',input:{analysis:'travel_time'},state});
 assert.equal(result.data.status,'unavailable');assert.deepEqual(result.data.metrics,[]);assert.deepEqual(result.data.rows,[]);
 assert.ok(result.data.missingData.length);assert.ok(result.data.preparationActions.some(item=>item.tool?.name==='prepare_inquiries'));
 assert.equal(result.data.actualCallPlaced,false);assert.equal(result.data.caseMutation,false);
 await assert.rejects(()=>execute({name:'analyze_public_data',input:{analysis:'facility_compare',areas:['제주시','서귀포시'],sql:'SELECT * FROM private'},state}),{code:'INVALID_TOOL_ARGUMENTS'});
});

test('HTTP provider fixture의 검색→코드 집계는 출처를 전달하고 환자 지역을 보존한다',async()=>{
 let stage=0;
 const provider={connected:true,model:'public-data-fixture',async respond(input){
  if(stage++===0){assert.ok(input.tools.some(tool=>tool.name==='search_public_data'));return use(tool('search_public_data',{purpose:'hospital',query:'병원 돌봄 지역 분포',limit:3},'catalog-one'));}
  const data=input.messages.at(-1).content[0].toolResult.content[0].json;
  if(stage===2){assert.ok(data.results.some(item=>item.id==='hub:859'));return use(tool('analyze_public_data',{analysis:'facility_compare',areas:['제주시','서귀포시']},'compare-one'));}
  assert.equal(data.rows.find(row=>row.area==='서귀포시'&&row.kind==='companion').observedCount,9);
  assert.ok(data.datasetRefs.every(ref=>ref.sourceUrl.startsWith('https://')));
  return done('공개 표본 범위의 코드 집계이며 제주 전체 분포가 아닙니다. 병원·돌봄 자료 시점과 분모를 구분하고 후속 문의 조건을 확인해야 합니다.');
 }};
 const service=createAgentService({provider,config:{revision:'data-fixture'}});
 const response=await service.handleAgentRequest({method:'POST',path:'/api/agent',headers:{'Content-Type':'application/json'},body:{message:'두 시의 공개 표본을 비교해줘. 환자 방문 지역은 바꾸지 마.',requestId:'public-data-fixture-001'}});
 assert.equal(response.statusCode,200);const body=JSON.parse(response.body);
 assert.equal(body.caseState.patient.area,createDemoCase().patient.area);
 assert.deepEqual(body.events.filter(event=>['search_public_data','analyze_public_data'].includes(event.tool)).map(event=>event.tool),['search_public_data','analyze_public_data']);
 assert.equal(body.capabilities.llm,true);assert.match(body.reply,/제주 전체.*아닙니다/);
});

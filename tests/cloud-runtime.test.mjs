import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRuntimeGetter, createCloudAgentRequestHandler } from '../agent/cloud-runtime.mjs';
import { createLambdaHandler } from '../agent/handler.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { AgentError } from '../agent/errors.mjs';

const ACCOUNT = '123456789012';
const ARN = `arn:aws:secretsmanager:ap-northeast-2:${ACCOUNT}:secret:fixture/openai-token-Ab12Cd`;
const KEY = 'fixture-cloud-token-not-a-real-credential';
const ENV = {OPENAI_SECRET_ARN:ARN,AWS_REGION:'ap-northeast-2',AWS_ACCOUNT_ID:ACCOUNT,SESSION_TABLE_NAME:'fixture-agent-sessions'};
const COMMAND_CONTEXT = {invokedFunctionArn:`arn:aws:lambda:ap-northeast-2:${ACCOUNT}:function:fixture-agent:live`};
const requestId='cloud-fixture-request-001';
const post = (body = {message:'합성 사례의 준비 상태를 확인해 주세요.',requestId},path = '/api/agent') => ({method:'POST',path,headers:{'content-type':'application/json'},body});
const parse = response => JSON.parse(response.body);
const secret = (extra = {}) => ({ARN,SecretString:JSON.stringify({OPENAI_API_KEY:KEY}),$metadata:{httpStatusCode:200},...extra});
const safeError = error => error.code === 'CLOUD_RUNTIME_UNAVAILABLE' && error.status === 503 && ![KEY,ARN,'PRIVATE','AccessDenied','OPENAI_API_KEY'].some(part => error.message.includes(part));
function fixture(extra = {}) {
  const secretsCalls=[],storeCalls=[],modelCalls=[];
  const memory=createMemorySessionStore();
  const store={...memory,kind:'dynamodb'}; // 검사 전용 store adapter, 실제 DynamoDB 접근 없음.
  const client={send:async () => {throw new Error('실제 DynamoDB 호출 금지');}};
  const getRuntime=createCloudRuntimeGetter({env:{...ENV},documentClient:client,secretsClient:{async send(command,options) {secretsCalls.push({command,options});return secret();}},storeFactory:options=>{storeCalls.push(options);return store;},fetchImpl:async(url,options)=>{modelCalls.push({url,options});return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'합성 상태를 확인했습니다.'}]}]});},...extra});
  return {getRuntime,secretsCalls,storeCalls,modelCalls,store,memory,client};
}

test('ARN이 없으면 기존 local factory를 사용하고 키 없는 API는503·preview는200이다',async()=>{
  let secrets=0,stores=0;
  const getRuntime=createCloudRuntimeGetter({env:{},secretsClient:{send:async()=>{secrets++;throw new Error('금지');}},storeFactory:()=>{stores++;throw new Error('금지');},fetchImpl:()=>{throw new Error('유료 호출 금지');}});
  const handler=createCloudAgentRequestHandler({getRuntime});
  assert.equal(parse(await handler({method:'GET',path:'/api/agent/capabilities'})).llm,false);
  assert.equal(parse(await handler(post())).error.code,'MODEL_NOT_CONNECTED');
  const preview=await handler(post({scenarioId:'aewol-parent-visit',requestId},'/api/agent/preview'));
  assert.equal(preview.statusCode,200);assert.equal(parse(preview).isPreview,true);
  assert.equal(secrets,0);assert.equal(stores,0);
});

test('local key 구성은 여전히 sync factory 경로와 선택 모델을 유지한다',async()=>{
  let called=0;
  const getRuntime=createCloudRuntimeGetter({env:{OPENAI_API_KEY:KEY,OPENAI_MODEL:'gpt-6.1-terra'},fetchImpl:async(_url,options)=>{called++;assert.equal(JSON.parse(options.body).model,'gpt-6.1-terra');return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'local fixture'}]}]});}});
  const service=await getRuntime();assert.equal(service.getCapabilities().llm,true);assert.equal(called,0);
  assert.equal((await service.handleAgentRequest(post())).statusCode,200);assert.equal(called,1);
});

test('cloud는 store와 secret을 lazy 구성하고 정확한 ARN/AWSCURRENT 및 SDK abortSignal을 사용한다',async()=>{
  const f=fixture();assert.equal(f.secretsCalls.length,0);assert.equal(f.storeCalls.length,0);
  const runtime=await f.getRuntime();
  assert.equal(runtime.getCapabilities().llm,true);assert.equal(runtime.getCapabilities().model,'gpt-6.1-sol');assert.equal(f.modelCalls.length,0);
  assert.deepEqual(f.secretsCalls[0].command.input,{SecretId:ARN,VersionStage:'AWSCURRENT'});
  assert.ok(f.secretsCalls[0].options.abortSignal instanceof AbortSignal);
  assert.deepEqual(f.storeCalls[0],{client:f.client,tableName:ENV.SESSION_TABLE_NAME,region:'ap-northeast-2'});
  assert.equal(Object.hasOwn(f.storeCalls[0],'signal'),false);
});

test('concurrent 및 warm 조회는 한 secret/provider instance를 공유한다',async()=>{
  const f=fixture();const [a,b]=await Promise.all([f.getRuntime(),f.getRuntime()]);assert.equal(a,b);
  assert.equal(await f.getRuntime(),a);assert.equal(f.secretsCalls.length,1);assert.equal(f.storeCalls.length,1);assert.equal(f.modelCalls.length,0);
});

test('누락 store·다른 region·partial ARN·잘못된 account binding은 secret fetch 전에 거절한다',async()=>{
  for(const env of [
    {...ENV,SESSION_TABLE_NAME:''},{...ENV,SESSION_TABLE_NAME:'arn:aws:dynamodb:table/x'},
    {...ENV,AWS_REGION:'ap-northeast-1'},{...ENV,OPENAI_SECRET_ARN:'fixture/openai-token'},
    {...ENV,OPENAI_SECRET_ARN:ARN.replace(ACCOUNT,'999999999999')},{...ENV,AWS_ACCOUNT_ID:'999999999999'},
    {...ENV,AWS_ACCOUNT_ID:''},{...ENV,OPENAI_SECRET_ARN:ARN+'*'},{...ENV,OPENAI_SECRET_ARN:' '},
  ]) {
    const f=fixture({env});await assert.rejects(f.getRuntime(),safeError);assert.equal(f.secretsCalls.length,0);assert.equal(f.storeCalls.length,0);
  }
});

test('명시 account 또는 Lambda account로 binding하며 warm cache에도 caller account를 확인한다',async()=>{
  const f=fixture({env:{...ENV,AWS_ACCOUNT_ID:undefined}});
  await assert.rejects(f.getRuntime(),safeError);
  const a=await f.getRuntime({accountId:ACCOUNT});assert.equal(a.getCapabilities().llm,true);
  await assert.rejects(f.getRuntime({accountId:'999999999999'}),safeError);
  assert.equal(await f.getRuntime({accountId:ACCOUNT}),a);assert.equal(f.secretsCalls.length,1);
  const mismatch=fixture({expectedAccountId:'999999999999'});await assert.rejects(mismatch.getRuntime(),safeError);assert.equal(mismatch.secretsCalls.length,0);
});

test('cloud ARN이 있으면 plaintext env key를 읽거나 실패 시 대체하지 않는다',async()=>{
  const env={...ENV};Object.defineProperty(env,'OPENAI_API_KEY',{get(){throw new Error('PRIVATE plaintext read forbidden');}});
  const f=fixture({env});assert.equal((await f.getRuntime()).getCapabilities().llm,true);
  const denied=fixture({env,secretsClient:{async send(){throw new Error('PRIVATE secret access denied');}}});
  await assert.rejects(denied.getRuntime(),safeError);assert.equal(denied.modelCalls.length,0);
});

test('SecretString은 정확한 한 key JSON·동일 ARN만 허용한다',async()=>{
  for(const value of [
    secret({ARN:ARN.replace('Ab12Cd','Xy12Zz')}),secret({SecretString:'PRIVATE invalid JSON'}),
    secret({SecretString:JSON.stringify({OPENAI_API_KEY:KEY,extra:'PRIVATE'})}),secret({SecretString:JSON.stringify({OPENAI_API_KEY:''})}),
    secret({SecretString:JSON.stringify({OPENAI_API_KEY:'your_api_key_here'})}),secret({SecretString:JSON.stringify({OPENAI_API_KEY:123})}),
    secret({SecretString:JSON.stringify({OPENAI_API_KEY:'fixture\nPRIVATE'})}),secret({SecretString:JSON.stringify({OPENAI_API_KEY:'x'.repeat(1025)})}),
    secret({SecretString:'x'.repeat(4097)}),secret({SecretBinary:new Uint8Array([1,2])}),secret({$metadata:{httpStatusCode:403}}),secret({VersionStages:['AWSPREVIOUS']}),
  ]) {
    const f=fixture({secretsClient:{async send(){return value;}}});await assert.rejects(f.getRuntime(),safeError);assert.equal(f.modelCalls.length,0);
  }
});

test('store가 memory이거나 불완전하거나 생성 실패하면 secret과 paid provider를 구성하지 않는다',async()=>{
  for(const storeFactory of [()=>createMemorySessionStore(),()=>({kind:'dynamodb'}),()=>{throw new Error('PRIVATE store sdk error');}]) {
    const f=fixture({storeFactory});await assert.rejects(f.getRuntime(),safeError);assert.equal(f.secretsCalls.length,0);assert.equal(f.modelCalls.length,0);
  }
});

test('secret 접근 실패 promise는 제거되어 다음 요청에서 복구·warm cache된다',async()=>{
  let attempts=0;
  const f=fixture({secretsClient:{async send(){attempts++;if(attempts===1)throw new Error('PRIVATE AccessDenied '+KEY+' '+ARN);return secret();}}});
  await assert.rejects(f.getRuntime(),safeError);const runtime=await f.getRuntime();assert.equal(runtime.getCapabilities().llm,true);
  assert.equal(await f.getRuntime(),runtime);assert.equal(attempts,2);assert.equal(f.modelCalls.length,0);
});

test('setup timeout은 무응답 SDK도 중단하고 재시도 가능하다',async()=>{
  let attempts=0,signal;
  const f=fixture({setupTimeoutMs:20,secretsClient:{async send(_command,options){signal=options.abortSignal;attempts++;if(attempts===1)return new Promise(()=>{});return secret();}}});
  await assert.rejects(f.getRuntime(),safeError);assert.equal(signal.aborted,true);
  assert.equal((await f.getRuntime()).getCapabilities().llm,true);assert.equal(attempts,2);
  const blocked=fixture({setupTimeoutMs:20,storeFactory:()=>new Promise(()=>{})});await assert.rejects(blocked.getRuntime(),safeError);assert.equal(blocked.secretsCalls.length,0);
});

test('초기화 실패 때 caps는llmfalse·preview는200이며 일반 요청만 안전한503이다',async()=>{
  let attempts=0;
  const f=fixture({secretsClient:{async send(){attempts++;throw new Error('PRIVATE secret '+KEY+' '+ARN);}}});
  const handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime,config:{revision:'cloud-fixture-revision'}});
  const preview=await handle(post({scenarioId:'aewol-parent-visit',requestId},'/api/agent/preview'),COMMAND_CONTEXT);
  assert.equal(preview.statusCode,200);assert.equal(parse(preview).capabilities.llm,false);assert.equal(attempts,0);
  const caps=await handle({method:'GET',path:'/api/agent/capabilities'},COMMAND_CONTEXT);
  assert.equal(caps.statusCode,200);assert.equal(parse(caps).llm,false);assert.equal(parse(caps).phone,'simulation');assert.equal(parse(caps).revision,'cloud-fixture-revision');
  const failure=await handle(post(),COMMAND_CONTEXT);assert.equal(failure.statusCode,503);assert.equal(parse(failure).error.code,'CLOUD_RUNTIME_UNAVAILABLE');assert.equal(parse(failure).requestId,requestId);
  assert.equal(failure.headers['cache-control'],'no-store');
  for(const token of [KEY,ARN,'PRIVATE','AccessDenied']) assert.equal(failure.body.includes(token),false);
  assert.equal(attempts,2);assert.equal(f.modelCalls.length,0);
});

test('잘못된 HTTP 입력·method·preview는 secret 조회 없이 기존 DTO 검증을 유지한다',async()=>{
  let calls=0;const handle=createCloudAgentRequestHandler({getRuntime:async()=>{calls++;throw new Error('must not access');}});
  for(const [input,status] of [
    [post('{PRIVATE broken'),400],[post({message:'',requestId}),400],[post({message:'ok',requestId,caseState:{}}),400],
    [{...post(),headers:{'content-type':'text/plain'}},415],[{method:'DELETE',path:'/api/agent'},405],
    [{method:'GET',path:'/api/unknown'},404],[post({scenarioId:'bad',requestId},'/api/agent/preview'),400],
  ]) assert.equal((await handle(input)).statusCode,status);
  assert.equal(calls,0);
});

test('Lambda HTTPv2/context·base64 wrapper로 cloud runtime과 실제 도구 loop를 연결한다',async()=>{
  const operations=[],memory=createMemorySessionStore();
  const store={kind:'dynamodb',...Object.fromEntries(['loadOrCreate','acquire','release','save','consumeTurn'].map(name=>[name,async(...args)=>{operations.push(name);return memory[name](...args);}]))};
  const sent=[];
  const f=fixture({storeFactory:()=>store,fetchImpl:async(_url,options)=>{
    sent.push(JSON.parse(options.body));assert.ok(operations.includes('consumeTurn'));
    if(sent.length===1)return Response.json({status:'completed',output:[{id:'rs_cloud',type:'reasoning',summary:[],encrypted_content:'PRIVATE_REASONING_FIXTURE'},{id:'fc_cloud',type:'function_call',call_id:'cloud_call',name:'get_case',arguments:'{}'}]});
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'합성 사례를 확인했습니다.'}]}]});
  }});
  const handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime});const lambda=createLambdaHandler(handle);
  const result=await lambda({rawPath:'/api/agent',requestContext:{http:{method:'POST'}},isBase64Encoded:true,body:Buffer.from(JSON.stringify(post().body)).toString('base64')},COMMAND_CONTEXT);
  assert.equal(result.statusCode,200);const body=parse(result);assert.equal(body.events[0].tool,'get_case');assert.equal(body.capabilities.llm,true);
  assert.deepEqual(operations.slice(0,4),['loadOrCreate','acquire','loadOrCreate','consumeTurn']);assert.ok(operations.includes('save'));assert.ok(operations.includes('release'));
  assert.equal(sent.length,2);assert.equal(sent[1].input.some(item=>item.type==='function_call_output' && item.call_id==='cloud_call'),true);
  assert.equal(result.body.includes(KEY),false);assert.equal(result.body.includes('PRIVATE_REASONING_FIXTURE'),false);assert.equal(JSON.stringify(memory.inspect()).includes(KEY),false);
  const oversized=await lambda({rawPath:'/api/agent',requestContext:{http:{method:'POST'}},isBase64Encoded:true,body:'x'.repeat(33000)},COMMAND_CONTEXT);assert.equal(oversized.statusCode,413);
});

test('실제 store 단계 오류·공유 budget 거절은 모델 fetch 이전에 실패한다',async()=>{
  for(const failure of ['loadOrCreate','consumeTurn']) {
    const memory=createMemorySessionStore();
    const store={...memory,kind:'dynamodb',[failure]:async()=>{if(failure==='consumeTurn')throw new AgentError('DAILY_LIMIT','오늘의 한도에 도달했습니다.',429);throw new Error('PRIVATE DDB unavailable '+KEY);}};
    const f=fixture({storeFactory:()=>store});const handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime});
    const result=await handle(post(),COMMAND_CONTEXT);assert.equal(result.statusCode,failure==='consumeTurn'?429:503);assert.equal(f.modelCalls.length,0);assert.equal(result.body.includes('PRIVATE'),false);assert.equal(result.body.includes(KEY),false);
  }
});

test('Lambda context ARN 형식·region이 맞지 않으면 getter를 호출하지 않는다',async()=>{
  let calls=0;const handle=createCloudAgentRequestHandler({getRuntime:async()=>{calls++;throw new Error('must not call');}});
  for(const context of [{invokedFunctionArn:'PRIVATE invalid arn'},{invokedFunctionArn:`arn:aws:lambda:ap-northeast-1:${ACCOUNT}:function:fixture`}]) {
    const result=await handle(post(),context);assert.equal(result.statusCode,503);assert.equal(parse(result).error.code,'CLOUD_RUNTIME_UNAVAILABLE');
  }
  assert.equal(calls,0);
});

test('runtime factory 실패는 원문 없이 정리하고 invalid setup 옵션도 안전하게 거절한다',async()=>{
  const f=fixture({runtimeFactory:()=>{throw new Error('PRIVATE factory credential '+KEY);}});await assert.rejects(f.getRuntime(),safeError);
  for(const options of [{setupTimeoutMs:0},{setupTimeoutMs:10001},{storeFactory:null},{runtimeFactory:null}]) assert.throws(()=>createCloudRuntimeGetter(options),safeError);
});


test('기본 DocumentClient를 구성해도 store factory/상태 조회에서는 AWS·모델 요청을 보내지 않는다',async()=>{
  const f=fixture({documentClient:undefined});
  const service=await f.getRuntime();assert.equal(service.getCapabilities().llm,true);
  assert.equal(typeof f.storeCalls[0].client.send,'function');assert.notEqual(f.storeCalls[0].client,f.client);
  assert.equal(f.secretsCalls.length,1);assert.equal(f.modelCalls.length,0);
});

test('Lambda의 실제 account와 CF env account가 다르면 secret fetch 없이 거절한다',async()=>{
  const f=fixture(),handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime});
  const result=await handle(post(),{invokedFunctionArn:'arn:aws:lambda:ap-northeast-2:999999999999:function:fixture-agent'});
  assert.equal(result.statusCode,503);assert.equal(parse(result).error.code,'CLOUD_RUNTIME_UNAVAILABLE');
  assert.equal(f.secretsCalls.length,0);assert.equal(f.storeCalls.length,0);assert.equal(f.modelCalls.length,0);
});

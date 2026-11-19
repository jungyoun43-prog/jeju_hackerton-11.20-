import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudRuntimeGetter, createCloudAgentRequestHandler } from '../agent/cloud-runtime.mjs';
import { createLambdaHandler } from '../agent/handler.mjs';
import { createMemorySessionStore } from '../agent/store.mjs';
import { createRuntimeAgent } from '../agent/config.mjs';
import { AgentError } from '../agent/errors.mjs';
import { createProgressReporter, progressKey } from '../agent/progress.mjs';
import { visitSessionId } from '../agent/visit-recovery.mjs';
import { createDemoCase } from '../app/domain.js';

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
  const getRuntime=createCloudRuntimeGetter({env:{OPENAI_API_KEY:KEY,OPENAI_MODEL:'gpt-6.1-terra',AWS_PROFILE:'fixture-profile',AWS_REGION:'ap-northeast-2'},runtimeFactory:options=>createRuntimeAgent({...options,usageStore:createMemorySessionStore()}),fetchImpl:async(_url,options)=>{called++;assert.equal(JSON.parse(options.body).model,'gpt-6.1-terra');return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'local fixture'}]}]});}});
  const service=await getRuntime();assert.equal(service.getCapabilities().llm,true);assert.equal(called,0);
  assert.equal((await service.handleAgentRequest(post())).statusCode,200);assert.equal(called,1);
});

test('cloud는 store와 secret을 lazy 구성하고 정확한 ARN/AWSCURRENT 및 SDK abortSignal을 사용한다',async()=>{
  const f=fixture();assert.equal(f.secretsCalls.length,0);assert.equal(f.storeCalls.length,0);
  const runtime=await f.getRuntime();
  assert.equal(runtime.getCapabilities().llm,true);assert.equal(Object.hasOwn(runtime.getCapabilities(),'model'),false);assert.equal(f.modelCalls.length,0);
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
  const store={kind:'dynamodb',...Object.fromEntries(['loadOrCreate','acquire','release','save','consumeTurn','consumeModelCall'].map(name=>[name,async(...args)=>{operations.push(name);return memory[name](...args);}]))};
  const sent=[];
  const f=fixture({storeFactory:()=>store,fetchImpl:async(_url,options)=>{
    sent.push(JSON.parse(options.body));assert.ok(operations.includes('consumeTurn'));
    if(sent.length===1)return Response.json({status:'completed',output:[{id:'rs_cloud',type:'reasoning',summary:[],encrypted_content:'PRIVATE_REASONING_FIXTURE'},{id:'fc_cloud',type:'function_call',call_id:'cloud_call',name:'get_case',arguments:'{}'}]});
    return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'합성 사례를 확인했습니다.'}]}]});
  }});
  const handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime});const lambda=createLambdaHandler(handle);
  const result=await lambda({rawPath:'/api/agent',requestContext:{http:{method:'POST'}},isBase64Encoded:true,body:Buffer.from(JSON.stringify(post().body)).toString('base64')},COMMAND_CONTEXT);
  assert.equal(result.statusCode,200);const body=parse(result);assert.equal(body.events[0].tool,'get_case');assert.equal(body.capabilities.llm,true);
  assert.deepEqual(operations.slice(0,5),['loadOrCreate','acquire','loadOrCreate','save','consumeTurn']);assert.ok(operations.includes('save'));assert.ok(operations.includes('release'));
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


test('Lambda env에서 ARN이 없으면 plaintext key를 읽거나 local factory를 구성하지 않는다',async()=>{
  let factoryCalls=0,modelCalls=0;
  const env={AWS_LAMBDA_FUNCTION_NAME:'fixture-agent',AWS_REGION:'ap-northeast-2'};
  Object.defineProperty(env,'OPENAI_API_KEY',{get(){throw new Error('PRIVATE plaintext key read forbidden');}});
  const getRuntime=createCloudRuntimeGetter({env,runtimeFactory:()=>{factoryCalls++;throw new Error('local factory forbidden');},fetchImpl:()=>{modelCalls++;throw new Error('paid fetch forbidden');}});
  await assert.rejects(getRuntime(),safeError);
  assert.equal(factoryCalls,0);assert.equal(modelCalls,0);
});

test('Lambda context가 있으면 ARN 누락을503/capsfalse로 처리하고 preview는 유지한다',async()=>{
  let factoryCalls=0,modelCalls=0;
  const getRuntime=createCloudRuntimeGetter({env:{OPENAI_API_KEY:KEY,AWS_REGION:'ap-northeast-2'},runtimeFactory:()=>{factoryCalls++;throw new Error('local factory forbidden');},fetchImpl:()=>{modelCalls++;throw new Error('paid fetch forbidden');}});
  const handle=createCloudAgentRequestHandler({getRuntime});
  const failure=await handle(post(),COMMAND_CONTEXT);
  assert.equal(failure.statusCode,503);assert.equal(parse(failure).error.code,'CLOUD_RUNTIME_UNAVAILABLE');
  const caps=await handle({method:'GET',path:'/api/agent/capabilities'},COMMAND_CONTEXT);
  assert.equal(caps.statusCode,200);assert.equal(parse(caps).llm,false);
  const preview=await handle(post({scenarioId:'aewol-parent-visit',requestId},'/api/agent/preview'),COMMAND_CONTEXT);
  assert.equal(preview.statusCode,200);assert.equal(parse(preview).isPreview,true);
  assert.equal(factoryCalls,0);assert.equal(modelCalls,0);
});

test('이미 구성한 local warm cache도 ARN 없는 Lambda 호출에는 재사용하지 않는다',async()=>{
  let modelCalls=0;
  const env={OPENAI_API_KEY:KEY,AWS_PROFILE:'fixture-profile',AWS_REGION:'ap-northeast-2'};
  const getRuntime=createCloudRuntimeGetter({env,fetchImpl:()=>{modelCalls++;throw new Error('paid fetch forbidden');}});
  const local=await getRuntime();assert.equal(local.getCapabilities().llm,true);
  await assert.rejects(getRuntime({accountId:ACCOUNT}),safeError);
  env.AWS_LAMBDA_FUNCTION_NAME='fixture-agent';await assert.rejects(getRuntime(),safeError);
  assert.equal(modelCalls,0);
});

test('cloud 진행 조회는 cold runtime에서도 DynamoDB Get만 수행하고 secret·provider·세션을 구성하지 않는다',async()=>{
  const calls=[];let secrets=0,factories=0;
  const getRuntime=createCloudRuntimeGetter({env:{...ENV},documentClient:{async send(command,options){calls.push({command,options});return {};}},
    secretsClient:{async send(){secrets++;throw new Error('PRIVATE secret forbidden');}},runtimeFactory(){factories++;throw new Error('모델 runtime 구성 금지');}});
  const handle=createCloudAgentRequestHandler({getRuntime}),progressToken='p'.repeat(43);
  const result=await handle(post({progressToken},'/api/agent/progress'),COMMAND_CONTEXT);
  assert.equal(result.statusCode,200);assert.deepEqual(parse(result),{available:false,progress:null});
  assert.equal(secrets,0);assert.equal(factories,0);assert.equal(calls.length,1);
  assert.equal(calls[0].command.constructor.name,'GetCommand');
  assert.deepEqual(calls[0].command.input,{TableName:ENV.SESSION_TABLE_NAME,Key:{pk:progressKey(progressToken)},ConsistentRead:true});
  assert.ok(calls[0].options.abortSignal instanceof AbortSignal);assert.equal(JSON.stringify(calls[0].command.input).includes(progressToken),false);
});

test('진행 전용 cloud runtime은 합성 준비 DTO만 읽고 원문·secret 오류를 반환하지 않는다',async()=>{
  const memory=createMemorySessionStore(),progressToken='u'.repeat(43),reporter=createProgressReporter({store:memory,token:progressToken});
  reporter.started('request_hospital_contact',{target:'mainland',query:'PRIVATE'});await reporter.flush();
  const operations=[];
  const store={kind:'dynamodb',...Object.fromEntries(['loadOrCreate','acquire','release','save','consumeTurn','consumeModelCall'].map(name=>[name,()=>{throw new Error('core store 접근 금지');}])),
    async readProgress(...args){operations.push('read');return memory.readProgress(...args);},writeProgress(){throw new Error('poll write 금지');}};
  const f=fixture({storeFactory:()=>store,secretsClient:{async send(){throw new Error('PRIVATE secret forbidden');}},runtimeFactory(){throw new Error('provider 구성 금지');}});
  const handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime});
  const result=await handle(post({progressToken},'/api/agent/progress'),COMMAND_CONTEXT);
  assert.equal(result.statusCode,200);assert.equal(parse(result).available,true);assert.equal(parse(result).progress.currentStage,'hospitals');
  assert.deepEqual(operations,['read']);assert.equal(f.modelCalls.length,0);assert.equal(result.body.includes('PRIVATE'),false);assert.equal(result.body.includes(progressToken),false);
});

test('진행 조회의 잘못된 token·항목·method·content-type은 getter와 DB보다 먼저 거절된다',async()=>{
  let calls=0;const handle=createCloudAgentRequestHandler({getRuntime:async()=>{calls++;throw new Error('금지');}});
  const progressToken='v'.repeat(43);
  for(const [input,status] of [
    [post({progressToken:'bad'},'/api/agent/progress'),400],[post({progressToken,sessionId:'PRIVATE'},'/api/agent/progress'),400],
    [post({},'/api/agent/progress'),400],[{method:'GET',path:'/api/agent/progress'},405],
    [{...post({progressToken},'/api/agent/progress'),headers:{'content-type':'text/plain'}},415],
  ])assert.equal((await handle(input,COMMAND_CONTEXT)).statusCode,status);
  assert.equal(calls,0);
});

test('secret 초기화가 진행 중이어도 별도 poll은 기다리지 않고 DB만 읽는다',async t=>{
  let releaseSecret,secretEntered;const gate=new Promise(resolve=>{releaseSecret=resolve;}),entered=new Promise(resolve=>{secretEntered=resolve;});
  t.after(()=>releaseSecret());
  let secretCalls=0;
  const f=fixture({secretsClient:{async send(){secretCalls++;secretEntered();await gate;return secret();}}});
  const handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime});
  const normal=handle(post(),COMMAND_CONTEXT);await entered;
  const result=await handle(post({progressToken:'w'.repeat(43)},'/api/agent/progress'),COMMAND_CONTEXT);
  assert.equal(result.statusCode,200);assert.deepEqual(parse(result),{available:false,progress:null});assert.equal(secretCalls,1);assert.equal(f.modelCalls.length,0);
  releaseSecret();assert.equal((await normal).statusCode,200);assert.equal(secretCalls,1);assert.equal(f.modelCalls.length,1);
});

test('진행 store 초기화 timeout은200 unavailable로 끝나고 다음 시도에 다시 구성한다',async()=>{
  let stores=0,secrets=0,factories=0;
  const memory={...createMemorySessionStore(),kind:'dynamodb'};
  const getRuntime=createCloudRuntimeGetter({env:{...ENV},documentClient:{send(){throw new Error('금지');}},storeFactory(){stores++;return stores===1?new Promise(()=>{}):memory;},secretsClient:{async send(){secrets++;throw new Error('금지');}},runtimeFactory(){factories++;throw new Error('금지');}});
  const handle=createCloudAgentRequestHandler({getRuntime}),input=post({progressToken:'x'.repeat(43)},'/api/agent/progress'),start=performance.now();
  assert.deepEqual(parse(await handle(input,COMMAND_CONTEXT)),{available:false,progress:null});assert.ok(performance.now()-start<800);
  assert.deepEqual(parse(await handle(input,COMMAND_CONTEXT)),{available:false,progress:null});assert.equal(stores,2);assert.equal(secrets,0);assert.equal(factories,0);
});

test('cold local poll·ARN 누락 cloud poll은 env 키나 runtime factory를 읽지 않는다',async()=>{
  const env={};Object.defineProperty(env,'OPENAI_API_KEY',{get(){throw new Error('PRIVATE key read forbidden');}});
  let factories=0;
  const getRuntime=createCloudRuntimeGetter({env,runtimeFactory(){factories++;throw new Error('구성 금지');}});
  const handle=createCloudAgentRequestHandler({getRuntime}),input=post({progressToken:'y'.repeat(43)},'/api/agent/progress');
  assert.deepEqual(parse(await handle(input)),{available:false,progress:null});
  assert.deepEqual(parse(await handle(input,COMMAND_CONTEXT)),{available:false,progress:null});assert.equal(factories,0);
});


test('cold cloud 복구는 Secret/provider/lease/budget 없이 검증된 세션 Get 한 번만 실행한다',async()=>{
  const visitToken='r'.repeat(43),sessionId=visitSessionId(visitToken),state=createDemoCase(),expiresAt=Math.floor(Date.now()/1000)+3600,at=Date.now();
  const calls=[];let secrets=0,factories=0;
  const row={pk:`session#${sessionId}`,sessionId,state,turns:1,requestIds:[requestId],requestReceipts:[{requestId,digest:'a'.repeat(64),status:'completed',at}],expiresAt};
  const getRuntime=createCloudRuntimeGetter({env:{...ENV},documentClient:{async send(command){calls.push(command);return {Item:structuredClone(row)};}},secretsClient:{async send(){secrets++;throw new Error('PRIVATE forbidden secret');}},runtimeFactory(){factories++;throw new Error('provider 구성 금지');}});
  const handle=createCloudAgentRequestHandler({getRuntime}),result=await handle(post({visitToken},'/api/agent/resume'),COMMAND_CONTEXT),value=parse(result);
  assert.equal(result.statusCode,200);assert.equal(value.sessionId,sessionId);assert.deepEqual(value.caseState,state);assert.equal(value.recovery.savedAt,new Date(at).toISOString());assert.equal(value.recovery.expiresAt,expiresAt);
  assert.equal(secrets,0);assert.equal(factories,0);assert.equal(calls.length,1);assert.equal(calls[0].constructor.name,'GetCommand');
  assert.deepEqual(calls[0].input,{TableName:ENV.SESSION_TABLE_NAME,Key:{pk:`session#${sessionId}`},ConsistentRead:true});
  for(const raw of [visitToken,KEY,ARN])assert.equal(result.body.includes(raw),false);
});

test('cloud 복구 입력 오류는 getter 전에 거절하고 저장소 오류를 만료404로 바꾸지 않는다',async()=>{
  let calls=0;const handle=createCloudAgentRequestHandler({getRuntime:async()=>{calls++;throw new Error('PRIVATE store unavailable');}}),visitToken='s'.repeat(43);
  for(const [input,status] of [[post({},'/api/agent/resume'),400],[post({visitToken:'bad'},'/api/agent/resume'),400],[post({visitToken,sessionId:'PRIVATE'},'/api/agent/resume'),400],[{method:'GET',path:'/api/agent/resume'},405],[{...post({visitToken},'/api/agent/resume'),headers:{'content-type':'text/plain'}},415]])assert.equal((await handle(input,COMMAND_CONTEXT)).statusCode,status);
  assert.equal(calls,0);const failure=await handle(post({visitToken},'/api/agent/resume'),COMMAND_CONTEXT);
  assert.equal(failure.statusCode,503);assert.equal(parse(failure).error.code,'SESSION_STORE_UNAVAILABLE');assert.equal(failure.body.includes('PRIVATE'),false);assert.equal(calls,1);
});

test('cold local 복구와 ARN 없는 Lambda 복구는 키/runtime 초기화를 시작하지 않는다',async()=>{
  let factories=0;const env={};Object.defineProperty(env,'OPENAI_API_KEY',{get(){throw new Error('PRIVATE key read forbidden');}});
  const getRuntime=createCloudRuntimeGetter({env,runtimeFactory(){factories++;throw new Error('runtime 구성 금지');}}),handle=createCloudAgentRequestHandler({getRuntime}),input=post({visitToken:'t'.repeat(43)},'/api/agent/resume');
  assert.equal((await handle(input)).statusCode,404);const cloud=await handle(input,COMMAND_CONTEXT);assert.equal(cloud.statusCode,503);assert.equal(parse(cloud).error.code,'SESSION_STORE_UNAVAILABLE');assert.equal(factories,0);
});

test('Secret 초기화가 진행 중이어도 방문 복구는 기다리지 않고 기존 저장소만 읽는다',async t=>{
  let entered,release;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{entered=resolve;});
  t.after(()=>release());let secretCalls=0;
  const f=fixture({secretsClient:{async send(){secretCalls++;entered();await gate;return secret();}}}),visitToken='u'.repeat(43);
  const saved=await f.memory.loadOrCreate(undefined,{initialSessionId:visitSessionId(visitToken)});
  const handle=createCloudAgentRequestHandler({getRuntime:f.getRuntime}),normal=handle(post(),COMMAND_CONTEXT);await started;
  const recovered=await handle(post({visitToken},'/api/agent/resume'),COMMAND_CONTEXT);
  assert.equal(recovered.statusCode,200);assert.equal(parse(recovered).sessionId,saved.sessionId);assert.equal(secretCalls,1);assert.equal(f.modelCalls.length,0);
  release();assert.equal((await normal).statusCode,200);assert.equal(secretCalls,1);assert.equal(f.modelCalls.length,1);
});

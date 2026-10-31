import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIProvider } from '../agent/openai-provider.mjs';

const FAKE_KEY = 'unit-test-placeholder-credential';
const TOOL = {name:'get_case',description:'합성 상태 확인',inputSchema:{type:'object',properties:{area:{type:'string'}},required:[],additionalProperties:false}};
const TOOLS = [TOOL,{name:'update_visit',description:'일정 변경',inputSchema:{type:'object',properties:{date:{type:'string'}},required:[],additionalProperties:false}}];
const request = (extra = {}) => ({system:'검사 전용 정책',messages:[{role:'user',content:[{text:'합성 사례 요청'}]}],tools:TOOLS,...extra});
const textItem = text => ({type:'message',id:'msg_fixture',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]});
const functionItem = (extra = {}) => ({type:'function_call',id:'fc_fixture',call_id:'call_fixture',name:'get_case',arguments:'{}',status:'completed',...extra});
const reasoningItem = (extra = {}) => ({type:'reasoning',id:'rs_fixture',summary:[],encrypted_content:'PRIVATE_FIXTURE_ENCRYPTED_REASONING',...extra});
const completed = output => ({id:'resp_fixture',object:'response',status:'completed',output});
const jsonResponse = (body,status = 200,headers = {}) => new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json',...headers}});
const textResponse = text => jsonResponse(completed([textItem(text)]));
function scripted(responses,extra = {}) {
  const calls = [];
  const provider = createOpenAIProvider({apiKey:FAKE_KEY,...extra,fetchImpl:async (url,options) => {
    calls.push({url,options,body:JSON.parse(options.body)});
    assert.ok(responses.length,'검사용 fetch 응답이 부족합니다.');
    const result = responses.shift();
    return typeof result === 'function' ? result(url,options) : result;
  }});
  return {provider,calls};
}
const appendResults = (messages,output,ids = output.content.filter(block => block.toolUse).map(block => block.toolUse.toolUseId)) => [
  ...messages,{role:'assistant',content:output.content},{role:'user',content:ids.map(id => ({toolResult:{toolUseId:id,status:'success',content:[{json:{isSynthetic:true,event:'준비 상태'}}]}}))},
];
const safeCode = code => error => error.code === code && !/PRIVATE|unit-test-placeholder|Bearer|api\.openai\.com|encrypted_content/.test(error.message);

test('기본 Sol Responses 설정은 선택 모델·키를 사용하고 자동 대체/온도/서버 저장을 요청하지 않는다',async () => {
  const {provider,calls} = scripted([textResponse('합성 준비를 확인했습니다.')]);
  assert.equal(provider.connected,true); assert.equal(provider.model,'gpt-6.1-sol');
  const output = await provider.respond(request());
  assert.equal(output.stopReason,'end_turn'); assert.deepEqual(output.content,[{text:'합성 준비를 확인했습니다.'}]);
  const {url,options,body} = calls[0];
  assert.equal(url,'https://api.openai.com/v1/responses'); assert.equal(options.method,'POST');
  assert.equal(options.headers.authorization,`Bearer ${FAKE_KEY}`); assert.equal(options.headers['content-type'],'application/json');
  assert.equal(options.redirect,'error'); assert.equal(options.credentials,'omit'); assert.equal(options.cache,'no-store');
  assert.equal(body.model,'gpt-6.1-sol'); assert.equal(body.store,false); assert.equal(body.parallel_tool_calls,true);
  assert.equal(body.max_output_tokens,4096); assert.deepEqual(body.reasoning,{effort:'low'});
  assert.deepEqual(body.include,['reasoning.encrypted_content']); assert.equal(Object.hasOwn(body,'temperature'),false);
  assert.equal(Object.hasOwn(body,'previous_response_id'),false); assert.equal(Object.hasOwn(body,'conversation'),false);
  assert.deepEqual(body.tools[0],{type:'function',name:TOOL.name,description:TOOL.description,parameters:TOOL.inputSchema,strict:false});
  assert.deepEqual(body.tools[0].parameters.required,[]);
  assert.deepEqual(body.input,[{role:'user',content:'합성 사례 요청'}]); assert.equal(body.instructions,'검사 전용 정책');
  assert.equal(output.context.cursor,2); assert.equal(JSON.stringify(output.context).includes('PRIVATE'),false);
});

test('Terra와 추론 수준을 명시하면 그대로 사용하고 Sol none·다른 모델·잘못된 한도는 거절한다',async () => {
  const {provider,calls} = scripted([textResponse('Terra 검사')],{model:'gpt-6.1-terra',reasoningEffort:'none',maxOutputTokens:2048});
  await provider.respond(request()); assert.equal(calls[0].body.model,'gpt-6.1-terra'); assert.equal(calls[0].body.reasoning.effort,'none'); assert.equal(calls[0].body.max_output_tokens,2048);
  for (const extra of [{model:'gpt-other'},{model:'gpt-6.1-sol',reasoningEffort:'none'},{reasoningEffort:'ultra'},{maxOutputTokens:0},{maxOutputTokens:16385},{timeoutMs:0},{timeoutMs:45001},{apiKey:'token\nPRIVATE-header'},{fetchImpl:null}]) {
    assert.throws(() => createOpenAIProvider({apiKey:FAKE_KEY,fetchImpl:async () => {throw new Error('must not call');},...extra}),safeCode('MODEL_CONFIGURATION_INVALID'));
  }
});

test('빈 키는 미연결이며 인증 확인을 위한 네트워크 요청을 자동 실행하지 않는다',async () => {
  let count = 0;
  const provider = createOpenAIProvider({fetchImpl:async () => {count++; throw new Error('must not call');}});
  assert.equal(provider.connected,false); assert.equal(count,0);
  await assert.rejects(provider.respond(request()),safeCode('MODEL_NOT_CONNECTED')); assert.equal(count,0);
});

test('같은 turn의 reasoning 전체와 복수 function calls를 tool outputs와 함께 순서대로 replay한다',async () => {
  const rawItems = [reasoningItem({summary:[{type:'summary_text',text:'PRIVATE_FIXTURE_SUMMARY'}]}),functionItem({call_id:'call_first'}),textItem('합성 준비 정보를 확인합니다.'),functionItem({id:'fc_second',call_id:'call_second',name:'update_visit',arguments:'{"date":"2026-11-15"}'})];
  const {provider,calls} = scripted([jsonResponse(completed(rawItems)),textResponse('합성 날짜를 반영했습니다.')]);
  const firstRequest = request(),first = await provider.respond(firstRequest);
  assert.equal(first.stopReason,'tool_use'); assert.equal(first.content.filter(block => block.toolUse).length,2);
  assert.equal(first.content.some(block => block.text?.includes('PRIVATE')),false);
  assert.equal(JSON.stringify(first.context).includes('PRIVATE'),false);
  const messages = appendResults(firstRequest.messages,first);
  const second = await provider.respond(request({messages,context:first.context}));
  assert.equal(second.stopReason,'end_turn'); assert.equal(second.context.cursor,4);
  const input = calls[1].body.input;
  assert.deepEqual(input.slice(1,5),rawItems);
  assert.deepEqual(input.slice(5).map(item => ({type:item.type,call_id:item.call_id})),[{type:'function_call_output',call_id:'call_first'},{type:'function_call_output',call_id:'call_second'}]);
  assert.equal(JSON.parse(input[5].output).status,'success');
  assert.equal(input.filter(item => item.type === 'function_call').length,2);
  assert.equal(input.filter(item => item.type === 'message').length,1); // 정규화 assistant를 중복 append하지 않는다.
});

test('3번째 round에도 모든 reasoning과 원래 call_id를 유지하며 정규화 ID로 tool 결과를 대응시킨다',async () => {
  const rawId = 'call:nonstandard.id/한글';
  const items1 = [reasoningItem(),functionItem({call_id:rawId})];
  const items2 = [reasoningItem({id:'rs_second',encrypted_content:'PRIVATE_SECOND_REASONING'}),functionItem({id:'fc_second',call_id:'second-call',name:'update_visit',arguments:'{"date":"2026-11-20"}'})];
  const {provider,calls} = scripted([jsonResponse(completed(items1)),jsonResponse(completed(items2)),textResponse('완료')]);
  let messages = request().messages;
  const first = await provider.respond(request({messages}));
  const normalized = first.content[0].toolUse.toolUseId;
  assert.match(normalized,/^[A-Za-z0-9_-]{1,100}$/); assert.notEqual(normalized,rawId);
  messages = appendResults(messages,first);
  const second = await provider.respond(request({messages,context:first.context}));
  assert.equal(calls[1].body.input.at(-1).call_id,rawId);
  messages = appendResults(messages,second);
  await provider.respond(request({messages,context:second.context}));
  const replay = calls[2].body.input;
  assert.deepEqual(replay.slice(1,3),items1); assert.deepEqual(replay.slice(4,6),items2);
  assert.equal(replay.at(-1).call_id,'second-call');
  assert.equal(replay.filter(item => item.type === 'reasoning').length,2);
});

test('provider 전역에 대화 상태를 재사용하지 않고 새 turn에는 새 input만 보낸다',async () => {
  const {provider,calls} = scripted([jsonResponse(completed([reasoningItem(),functionItem()])),textResponse('새 요청')]);
  const first = await provider.respond(request()); assert.ok(first.context);
  await provider.respond(request({messages:[{role:'user',content:[{text:'별개의 새 요청'}]}]}));
  assert.deepEqual(calls[1].body.input,[{role:'user',content:'별개의 새 요청'}]);
  assert.equal(JSON.stringify(calls[1].body).includes('PRIVATE_FIXTURE'),false);
  assert.equal(JSON.stringify(calls[1].body).includes('call_fixture'),false);
});

test('context는 요청 내부 opaque handle이며 새 turn·다른 provider·위조 context를 거절한다',async () => {
  const {provider,calls} = scripted([jsonResponse(completed([reasoningItem(),functionItem()]))]);
  const first = await provider.respond(request());
  await assert.rejects(provider.respond(request({context:first.context})),safeCode('INVALID_PROVIDER_CONTEXT'));
  await assert.rejects(provider.respond(request({context:{cursor:2,input:'PRIVATE'}})),safeCode('INVALID_PROVIDER_CONTEXT'));
  const other = scripted([]).provider;
  await assert.rejects(other.respond(request({messages:appendResults(request().messages,first),context:first.context})),safeCode('INVALID_PROVIDER_CONTEXT'));
  assert.equal(calls.length,1);
});

test('tool 결과의 누락·중복·잘못된 id·prefix/assistant 변조는 후속 fetch 전에 거절한다',async () => {
  const {provider,calls} = scripted([jsonResponse(completed([functionItem()]))]);
  const first = await provider.respond(request()),valid = appendResults(request().messages,first);
  const mutations = [
    messages => {messages[0].content[0].text='다른 요청';},
    messages => {messages[1].content[0].toolUse.name='update_visit';},
    messages => {messages[2].content[0].toolResult.toolUseId='wrong-id';},
    messages => {messages[2].content.push(structuredClone(messages[2].content[0]));},
    messages => {messages[2].content[0].toolResult.status='completed';},
    messages => {messages[2].content[0]={text:'PRIVATE 새 대화'};},
    messages => {messages[2].role='assistant';},
  ];
  for (const mutate of mutations) {const messages=structuredClone(valid);mutate(messages);await assert.rejects(provider.respond(request({messages,context:first.context})),safeCode('INVALID_PROVIDER_CONTEXT'));}
  assert.equal(calls.length,1);
});

test('tool error 결과도 원래 call_id와 error 상태를 보존한다',async () => {
  const {provider,calls} = scripted([jsonResponse(completed([functionItem()])),textResponse('조건을 확인해 주세요.')]);
  const first = await provider.respond(request());
  const messages=appendResults(request().messages,first);messages[2].content[0].toolResult={toolUseId:'call_fixture',status:'error',content:[{json:{error:{code:'PERMISSION_REQUIRED',message:'위임 확인 필요'}}}]};
  await provider.respond(request({messages,context:first.context}));
  const result=JSON.parse(calls[1].body.input.at(-1).output); assert.equal(result.status,'error'); assert.equal(result.content[0].json.error.code,'PERMISSION_REQUIRED');
});

test('인증·권한·모델404는 안전한 미연결 오류로 정리하고 이후 재호출을 막는다',async () => {
  for (const status of [401,403,404]) {
    const {provider,calls} = scripted([jsonResponse({error:{message:'PRIVATE Bearer key/ARN/context'}},status)]);
    await assert.rejects(provider.respond(request()),safeCode('MODEL_NOT_CONNECTED')); assert.equal(provider.connected,false);
    await assert.rejects(provider.respond(request()),safeCode('MODEL_NOT_CONNECTED')); assert.equal(calls.length,1);
  }
});

test('429/과금 한도와 API500/400/redirect·network는 원문·키 없이 안전하게 실패하며 자동 재시도하지 않는다',async () => {
  for (const [status,code] of [[429,'MODEL_RATE_LIMITED'],[500,'MODEL_UNAVAILABLE'],[400,'MODEL_UNAVAILABLE'],[302,'MODEL_UNAVAILABLE']]) {
    const {provider,calls} = scripted([jsonResponse({error:{message:'PRIVATE account/billing/token'}},status)]);
    await assert.rejects(provider.respond(request()),safeCode(code)); assert.equal(calls.length,1); assert.equal(provider.connected,true);
  }
  const {provider,calls} = scripted([() => {throw new Error('PRIVATE Authorization Bearer credential context');}]);
  await assert.rejects(provider.respond(request()),safeCode('MODEL_UNAVAILABLE'));assert.equal(calls.length,1);
});

test('자체 timeout은 signal을 abort하고 fetch가 signal을 무시해도 제한 시간에 종료한다',async () => {
  let requestSignal;
  const {provider} = scripted([(_url,options) => {requestSignal=options.signal;return new Promise(() => {});}],{timeoutMs:20});
  await assert.rejects(provider.respond(request()),safeCode('AGENT_TIMEOUT'));assert.equal(requestSignal.aborted,true);
});

test('상위 controller 중단은 합성 signal로 전달되며 이미 중단된 요청은 fetch하지 않는다',async () => {
  const before=new AbortController();before.abort(new Error('PRIVATE cancellation reason'));
  const unused=scripted([]);await assert.rejects(unused.provider.respond(request({signal:before.signal})),safeCode('AGENT_TIMEOUT'));assert.equal(unused.calls.length,0);
  const controller=new AbortController();
  const {provider,calls} = scripted([(_url,options) => new Promise((_,reject) => {options.signal.addEventListener('abort',() => reject(new DOMException('PRIVATE aborted','AbortError')),{once:true});})]);
  const pending=provider.respond(request({signal:controller.signal}));setTimeout(() => controller.abort('PRIVATE reason'),10);
  await assert.rejects(pending,safeCode('AGENT_TIMEOUT'));assert.equal(calls[0].options.signal.aborted,true);
});

test('response body를 읽는 중 멈춰도 timeout을 적용하고 stream을 취소한다',async () => {
  let cancelled=false;
  const stream=new ReadableStream({start(controller) {controller.enqueue(new TextEncoder().encode('{"status":'));},cancel() {cancelled=true;}});
  const {provider}=scripted([new Response(stream,{headers:{'content-type':'application/json'}})],{timeoutMs:20});
  await assert.rejects(provider.respond(request()),safeCode('AGENT_TIMEOUT'));assert.equal(cancelled,true);
});

test('응답1MiB 상한은 content-length와 실제 stream 모두에 적용한다',async () => {
  const declared=scripted([jsonResponse(completed([textItem('ok')]),200,{'content-length':String(1024*1024+1)})]);
  await assert.rejects(declared.provider.respond(request()),safeCode('INVALID_MODEL_RESPONSE'));
  let cancelled=false;
  const huge=new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(1024*1024+1));},cancel() {cancelled=true;}});
  const streamed=scripted([new Response(huge,{headers:{'content-type':'application/json'}})]);
  await assert.rejects(streamed.provider.respond(request()),safeCode('INVALID_MODEL_RESPONSE'));assert.equal(cancelled,true);
});

test('잘못된 JSON·UTF8·HTML 응답·redirected 응답은 안전하게 거절한다',async () => {
  for(const response of [new Response('{PRIVATE invalid JSON',{headers:{'content-type':'application/json'}}),new Response(Uint8Array.of(0xff,0xfe),{headers:{'content-type':'application/json'}}),new Response('PRIVATE HTML',{headers:{'content-type':'text/html'}}),{status:200,redirected:true,body:{cancel:async()=>{}}}]) {
    const {provider}=scripted([response]);await assert.rejects(provider.respond(request()),safeCode('INVALID_MODEL_RESPONSE'));
  }
});

test('incomplete·failed·거절은 부분 tool calls나 raw refusal을 완료 결과로 사용하지 않는다',async () => {
  for (const [body,code] of [
    [{status:'incomplete',incomplete_details:{reason:'max_output_tokens PRIVATE'},output:[functionItem()]},'MODEL_INCOMPLETE'],
    [{status:'failed',error:{message:'PRIVATE failure'},output:[functionItem()]},'MODEL_UNAVAILABLE'],
    [completed([{...textItem('unused'),content:[{type:'refusal',refusal:'PRIVATE clinical refusal'}]}]),'MODEL_REFUSAL'],
  ]) {const {provider}=scripted([jsonResponse(body)]);await assert.rejects(provider.respond(request()),safeCode(code));}
});

test('정상 message/function/reasoning 외 output, 빈 텍스트와 긴 텍스트는 거절한다',async () => {
  for (const body of [
    completed([]),completed([reasoningItem()]),completed([textItem(' ')]),completed([textItem('가'.repeat(6001))]),
    completed([{type:'web_search_call',id:'PRIVATE'}]),completed([{type:'message',role:'user',content:[]}]),
    completed([{...textItem(''),content:[{type:'audio',data:'PRIVATE'}]}]),completed([{type:'reasoning',id:'rs',summary:'PRIVATE'}]),
    {...completed([textItem('ok')]),status:'unexpected'},
  ]) {const {provider}=scripted([jsonResponse(body)]);await assert.rejects(provider.respond(request()),safeCode('INVALID_MODEL_RESPONSE'));}
});

test('알 수 없는 tool·비객체/잘못된 JSON·긴 arguments·잘못된 call_id·9calls를 거절한다',async () => {
  for (const item of [
    functionItem({name:'RECORD_REVIEW'}),functionItem({arguments:'null'}),functionItem({arguments:'[]'}),functionItem({arguments:'PRIVATE invalid'}),functionItem({arguments:'{"x":"'+ 'x'.repeat(4096)+'"}'}),
    functionItem({arguments:{date:'2026-11-15'}}),functionItem({call_id:''}),functionItem({call_id:'PRIVATE\nheader'}),functionItem({call_id:'x'.repeat(257)}),functionItem({status:'in_progress'}),
  ]) {const {provider}=scripted([jsonResponse(completed([item]))]);await assert.rejects(provider.respond(request()),safeCode('INVALID_MODEL_RESPONSE'));}
  const {provider}=scripted([jsonResponse(completed(Array.from({length:9},(_,i)=>functionItem({call_id:'call_'+i}))))]);await assert.rejects(provider.respond(request()),safeCode('INVALID_MODEL_RESPONSE'));
});

test('같은 response의 중복 call_id와 다음 round에서 재사용된 call_id를 거절한다',async () => {
  const dup=scripted([jsonResponse(completed([functionItem(),functionItem()]))]);await assert.rejects(dup.provider.respond(request()),safeCode('INVALID_MODEL_RESPONSE'));
  const {provider}=scripted([jsonResponse(completed([functionItem()])),jsonResponse(completed([functionItem()]))]);
  const first=await provider.respond(request());await assert.rejects(provider.respond(request({messages:appendResults(request().messages,first),context:first.context})),safeCode('INVALID_MODEL_RESPONSE'));
});

test('신뢰할 수 없는 tool 정의·input shape는 네트워크 호출 전에 거절한다',async () => {
  const {provider,calls}=scripted([]);
  for(const tools of [[TOOL,TOOL],[{...TOOL,name:'PRIVATE invalid name'}],[{...TOOL,inputSchema:null}]]) await assert.rejects(provider.respond(request({tools})),safeCode('MODEL_CONFIGURATION_INVALID'));
  for(const messages of [[],[{role:'system',content:[{text:'PRIVATE'}]}],[{role:'user',content:[{toolResult:{}}]}]]) await assert.rejects(provider.respond(request({messages})),safeCode('INVALID_PROVIDER_CONTEXT'));
  assert.equal(calls.length,0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createConverseProvider } from '../agent/providers.mjs';
import { AGENT_TOOLS } from '../agent/tools.mjs';

const input = () => ({system:'검사 전용 system',messages:[{role:'user',content:[{text:'합성 준비 요청'}]}],tools:AGENT_TOOLS,signal:new AbortController().signal});

test('Converse 어댑터는 명시한 토큰 상한·도구 JSON schema·abortSignal을 SDK command로 전달한다',async () => {
  let sent,options;
  const client = {async send(command,requestOptions) {sent = command.input; options = requestOptions; return {output:{message:{role:'assistant',content:[{toolUse:{toolUseId:'lookup-1',name:'get_case',input:{}}}]}},stopReason:'tool_use'};}};
  const provider = createConverseProvider({client,modelId:'configured-test-profile',maxTokens:800});
  const request = input(),result = await provider.respond(request);
  assert.equal(sent.modelId,'configured-test-profile');
  assert.equal(sent.inferenceConfig.maxTokens,800);
  assert.equal(sent.toolConfig.tools[0].toolSpec.inputSchema.json.additionalProperties,false);
  assert.equal(options.abortSignal,request.signal);
  assert.equal(result.stopReason,'tool_use');
  assert.equal(result.content[0].toolUse.name,'get_case');
});

test('계정 접근 차단은 provider를 미연결 상태로 바꾸며 원래 에러를 노출하지 않는다',async () => {
  for (const error of [Object.assign(new Error('secret ARN access'),{name:'AccessDeniedException'}),Object.assign(new Error('Error 002: Access to Bedrock models is not allowed for this account private ARN'),{name:'ValidationException'})]) {
    const provider = createConverseProvider({client:{async send() {throw error;}},modelId:'test-profile'});
    await assert.rejects(provider.respond(input()),error => error.code === 'MODEL_NOT_CONNECTED' && !error.message.includes('ARN'));
    assert.equal(provider.connected,false);
  }
});

test('일반 SDK 실패와 중단·형식 오류를 정해진 공개 오류로 바꾼다',async () => {
  const clientFor = fn => createConverseProvider({client:{send:fn},modelId:'test-profile'});
  await assert.rejects(clientFor(async () => {throw new Error('SECRET_VALUE');}).respond(input()),error => error.code === 'MODEL_UNAVAILABLE' && !error.message.includes('SECRET'));
  await assert.rejects(clientFor(async () => {throw Object.assign(new Error('internal timeout'),{name:'AbortError'});}).respond(input()),error => error.code === 'AGENT_TIMEOUT');
  await assert.rejects(clientFor(async () => ({output:{message:{role:'user',content:[]}}})).respond(input()),error => error.code === 'INVALID_MODEL_RESPONSE');
});

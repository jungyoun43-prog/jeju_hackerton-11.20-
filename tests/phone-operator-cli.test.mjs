import test from 'node:test';
import assert from 'node:assert/strict';
import {runPhoneOperator,previewPhoneRequest} from '../scripts/phone-operator.mjs';

test('운영자 CLI의 기본 실행은 live 환경이 있어도 dry-run만 수행한다',async()=>{
  for(const args of [[],['--dry-run']]){
    let disposed=0;const messages=[];
    const result=await runPhoneOperator({args,env:{PHONE_OUTBOUND_ENABLED:'true',PHONE_OUTBOUND_LIVE_ACK:'I_UNDERSTAND_THIS_PLACES_REAL_CALLS'},write:m=>messages.push(m),
      makeAdapter:({env})=>{assert.deepEqual(env,{});return{async start(input,options){assert.equal(options,undefined);assert.equal(input.recipient.phone,'+12025550123');return{mode:'simulation',actualCallPlaced:false};},async dispose(){disposed++;}};},
      makeServer:()=>{throw new Error('default command must not listen');}});
    assert.equal(result.mode,'dry-run');assert.equal(disposed,1);assert.equal(JSON.parse(messages[0]).actualCallPlaced,false);
  }
});

test('발신 플래그 없는 manifest와 모호한 CLI 인수는 파일·서버·발신을 건드리지 않는다',async()=>{
  for(const args of [['--request','private.json'],['--live'],['--listen','--live'],['--dry-run','--live']]){
    await assert.rejects(runPhoneOperator({args,load:()=>{throw new Error('must not read');},makeAdapter:()=>{throw new Error('must not construct');}}),{code:'INVALID_REQUEST'});
  }
});

test('실행 파일 읽기 실패·잘못된 JSON·비활성 실발신은 안전한 오류로 끝난다',async()=>{
  for(const load of [async()=>{throw new Error('synthetic-secret');},async()=>'synthetic-secret',async()=>JSON.stringify(previewPhoneRequest())]){
    await assert.rejects(runPhoneOperator({args:['--live','--request','operator-request.json'],env:{},load,
      makeAdapter:()=>{throw new Error('must not construct');},makeServer:()=>{throw new Error('must not listen');}}),e=>e.name==='PhoneAdapterError'&&!e.message.includes('synthetic-secret'));
  }
});

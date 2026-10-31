import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { runAgentKeyUpload, putKeyWithCli } from '../scripts/aws-agent-key.mjs';

const apiKey='fixture-only-not-a-real-openai-credential';
const arn='arn:aws:secretsmanager:ap-northeast-2:111122223333:secret:jeju-care-compass-agent/openai-api-key-aB12cD';
const env={OPENAI_API_KEY:apiKey,AWS_REGION:'ap-northeast-2'};
const stack={StackStatus:'UPDATE_COMPLETE',Tags:[{Key:'Application',Value:'jeju-care-compass'}],Parameters:[{ParameterKey:'EnableOpenAI',ParameterValue:'true'},{ParameterKey:'EnableSessionStore',ParameterValue:'true'}],Outputs:[{OutputKey:'OpenAISecretArn',OutputValue:arn}]};
const secret={ARN:arn,Name:'jeju-care-compass-agent/openai-api-key',Tags:[{Key:'Application',Value:'jeju-care-compass'}]};
const runner=({overrideStack=stack,overrideSecret=secret}={})=>args=>{
  if(args[0]==='sts')return {Account:'111122223333'};
  if(args[0]==='cloudformation')return {Stacks:[overrideStack]};
  if(args[1]==='describe-secret')return overrideSecret;
  throw new Error('예상하지 못한 AWS 요청');
};

test('키 업로드 기본은 AWS 무접속 계획이며 키를 반환하지 않는다',async()=>{
  const result=await runAgentKeyUpload({env,args:[],run:()=>{throw new Error('읽기 금지');},upload:()=>{throw new Error('업로드 금지');}});
  assert.equal(result.applied,false);assert.equal(result.keyConfigured,true);
  assert.equal(JSON.stringify(result).includes(apiKey),false);
});

test('현재 계정·stack·Secret 소유를 확인한 뒤 값은 전용 upload 입력에만 전달한다',async()=>{
  const result=await runAgentKeyUpload({env,args:['--apply'],run:runner(),upload:input=>{
    assert.equal(input.secretArn,arn);
    assert.deepEqual(JSON.parse(input.secretString),{OPENAI_API_KEY:apiKey});
    return {ARN:arn,VersionId:input.clientRequestToken};
  }});
  assert.equal(result.applied,true);assert.equal(JSON.stringify(result).includes(apiKey),false);
});

test('소유·활성 상태·영속 한도·Secret 계정 불일치면 쓰지 않는다',async()=>{
  const badStacks=[{...stack,Tags:[]},{...stack,StackStatus:'UPDATE_IN_PROGRESS'},{...stack,Parameters:[]},{...stack,Outputs:[{OutputKey:'OpenAISecretArn',OutputValue:arn.replace('111122223333','444455556666')}]}];
  for(const overrideStack of badStacks)await assert.rejects(runAgentKeyUpload({env,args:['--apply'],run:runner({overrideStack}),upload:()=>{throw new Error('변경 금지');}}));
  await assert.rejects(runAgentKeyUpload({env,args:['--apply'],run:runner({overrideSecret:{...secret,Tags:[]}}),upload:()=>{throw new Error('변경 금지');}}));
});

test('업로드 실패 원문이나 키가 공개 오류에 포함되지 않는다',async()=>{
  await assert.rejects(runAgentKeyUpload({env,args:['--apply'],run:runner(),upload:()=>{throw new Error(apiKey);}}),error=>!error.message.includes(apiKey));
});

test('실제 CLI 어댑터는 값을 argv나 자식 환경 대신 stdin으로만 전달한다',()=>{
  const secretString=JSON.stringify({OPENAI_API_KEY:apiKey});
  let captured;
  putKeyWithCli({env,region:'ap-northeast-2',secretArn:arn,secretString,clientRequestToken:'fixture-token',spawn:(command,args,options)=>{
    captured={command,args,options};return {status:0,stdout:JSON.stringify({ARN:arn,VersionId:'fixture-token'})};
  }});
  assert.equal(captured.options.input,secretString);
  assert.equal(JSON.stringify(captured.args).includes(apiKey),false);
  assert.equal(captured.args[captured.args.indexOf('--secret-string')+1],'file:///dev/stdin');
  assert.equal(Object.hasOwn(captured.options.env,'OPENAI_API_KEY'),false);
});

test('실제 OS pipe로 CLI가 /dev/stdin을 다시 열며 임시 비밀파일 없이 전달한다',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'jeju-secret-pipe-'));
  try {
    const cli=join(directory,'fake-aws');
    await writeFile(cli,'#!/usr/bin/env python3\nimport json,sys\npayload=json.load(open("/dev/stdin"))\nassert set(payload)=={"OPENAI_API_KEY"}\nprint(json.dumps({"ARN":sys.argv[sys.argv.index("--secret-id")+1],"VersionId":sys.argv[sys.argv.index("--client-request-token")+1]}))\n');
    await chmod(cli,0o700);
    const result=putKeyWithCli({env:{...process.env,...env,AWS_CLI:cli},region:'ap-northeast-2',secretArn:arn,secretString:JSON.stringify({OPENAI_API_KEY:apiKey}),clientRequestToken:'fixture-token'});
    assert.deepEqual(result,{ARN:arn,VersionId:'fixture-token'});
  }finally {await rm(directory,{recursive:true,force:true});}
});

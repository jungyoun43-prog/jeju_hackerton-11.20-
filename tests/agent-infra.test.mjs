import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agentBootstrapSettings, linkedSiteParameters, runAgentBootstrap } from '../scripts/aws-agent-bootstrap.mjs';
import { createAgentPublishPlan, runAgentPublish } from '../scripts/aws-agent-publish.mjs';

const template=JSON.parse(await readFile(new URL('../infra/aws-agent-api.yaml',import.meta.url),'utf8'));
const siteTemplate=JSON.parse(await readFile(new URL('../infra/aws-static-site.yaml',import.meta.url),'utf8'));
const owner={Key:'Application',Value:'jeju-care-compass'};
const distributionId='E1234567890ABC';
const functionName='jeju-care-compass-agent-api';
const functionArn=`arn:aws:lambda:ap-northeast-2:111122223333:function:${functionName}`;
const origin='example.lambda-url.ap-northeast-2.on.aws';
const revision='a'.repeat(40);
const env={AWS_REGION:'ap-northeast-2',AWS_DISTRIBUTION_ID:distributionId,AWS_AGENT_FUNCTION_NAME:functionName,APP_REVISION:revision};
const siteStack={StackStatus:'UPDATE_COMPLETE',Tags:[owner],Parameters:[
  {ParameterKey:'ProjectName',ParameterValue:'jeju-care-compass'},
  {ParameterKey:'GitHubRepository',ParameterValue:'example/jeju-demo'},
  {ParameterKey:'ExistingGitHubOidcProviderArn',ParameterValue:''},
  {ParameterKey:'GitHubOidcSubject',ParameterValue:'repo:example@123/jeju-demo@456:environment:production'},
],Outputs:[{OutputKey:'DistributionId',OutputValue:distributionId}]};
const agentStack={StackStatus:'CREATE_COMPLETE',Tags:[owner],Parameters:[{ParameterKey:'DistributionId',ParameterValue:distributionId}],Outputs:[
  {OutputKey:'AgentFunctionArn',OutputValue:functionArn},
  {OutputKey:'AgentOriginDomainName',OutputValue:origin},
]};

async function artifact(t,entries) {
  const root=await mkdtemp(join(tmpdir(),'jeju-agent-zip-'));
  t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'output'));
  const files=entries||{'index.mjs':'export const handler=async()=>({statusCode:503});','deployment.json':JSON.stringify({revision,runtime:'lambda',mode:'synthetic'})};
  const result=spawnSync('python3',['-c',`import json,sys,zipfile
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as archive:
 for name, body in json.loads(sys.argv[2]).items(): archive.writestr(name, body)
`,join(root,'output/agent-lambda.zip'),JSON.stringify(files)],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);return root;
}

function lambdaConfig(plan,overrides={}) {
  return {FunctionArn:functionArn,Runtime:'nodejs22.x',Handler:'index.handler',State:'Active',LastUpdateStatus:'Successful',RevisionId:'revision-token',CodeSha256:plan.codeSha256,...overrides};
}

test('모델과 DB는 기본 비활성이고 선택한 리소스 권한만 조건부로 만든다',()=>{
  assert.equal(template.Parameters.EnableModel.Default,'false');
  assert.equal(template.Parameters.EnableSessionStore.Default,'false');
  assert.equal(template.Resources.SessionTable.Condition,'SessionStoreEnabled');
  assert.equal(template.Resources.AgentSessionPolicy.Condition,'SessionStoreEnabled');
  assert.equal(template.Resources.AgentModelPolicy.Condition,'ModelEnabled');
  const role=template.Resources.AgentExecutionRole.Properties;
  assert.equal(role.ManagedPolicyArns,undefined);
  assert.equal(role.Policies.length,1);
  assert.deepEqual(role.Policies[0].PolicyDocument.Statement[0].Action,['logs:CreateLogStream','logs:PutLogEvents']);
  const statePolicy=template.Resources.AgentSessionPolicy.Properties.PolicyDocument.Statement[0];
  assert.ok(statePolicy.Action.every(action=>!['dynamodb:Scan','dynamodb:Query','dynamodb:*'].includes(action)));
  assert.deepEqual(statePolicy.Resource,{'Fn::GetAtt':['SessionTable','Arn']});
  const modelPolicy=template.Resources.AgentModelPolicy.Properties.PolicyDocument.Statement;
  assert.ok(modelPolicy.every(item=>JSON.stringify(item.Resource).includes('BedrockModelId')&&!JSON.stringify(item.Resource).includes('*')));
  assert.equal(modelPolicy[1].Resource.length,6);
  assert.ok(modelPolicy[1].Condition.StringEquals['bedrock:InferenceProfileArn']);
});

test('원점 URL은 IAM 인증과 특정 CloudFront 배포의 양쪽 호출 권한으로 제한한다',()=>{
  assert.equal(template.Resources.AgentFunctionUrl.Properties.AuthType,'AWS_IAM');
  for(const key of ['AllowCloudFrontFunctionUrl','AllowCloudFrontInvoke']) {
    const p=template.Resources[key].Properties;
    assert.equal(p.Principal,'cloudfront.amazonaws.com');
    assert.deepEqual(p.SourceArn,{'Fn::Sub':'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${DistributionId}'});
  }
  assert.equal(template.Resources.AllowCloudFrontFunctionUrl.Properties.FunctionUrlAuthType,'AWS_IAM');
  assert.equal(template.Resources.AllowCloudFrontInvoke.Properties.InvokedViaFunctionUrl,true);
  assert.equal(template.Resources.AgentFunction.Properties.ReservedConcurrentExecutions,2);
  assert.equal(template.Resources.AgentFunction.Properties.Timeout,60);
  assert.equal(template.Resources.AgentLogGroup.Properties.RetentionInDays,7);
  assert.match(template.Resources.AgentFunction.Properties.Code.ZipFile,/statusCode:503/);
});

test('선택 상태 테이블은 pk·만료 TTL·암호화·보존 계약을 지킨다',()=>{
  const table=template.Resources.SessionTable;
  assert.deepEqual(table.Properties.KeySchema,[{AttributeName:'pk',KeyType:'HASH'}]);
  assert.deepEqual(table.Properties.TimeToLiveSpecification,{AttributeName:'expiresAt',Enabled:true});
  assert.equal(table.Properties.SSESpecification.SSEEnabled,true);
  assert.equal(table.DeletionPolicy,'Retain');assert.equal(table.UpdateReplacePolicy,'Retain');
});

test('API 경로만 uncached Lambda OAC로 보내고 정적 API와 OIDC trust는 보존한다',()=>{
  const behavior=siteTemplate.Resources.SiteDistribution.Properties.DistributionConfig.CacheBehaviors['Fn::If'][1][0];
  assert.equal(behavior.PathPattern,'/api/agent*');
  assert.equal(behavior.ViewerProtocolPolicy,'https-only');
  assert.ok(behavior.AllowedMethods.includes('POST'));
  const cache=siteTemplate.Resources.AgentCachePolicy.Properties.CachePolicyConfig;
  assert.ok(['MinTTL','MaxTTL','DefaultTTL'].every(key=>cache[key]===0));
  const headers=siteTemplate.Resources.AgentOriginRequestPolicy.Properties.OriginRequestPolicyConfig.HeadersConfig.Headers;
  assert.ok(headers.includes('X-Amz-Content-Sha256'));assert.ok(!headers.includes('Host'));
  assert.equal(siteTemplate.Resources.AgentOriginAccessControl.Properties.OriginAccessControlConfig.OriginAccessControlOriginType,'lambda');
  const code=siteTemplate.Resources.AgentCodeDeployPolicy;
  assert.equal(code.Condition,'HasAgentApi');
  const policy=code.Properties.PolicyDocument.Statement[0];
  assert.deepEqual(policy.Resource,{Ref:'AgentFunctionArn'});
  assert.ok(policy.Action.includes('lambda:UpdateFunctionCode'));
  assert.ok(policy.Action.every(action=>!action.includes('Invoke')&&!action.includes('UpdateFunctionConfiguration')&&!action.startsWith('iam:')));
  assert.equal(siteTemplate.Resources.GitHubOidcProvider.DeletionPolicy,'Retain');
});

test('새 API stack도 의도·불변 조건과 inline 제한을 기록한다',async()=>{
  assert.equal(template.Metadata.AWSToolsMetrics.AWSAgentToolkit,'aws-cloudformation@3');
  for(const resource of Object.values(template.Resources)) {
    const context=resource.Metadata['com.aws.cloudformation.Context'];assert.ok(context.why);assert.ok(context.must.length);
  }
  assert.ok((await readFile(new URL('../infra/aws-agent-api.yaml',import.meta.url))).length<51200);
});

test('기본 인프라 계획은 AWS 무접속이고 유효하지 않은 범위·flag를 거절한다',async()=>{
  const result=await runAgentBootstrap({env:{},args:[],run:()=>{throw new Error('AWS 호출 금지');}});
  assert.equal(result.applied,false);assert.equal(result.enableModel,'false');assert.equal(result.enableStore,'false');
  assert.throws(()=>agentBootstrapSettings({...env,AGENT_MODEL_ENABLED:'yes'},[]),/flag/);
  assert.throws(()=>agentBootstrapSettings({...env,AWS_REGION:'us-east-1'},[]),/서울/);
  assert.throws(()=>agentBootstrapSettings({...env,DEMO_DAILY_TURN_LIMIT:'81'},[]),/1~80/);
  assert.throws(()=>agentBootstrapSettings({},['--apply']),/AWS_DISTRIBUTION_ID/);
});

test('사이트 연결은 immutable subject와 provider 빈 문자열 소유권까지 previous value로 보존한다',()=>{
  const parameters=linkedSiteParameters(siteTemplate,siteStack,agentStack);
  for(const key of ['GitHubOidcSubject','GitHubRepository','ExistingGitHubOidcProviderArn']) assert.deepEqual(parameters.find(p=>p.ParameterKey===key),{ParameterKey:key,UsePreviousValue:true});
  assert.equal(parameters.find(p=>p.ParameterKey==='AgentOriginDomainName').ParameterValue,origin);
  assert.equal(parameters.find(p=>p.ParameterKey==='AgentFunctionArn').ParameterValue,functionArn);
  const bad=structuredClone(siteStack);bad.Parameters.find(p=>p.ParameterKey==='GitHubOidcSubject').ParameterValue='repo:other/demo:environment:production';
  assert.throws(()=>linkedSiteParameters(siteTemplate,bad,agentStack),/정확한 production/);
});

test('API 생성은 소유 사이트 확인·템플릿 검증 뒤에만 제출하며 waiter나 모델 호출이 없다',async()=>{
  const calls=[];
  const run=args=>{
    calls.push(args);
    if(args[1]==='describe-stacks') {
      if(args.includes('jeju-care-compass-agent')) throw new Error('ValidationError: Stack with id x does not exist');
      return {Stacks:[siteStack]};
    }
    if(args[0]==='sts') return {Account:'111122223333'};
    return {StackId:'test-only'};
  };
  const result=await runAgentBootstrap({env,args:['--apply'],run,log:()=>{}});
  assert.equal(result.operation,'create-stack');
  const create=calls.find(args=>args[1]==='create-stack');
  const parameters=JSON.parse(create[create.indexOf('--parameters')+1]);
  assert.equal(parameters.find(p=>p.ParameterKey==='EnableModel').ParameterValue,'false');
  assert.equal(parameters.find(p=>p.ParameterKey==='EnableSessionStore').ParameterValue,'false');
  assert.ok(calls.findIndex(args=>args[1]==='validate-template')<calls.indexOf(create));
  assert.ok(calls.every(args=>!['bedrock','bedrock-runtime','iam'].includes(args[0])&&!args.includes('wait')));
});

test('다른 소유 stack이나 불일치 배포는 변경하지 않는다',async()=>{
  const calls=[];
  await assert.rejects(runAgentBootstrap({env,args:['--link-site','--apply'],run:args=>{
    calls.push(args);
    if(args[0]==='sts')return {Account:'111122223333'};
    return {Stacks:[args.includes('jeju-care-compass-agent')?agentStack:{...siteStack,Outputs:[{OutputKey:'DistributionId',OutputValue:'EDIFFERENT'}]}]};
  }}),/일치하지/);
  assert.ok(calls.every(args=>!['create-stack','update-stack'].includes(args[1])));
  await assert.rejects(runAgentBootstrap({env,args:['--status'],run:()=>({Stacks:[{...agentStack,Tags:[]}]})}),/소유 태그/);
});

test('Lambda ZIP은 정적 dist 밖의 정해진 파일과 동일 커밋 메타데이터만 허용한다',async t=>{
  const root=await artifact(t);const plan=await createAgentPublishPlan({env,root});
  assert.ok(plan.zip.endsWith('/output/agent-lambda.zip'));assert.equal(plan.revision,revision);
  const result=await runAgentPublish({env,root,args:[],run:()=>{throw new Error('기본은 AWS 호출 금지');}});
  assert.equal(result.applied,false);
  await assert.rejects(createAgentPublishPlan({env:{...env,APP_REVISION:'b'.repeat(40)},root}),/검사한 커밋/);
  const badRoot=await artifact(t,{'../index.mjs':'bad','deployment.json':'{}'});
  await assert.rejects(createAgentPublishPlan({env,root:badRoot}),/ZIP 형식/);
  await rm(join(root,'output/agent-lambda.zip'));
  await symlink(join(badRoot,'output/agent-lambda.zip'),join(root,'output/agent-lambda.zip'));
  await assert.rejects(createAgentPublishPlan({env,root}),/symlink/);
});

test('Lambda 태그·handler와 낙관적 갱신 토큰 확인 후 ZIP을 직접 게시한다',async t=>{
  const root=await artifact(t),plan=await createAgentPublishPlan({env,root}),calls=[];
  const run=args=>{
    calls.push(args);
    if(args[1]==='get-function-configuration')return lambdaConfig(plan);
    if(args[1]==='list-tags')return {Tags:{Application:'jeju-care-compass',DataMode:'synthetic'}};
    if(args[1]==='update-function-code')return {CodeSha256:plan.codeSha256,LastUpdateStatus:'InProgress'};
    throw new Error('예상하지 못한 AWS 작업');
  };
  const result=await runAgentPublish({env,root,args:['--apply'],run,log:()=>{}});
  assert.equal(result.applied,true);
  const update=calls.find(args=>args[1]==='update-function-code');assert.ok(update);
  assert.equal(update[update.indexOf('--zip-file')+1],`fileb://${plan.zip}`);
  assert.equal(update[update.indexOf('--revision-id')+1],'revision-token');
  assert.ok(calls.every(args=>args[0]==='lambda'));
  const rejected=[];
  await assert.rejects(runAgentPublish({env,root,args:['--apply'],run:args=>{
    rejected.push(args);return args[1]==='get-function-configuration'?lambdaConfig(plan):{Tags:{}};
  }}),/전용 함수 태그/);
  assert.ok(rejected.every(args=>args[1]!=='update-function-code'));
});

test('배포 검증은 코드 hash와 공개 revision·미연동 상태를 함께 확인한다',async t=>{
  const root=await artifact(t),plan=await createAgentPublishPlan({env,root});
  const run=args=>args[1]==='get-function-configuration'?lambdaConfig(plan):{Tags:{Application:'jeju-care-compass',DataMode:'synthetic'}};
  const verifyEnv={...env,AWS_SITE_URL:'https://example.cloudfront.net'};
  const fetchImpl=async()=>({ok:true,json:async()=>({revision,llm:false,phone:'simulation',healthRecords:'demo'})});
  assert.equal((await runAgentPublish({env:verifyEnv,root,args:['--verify'],run,fetchImpl})).verified,true);
  await assert.rejects(runAgentPublish({env:verifyEnv,root,args:['--verify'],run,fetchImpl:async()=>({ok:true,json:async()=>({revision:'different',llm:false})})}),/공개 Agent 버전/);
  await assert.rejects(runAgentPublish({env:verifyEnv,root,args:['--verify'],run,fetchImpl:async()=>({ok:true,json:async()=>({revision,llm:true})})}),/llm은 false/);
  await assert.rejects(runAgentPublish({env,root,args:['--verify'],run:args=>args[1]==='get-function-configuration'?lambdaConfig(plan,{CodeSha256:'wrong'}):{Tags:{Application:'jeju-care-compass',DataMode:'synthetic'}}}),/코드 hash/);
});

test('CI는 같은 SHA의 별도 backend artifact를 보존하고 명시한 toggle에서만 게시한다',async()=>{
  const ci=await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
  const deploy=await readFile(new URL('../.github/workflows/deploy-aws.yml',import.meta.url),'utf8');
  assert.match(ci,/name: jeju-agent-\$\{\{ github.sha \}\}/);
  assert.match(ci,/path: output\/agent-lambda.zip/);
  assert.match(ci,/APP_REVISION: \$\{\{ github.sha \}\}/);
  assert.match(deploy,/env.AWS_AGENT_DEPLOY_ENABLED == 'true'/);
  assert.match(deploy,/node scripts\/aws-agent-publish.mjs --apply/);
  assert.match(deploy,/runAgentPublish\(\{args:\['--verify'\]\}\)/);
  assert.ok(!deploy.includes('s3://'));
});

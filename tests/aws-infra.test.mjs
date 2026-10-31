import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootstrapSettings, runBootstrap, selectOidcProvider } from '../scripts/aws-bootstrap.mjs';
import { createPublishPlan, runPublish } from '../scripts/aws-publish.mjs';

const template=JSON.parse(await readFile(new URL('../infra/aws-static-site.yaml',import.meta.url),'utf8'));
const env={GITHUB_REPOSITORY:'example/jeju-demo',AWS_REGION:'ap-northeast-2'};
const publishEnv={AWS_SITE_BUCKET:'jeju-demo-site-123',AWS_DISTRIBUTION_ID:'E1234567890ABC',AWS_REGION:'ap-northeast-2'};
const ownerTag={Key:'Application',Value:'jeju-care-compass'};
async function artifact(t) {
  const root=await mkdtemp(join(tmpdir(),'jeju-aws-artifact-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(join(root,'dist/api'),{recursive:true});
  for(const [name,value] of Object.entries({'index.html':'<!doctype html><title>시연</title>','api/config':JSON.stringify({mode:'simulation',tileUrl:'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}),'api/health':JSON.stringify({mode:'simulation',phoneConnected:false,medicalRecordTransfer:false}),'deployment.json':JSON.stringify({revision:'unit-test',mode:'simulation'})})) await writeFile(join(root,'dist',name),value);
  return root;
}

test('전용 버킷은 공개·웹사이트 접근을 차단하고 암호화·버전·보존을 유지한다',()=>{
  const bucket=template.Resources.SiteBucket;
  assert.ok(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(x=>x===true));
  assert.equal(bucket.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm,'AES256');
  assert.equal(bucket.Properties.VersioningConfiguration.Status,'Enabled');
  assert.equal(bucket.DeletionPolicy,'Retain');assert.equal(bucket.UpdateReplacePolicy,'Retain');
  assert.equal(bucket.Properties.WebsiteConfiguration,undefined);assert.equal(bucket.Properties.AccessControl,undefined);
});

test('origin 읽기는 특정 배포·계정으로 제한하고 평문 전송은 명시적으로 거절한다',()=>{
  const policy=template.Resources.SiteBucketPolicy.Properties.PolicyDocument.Statement;
  const allow=policy.filter(s=>s.Effect==='Allow');assert.equal(allow.length,1);
  assert.deepEqual(allow[0].Principal,{Service:'cloudfront.amazonaws.com'});
  assert.deepEqual(allow[0].Condition.StringEquals['AWS:SourceArn'],{'Fn::Sub':'arn:${AWS::Partition}:cloudfront::${AWS::AccountId}:distribution/${SiteDistribution}'});
  assert.deepEqual(allow[0].Condition.StringEqualsIfExists['AWS:SourceAccount'],{Ref:'AWS::AccountId'});
  assert.ok(policy.some(s=>s.Effect==='Deny'&&s.Condition.Bool['aws:SecureTransport']==='false'&&s.Resource.length===2));
  assert.equal(template.Resources.SiteOriginAccessControl.Properties.OriginAccessControlConfig.SigningBehavior,'always');
  assert.equal(template.Resources.SiteDistribution.Properties.DistributionConfig.DefaultCacheBehavior.ViewerProtocolPolicy,'redirect-to-https');
});

test('배포 역할은 정확한 production subject·audience와 해당 사이트 리소스만 허용한다',()=>{
  const role=template.Resources.DeployRole.Properties;
  const condition=role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;
  assert.equal(condition['token.actions.githubusercontent.com:aud'],'sts.amazonaws.com');
  assert.deepEqual(condition['token.actions.githubusercontent.com:sub'],{'Fn::Sub':'repo:${GitHubRepository}:environment:production'});
  for(const policy of role.Policies) for(const s of policy.PolicyDocument.Statement) {
    assert.notEqual(s.Resource,'*');assert.ok(s.Action.every(action=>!action.startsWith('iam:')&&!action.startsWith('cloudformation:')&&!action.endsWith(':*')));
  }
  assert.equal(template.Resources.GitHubOidcProvider.DeletionPolicy,'Retain');
});

test('템플릿에는 스킬 marker·리소스 의도와 불변 제약이 있고 inline 크기 제한을 넘지 않는다',async()=>{
  assert.equal(template.Metadata.AWSToolsMetrics.AWSAgentToolkit,'aws-cloudformation@3');
  for(const resource of Object.values(template.Resources)) {
    const context=resource.Metadata['com.aws.cloudformation.Context'];assert.ok(context.why);assert.ok(context.must.length>0);
  }
  assert.ok((await readFile(new URL('../infra/aws-static-site.yaml',import.meta.url))).length<51200);
  assert.ok(Buffer.byteLength(template.Description)<1024);
});

test('bootstrap 기본 계획은 AWS에 연결하지 않고 잘못된 대상·모드는 거부한다',async()=>{
  const result=await runBootstrap({env,args:[],run:()=>{throw new Error('호출하면 안 됨');},log:()=>{}});
  assert.equal(result.applied,false);assert.equal(result.mode,'plan');
  assert.throws(()=>bootstrapSettings({},[]),/GITHUB_REPOSITORY/);
  assert.throws(()=>bootstrapSettings(env,['--apply','--status']),/함께/);
  assert.throws(()=>bootstrapSettings({...env,PROJECT_NAME:'Invalid Project'},[]),/PROJECT_NAME/);
});

test('재실행은 stack 소유 OIDC 조건을 뒤집지 않으며 기존 외부 provider도 보존한다',()=>{
  for(const value of ['', 'arn:aws:iam::111122223333:oidc-provider/token.actions.githubusercontent.com']) {
    const stack={Parameters:[{ParameterKey:'ExistingGitHubOidcProviderArn',ParameterValue:value}]};
    assert.equal(selectOidcProvider(()=>{throw new Error('조회 불필요');},{},stack),value);
  }
  const identity={Account:'111122223333',Arn:'arn:aws:iam::111122223333:role/test-only'};
  assert.equal(selectOidcProvider(()=>{throw new Error('NoSuchEntity');},identity,null),'');
  assert.throws(()=>selectOidcProvider(()=>{throw new Error('AccessDenied');},identity,null),/AccessDenied/);
});

test('apply는 검증 후 새 작업을 제출하고 장시간 waiter를 실행하지 않는다',async()=>{
  const calls=[];
  const run=args=>{
    calls.push(args);
    if(args[1]==='describe-stacks')throw new Error('ValidationError: Stack with id demo does not exist');
    if(args[0]==='sts')return JSON.stringify({Account:'111122223333',Arn:'arn:aws:iam::111122223333:role/test-only'});
    if(args[0]==='iam')throw new Error('NoSuchEntity');
    if(args[1]==='create-stack')return JSON.stringify({StackId:'test-stack-id'});
    return '{}';
  };
  const result=await runBootstrap({env,args:['--apply'],run,log:()=>{}});
  assert.equal(result.status,'REQUEST_SUBMITTED');assert.equal(result.applied,true);
  const create=calls.find(args=>args[1]==='create-stack');assert.ok(create);
  assert.ok(calls.findIndex(args=>args[1]==='validate-template')<calls.indexOf(create));
  assert.equal(JSON.parse(create[create.indexOf('--parameters')+1])[2].ParameterValue,'');
  assert.ok(calls.every(args=>!args.includes('wait')&&!args.includes('delete-stack')));
});

test('기존 다른 앱 stack이나 읽기 권한 오류는 생성·갱신으로 우회하지 않는다',async()=>{
  await assert.rejects(runBootstrap({env,args:['--apply'],run:()=>JSON.stringify({Stacks:[{Tags:[],StackStatus:'CREATE_COMPLETE'}]}),log:()=>{}}),/소유 태그/);
  await assert.rejects(runBootstrap({env,args:['--apply'],run:()=>{throw new Error('AccessDenied');},log:()=>{}}),/AccessDenied/);
  const status=await runBootstrap({env:{},args:['--status'],run:()=>JSON.stringify({Stacks:[{Tags:[ownerTag],StackStatus:'CREATE_IN_PROGRESS'}]})});
  assert.equal(status.inProgress,true);assert.equal(status.failed,false);
});

test('게시 경로는 실제 dist로 제한하고 symlink·숨김 파일을 거부한다',async t=>{
  const root=await artifact(t);
  await assert.rejects(createPublishPlan({root,env:publishEnv,directory:'..'}),/dist/);
  await symlink(join(root,'dist/index.html'),join(root,'dist/linked.html'));
  await assert.rejects(createPublishPlan({root,env:publishEnv}),/symlink/);
  await rm(join(root,'dist/linked.html'));
  await writeFile(join(root,'dist/.env'),'do-not-publish');
  await assert.rejects(createPublishPlan({root,env:publishEnv}),/허용되지 않는 경로/);
});

test('게시 전 비밀값 패턴·잘못된 공개 설정·가짜 실연동 표식을 거부한다',async t=>{
  const root=await artifact(t);
  await writeFile(join(root,'dist/config.yaml'),'key: '+'sk-proj-'+'x'.repeat(40));
  await assert.rejects(createPublishPlan({root,env:publishEnv}),/비밀값 패턴/);
  await rm(join(root,'dist/config.yaml'));
  await writeFile(join(root,'dist/api/config'),JSON.stringify({mode:'simulation',secret:'not-allowed'}));
  await assert.rejects(createPublishPlan({root,env:publishEnv}),/mode와 tileUrl/);
  await writeFile(join(root,'dist/api/config'),JSON.stringify({mode:'simulation'}));
  await writeFile(join(root,'dist/api/health'),JSON.stringify({mode:'simulation',phoneConnected:true,medicalRecordTransfer:false}));
  await assert.rejects(createPublishPlan({root,env:publishEnv}),/실제 전화/);
});

test('전용 bucket 태그와 distribution origin 확인 전에 파일을 쓰지 않는다',async t=>{
  const root=await artifact(t);const calls=[];
  await assert.rejects(runPublish({root,env:publishEnv,args:[],run:args=>{calls.push(args);return JSON.stringify({TagSet:[]});},log:()=>{}}),/전용 버킷 태그/);
  assert.ok(calls.every(args=>!['cp','sync'].includes(args[1])));
  await assert.rejects(runPublish({root,env:publishEnv,args:[],run:args=>JSON.stringify(args[0]==='s3api'?{TagSet:[ownerTag]}:{Distribution:{DistributionConfig:{Origins:{Items:[{DomainName:'wrong-bucket.s3.ap-northeast-2.amazonaws.com'}]}}}}),log:()=>{}}),/origin/);
});

test('게시 성공 경로는 JSON MIME·index 마지막·비파괴 업로드·무효화 요청을 보장한다',async t=>{
  const root=await artifact(t);const calls=[];
  const run=args=>{
    calls.push(args);
    if(args[0]==='s3api')return JSON.stringify({TagSet:[ownerTag]});
    if(args[1]==='get-distribution')return JSON.stringify({Distribution:{DomainName:'example.cloudfront.net',DistributionConfig:{Origins:{Items:[{DomainName:`${publishEnv.AWS_SITE_BUCKET}.s3.ap-northeast-2.amazonaws.com`}]}}}});
    if(args[1]==='create-invalidation')return JSON.stringify({Invalidation:{Id:'test-only',Status:'InProgress'}});
    return '';
  };
  const result=await runPublish({root,env:publishEnv,args:['--directory','dist'],run,log:()=>{}});
  assert.equal(result.siteUrl,'https://example.cloudfront.net');assert.equal(result.published,true);
  const writes=calls.filter(args=>args[0]==='s3');assert.ok(writes.at(-1)[2].endsWith('index.html'));
  assert.equal(writes.filter(args=>args.includes('application/json')).length,2);
  assert.ok(writes.every(args=>!args.includes('--delete')&&!args.some(arg=>arg.includes('immutable'))));
  assert.equal(calls.at(-1)[1],'create-invalidation');
});

import { spawnSync } from 'node:child_process';
import { readFile, realpath, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { awsRunner } from './aws-bootstrap.mjs';
import { pythonCli } from './python-cli.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const parse=value=>typeof value==='string'?JSON.parse(value||'{}'):value;
const fail=message=>{throw new Error(message);};

export async function createAgentPublishPlan({env=process.env,root=projectRoot}={}) {
  const functionName=env.AWS_AGENT_FUNCTION_NAME||'',region=env.AWS_REGION||env.AWS_DEFAULT_REGION||'ap-northeast-2';
  if(!/^[A-Za-z0-9-_]{1,64}$/.test(functionName)) fail('AWS_AGENT_FUNCTION_NAME에 전용 함수 이름을 지정하세요.');
  if(region!=='ap-northeast-2') fail('Agent의 검증 대상 리전은 ap-northeast-2입니다.');
  const zip=resolve(root,'output/agent-lambda.zip'),output=resolve(root,'output');
  const stat=await lstat(zip);
  if(!stat.isFile()||stat.isSymbolicLink()||await realpath(zip)!==zip||await realpath(output)!==output) fail('output/agent-lambda.zip은 symlink가 아닌 프로젝트의 실제 파일이어야 합니다.');
  if(stat.size<=0||stat.size>50*1024*1024) fail('직접 업로드할 Lambda ZIP 크기는 50MiB 이내여야 합니다.');
  // ZIP을 풀거나 실행하지 않고 경로·중복·압축해제 크기·빌드 provenance만 확인한다.
  const inspect=spawnSync(pythonCli(env),['-c',`
import json, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as archive:
    infos = archive.infolist()
    names = [item.filename for item in infos]
    if sorted(names) != ['deployment.json', 'index.mjs']:
        raise ValueError('ZIP must contain exactly index.mjs and deployment.json')
    if any(item.file_size > 100*1024*1024 or item.flag_bits & 1 or (item.external_attr >> 16) & 0o170000 == 0o120000 for item in infos):
        raise ValueError('Invalid ZIP entry size, encryption or symlink')
    if archive.getinfo('deployment.json').file_size > 8192:
        raise ValueError('Invalid deployment metadata size')
    archive.read('index.mjs')
    print(json.dumps(json.loads(archive.read('deployment.json'))))
`,zip],{encoding:'utf8',timeout:15000,maxBuffer:65536});
  if(inspect.error||inspect.status!==0) fail('Lambda ZIP 형식·경로·빌드 명세 검증 실패. scripts/build-agent.mjs로 다시 빌드하세요.');
  const metadata=JSON.parse(inspect.stdout);
  if(metadata.runtime!=='lambda'||metadata.mode!=='synthetic'||typeof metadata.revision!=='string'||!metadata.revision||metadata.revision.length>128) fail('합성 Lambda 빌드 명세가 올바르지 않습니다.');
  const expectedRevision=env.GITHUB_SHA||env.APP_REVISION;
  if(expectedRevision&&metadata.revision!==expectedRevision) fail('Lambda ZIP이 검사한 커밋과 다릅니다.');
  return {zip,functionName,region,revision:metadata.revision,codeSha256:createHash('sha256').update(await readFile(zip)).digest('base64'),bytes:stat.size};
}

export async function runAgentPublish({env=process.env,args=process.argv.slice(2),root=projectRoot,run,fetchImpl=fetch,log=console.log}={}) {
  if(args.some(arg=>!['--apply','--verify','--help'].includes(arg))||args.includes('--apply')&&args.includes('--verify')) fail('사용법: node scripts/aws-agent-publish.mjs [--apply | --verify]');
  if(args.includes('--help')) return {help:'기본은 ZIP 계획 검증만 합니다. --apply: 검증 ZIP을 Lambda에 직접 게시. --verify: 코드 hash·정상 상태·선택한 공개 capabilities revision을 읽기 확인. S3에는 업로드하지 않습니다.'};
  if(env.AGENT_EXPECT_MODEL&&!['true','false'].includes(env.AGENT_EXPECT_MODEL)) fail('AGENT_EXPECT_MODEL은 true 또는 false여야 합니다.');
  if(env.AGENT_EXPECT_MODEL==='true'&&env.OPENAI_MODEL&&!['gpt-6.1-sol','gpt-6.1-terra'].includes(env.OPENAI_MODEL)) fail('OPENAI_MODEL은 허용된 OpenAI 모델이어야 합니다.');
  if(args.includes('--verify')&&env.AGENT_EXPECT_MODEL==='true'&&!env.AWS_SITE_URL) fail('모델 활성화 검증에는 공개 capabilities를 확인할 AWS_SITE_URL이 필요합니다.');
  const plan=await createAgentPublishPlan({env,root});
  if(!args.length) return {...plan,applied:false,note:'AWS 호출 없음. API ZIP은 정적 사이트 버킷에 게시하지 않습니다.'};
  run ||= awsRunner(env,plan.region,root);
  const config=parse(run(['lambda','get-function-configuration','--function-name',plan.functionName]));
  const tags=parse(run(['lambda','list-tags','--resource',config.FunctionArn])).Tags||{};
  if(tags.Application!=='jeju-care-compass'||tags.DataMode!=='synthetic') fail('합성 Agent 전용 함수 태그가 없어 게시를 중단했습니다.');
  if(config.Runtime!=='nodejs22.x'||config.Handler!=='index.handler'||!config.FunctionArn?.includes(`:lambda:${plan.region}:`)) fail('Lambda 실행환경·handler·리전이 계약과 다릅니다.');
  if(args.includes('--verify')) {
    let modelStatus={};
    if(config.State!=='Active'||config.LastUpdateStatus!=='Successful') fail('Lambda 코드 갱신이 아직 정상 완료되지 않았습니다.');
    if(config.CodeSha256!==plan.codeSha256) fail('실제 Lambda 코드 hash가 검증 ZIP과 다릅니다.');
    if(env.AWS_SITE_URL) {
      const base=new URL(env.AWS_SITE_URL);
      if(base.protocol!=='https:'||base.username||base.password) fail('AWS_SITE_URL은 HTTPS 공개 주소여야 합니다.');
      const response=await fetchImpl(new URL('/api/agent/capabilities',base),{headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(10000)});
      if(!response.ok) fail(`공개 Agent capabilities 확인 실패: HTTP ${response.status}`);
      const capabilities=await response.json();
      if(capabilities.revision!==plan.revision) fail('공개 Agent 버전이 검증 ZIP과 다릅니다.');
      if(capabilities.phone==='connected'||capabilities.healthRecords==='connected') fail('실제 전화·개인 기록 연동을 활성화한 것으로 표시하면 안 됩니다.');
      if(env.AGENT_EXPECT_MODEL==='true') {
        if(capabilities.llm!==true) fail('모델 활성화 배포의 capabilities.llm은 true여야 합니다.');
        if(Object.hasOwn(capabilities,'model')||Object.hasOwn(capabilities,'reasoningEffort')||Object.hasOwn(capabilities,'reasoning')) fail('공개 응답에 모델 설정을 노출하면 안 됩니다.');
        const model=config.Environment?.Variables?.OPENAI_MODEL || 'gpt-6.1-sol';
        if(!['gpt-6.1-sol','gpt-6.1-terra'].includes(model)) fail('서버 OpenAI 모델 명칭을 확인하세요.');
        if(env.OPENAI_MODEL&&model!==env.OPENAI_MODEL) fail('서버 모델이 검증하려는 OPENAI_MODEL과 다릅니다.');
        if(env.OPENAI_REASONING_EFFORT&&(config.Environment?.Variables?.OPENAI_REASONING_EFFORT||'medium')!==env.OPENAI_REASONING_EFFORT) fail('서버 추론 설정이 검증하려는 설정과 다릅니다.');
      } else if(capabilities.llm!==false) fail('모델 미설정 배포의 capabilities.llm은 false여야 합니다.');
      modelStatus={modelConnected:capabilities.llm===true};
    }
    return {verified:true,revision:plan.revision,functionName:plan.functionName,codeSha256:plan.codeSha256,...modelStatus,note:'코드·공개 설정 확인이며 실제 모델 계정 접근·품질·마이크·발신 검증이 아닙니다.'};
  }
  if(config.LastUpdateStatus==='InProgress') fail('함수 갱신이 진행 중입니다. 완료 후 다시 게시하세요.');
  if(!config.RevisionId) fail('동시 갱신 방지를 위한 Lambda RevisionId가 없습니다.');
  log(`검증한 Agent ZIP 직접 게시: revision ${plan.revision}`);
  const updated=parse(run(['lambda','update-function-code','--function-name',plan.functionName,'--zip-file',`fileb://${plan.zip}`,'--revision-id',config.RevisionId]));
  if(updated.CodeSha256!==plan.codeSha256) fail('AWS가 수신한 ZIP hash가 다릅니다. 함수 상태를 확인하세요.');
  return {applied:true,functionName:plan.functionName,revision:plan.revision,codeSha256:plan.codeSha256,status:updated.LastUpdateStatus,note:'게시 요청 완료. --verify로 완료·동일 hash·공개 revision을 확인하세요.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await runAgentPublish(),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}

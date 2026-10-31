import { spawnSync } from 'node:child_process';
import { readdir, readFile, realpath, lstat } from 'node:fs/promises';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fail=message=>{throw new Error(message);};
const keyPatterns=[/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,/sk-proj-[A-Za-z0-9_-]{20,}/,/sk-[A-Za-z0-9]{32,}/,/AIza[0-9A-Za-z_-]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
const parse=value=>typeof value==='string'?JSON.parse(value||'{}'):value;

async function artifactFiles(directory,prefix='') {
  const files=[];
  for(const item of await readdir(resolve(directory,prefix),{withFileTypes:true})) {
    const name=prefix?`${prefix}/${item.name}`:item.name;
    if(item.name.startsWith('.')||['node_modules','scripts','tests','research','orchestration','test-results'].includes(item.name)) fail(`배포 산출물에 허용되지 않는 경로가 있습니다: ${name}`);
    if(item.isSymbolicLink()||(await lstat(resolve(directory,name))).isSymbolicLink()) fail(`배포 산출물의 symlink는 허용하지 않습니다: ${name}`);
    if(item.isDirectory()) files.push(...await artifactFiles(directory,name));
    else if(item.isFile()) files.push(name);
    else fail(`일반 파일이 아닌 산출물이 있습니다: ${name}`);
  }
  return files;
}

export async function createPublishPlan({env=process.env,directory='dist',root=projectRoot}={}) {
  const bucket=env.AWS_SITE_BUCKET||'',distributionId=env.AWS_DISTRIBUTION_ID||'';
  if(!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)||bucket.includes('..')||/^\d+\.\d+\.\d+\.\d+$/.test(bucket)) fail('AWS_SITE_BUCKET에 전용 S3 버킷 이름을 지정하세요.');
  if(!/^[A-Z0-9]{8,32}$/.test(distributionId)) fail('AWS_DISTRIBUTION_ID를 확인하세요.');
  const expected=resolve(root,'dist'),requested=resolve(root,directory);
  if(requested!==expected||await realpath(requested)!==await realpath(expected)||await realpath(expected)!==expected) fail('이 프로젝트의 실제 dist 디렉터리만 배포할 수 있습니다.');
  const files=await artifactFiles(expected);
  for(const name of ['index.html','api/config','api/health','deployment.json']) if(!files.includes(name)) fail(`필수 정적 산출물이 없습니다: ${name}. 먼저 빌드하세요.`);
  for(const name of files) {
    const bytes=await readFile(resolve(expected,name));
    if(!bytes.subarray(0,8192).includes(0)&&keyPatterns.some(pattern=>pattern.test(bytes.toString('utf8')))) fail(`비밀값 패턴을 발견해 배포를 중단했습니다. 파일: ${name}`);
  }
  const config=JSON.parse(await readFile(resolve(expected,'api/config'),'utf8'));
  const health=JSON.parse(await readFile(resolve(expected,'api/health'),'utf8'));
  const deployment=JSON.parse(await readFile(resolve(expected,'deployment.json'),'utf8'));
  if(config.mode!=='simulation'||health.mode!=='simulation'||health.phoneConnected!==false||health.medicalRecordTransfer!==false||deployment.mode!=='simulation') fail('정적 시연 표식과 실제 전화·전송 비활성 상태를 확인하세요.');
  if(Object.keys(config).some(key=>!['mode','tileUrl'].includes(key))) fail('공개 config에는 mode와 tileUrl만 넣을 수 있습니다.');
  return {directory:expected,bucket,distributionId,region:env.AWS_REGION||env.AWS_DEFAULT_REGION||'ap-northeast-2',files:files.sort(),revision:deployment.revision||'unknown',cacheControl:'public,max-age=60,must-revalidate'};
}

export function publishRunner(env=process.env,region='ap-northeast-2',root=projectRoot) {
  return args=>{
    const result=spawnSync(env.AWS_CLI||'aws',[...args,'--region',region,'--no-cli-pager','--output','json'],{cwd:root,env:{...env,AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off'},encoding:'utf8',timeout:45000,maxBuffer:5*1024*1024});
    if(result.error) throw new Error(result.error.code==='ENOENT'?'AWS CLI가 없습니다. AWS_CLI 경로나 PATH를 설정하세요.':result.error.message);
    if(result.status!==0) throw new Error((result.stderr||'AWS 게시 명령이 실패했습니다.').trim());
    return result.stdout;
  };
}

export async function runPublish({env=process.env,args=process.argv.slice(2),root=projectRoot,run,log=console.log}={}) {
  let directory='dist';
  for(let i=0;i<args.length;i++) {if(args[i]==='--directory'&&args[i+1])directory=args[++i];else fail('사용법: node scripts/aws-publish.mjs [--directory dist]');}
  const plan=await createPublishPlan({env,directory,root});
  run ||= publishRunner(env,plan.region,root);
  const tags=parse(run(['s3api','get-bucket-tagging','--bucket',plan.bucket])).TagSet||[];
  if(!tags.some(tag=>tag.Key==='Application'&&tag.Value==='jeju-care-compass')) fail('이 앱의 전용 버킷 태그가 없어 게시를 중단했습니다.');
  const distribution=parse(run(['cloudfront','get-distribution','--id',plan.distributionId])).Distribution;
  const origins=distribution?.DistributionConfig?.Origins?.Items||[];
  if(!origins.some(origin=>origin.DomainName?.startsWith(`${plan.bucket}.s3.`))) fail('CloudFront origin과 지정 버킷이 일치하지 않아 게시를 중단했습니다.');
  log(`검증된 정적 산출물 ${plan.files.length}개 게시: revision ${plan.revision}`);
  run(['s3','sync',plan.directory,`s3://${plan.bucket}/`,'--exclude','index.html','--exclude','api/config','--exclude','api/health','--cache-control',plan.cacheControl,'--no-progress']);
  for(const path of ['api/config','api/health']) run(['s3','cp',resolve(plan.directory,path),`s3://${plan.bucket}/${path}`,'--content-type','application/json','--cache-control','no-cache,max-age=0,must-revalidate','--no-progress']);
  log('정적 API JSON 게시 완료, index.html을 마지막으로 게시합니다.');
  run(['s3','cp',resolve(plan.directory,'index.html'),`s3://${plan.bucket}/index.html`,'--content-type','text/html; charset=utf-8','--cache-control','no-cache,max-age=0,must-revalidate','--no-progress']);
  const invalidation=parse(run(['cloudfront','create-invalidation','--distribution-id',plan.distributionId,'--paths','/*'])).Invalidation;
  return {published:true,siteUrl:`https://${distribution.DomainName}`,revision:plan.revision,files:plan.files.length,invalidationId:invalidation?.Id,invalidationStatus:invalidation?.Status,note:'파일 게시와 캐시 무효화 요청을 완료했습니다. HTTPS URL과 무효화 완료 상태는 별도 확인하세요.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await runPublish(),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}

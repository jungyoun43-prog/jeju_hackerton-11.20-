import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const application='jeju-care-compass';
const parse=value=>typeof value==='string' ? JSON.parse(value || '{}') : value;
const fail=message=>{throw new Error(message);};

export function bootstrapSettings(env=process.env,args=process.argv.slice(2),root=projectRoot) {
  if(args.some(arg=>!['--apply','--status','--help'].includes(arg))) fail('사용법: node scripts/aws-bootstrap.mjs [--apply | --status]');
  if(args.includes('--apply')&&args.includes('--status')) fail('--apply와 --status를 함께 사용할 수 없습니다.');
  const settings={mode:args.includes('--help')?'help':args.includes('--status')?'status':args.includes('--apply')?'apply':'plan',region:env.AWS_REGION||env.AWS_DEFAULT_REGION||'ap-northeast-2',stackName:env.AWS_STACK_NAME||'jeju-care-compass-demo',projectName:env.PROJECT_NAME||application,repository:env.GITHUB_REPOSITORY||'',templatePath:resolve(root,'infra/aws-static-site.yaml')};
  if(!/^[a-z]{2}(?:-[a-z0-9]+)+-\d$/.test(settings.region)) fail('AWS_REGION 형식을 확인하세요. 기본은 ap-northeast-2입니다.');
  if(!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(settings.stackName)) fail('AWS_STACK_NAME은 영문자로 시작하는 128자 이내 이름이어야 합니다.');
  if(!/^[a-z][a-z0-9-]{2,29}$/.test(settings.projectName)) fail('PROJECT_NAME은 영문 소문자로 시작하는 3~30자여야 합니다.');
  if(!['status','help'].includes(settings.mode)&&!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(settings.repository)) fail('GITHUB_REPOSITORY를 owner/repo 형식으로 지정하세요.');
  return settings;
}

export function awsRunner(env=process.env,region='ap-northeast-2',root=projectRoot) {
  return args=>{
    const result=spawnSync(env.AWS_CLI||'aws',[...args,'--region',region,'--no-cli-pager','--output','json'],{cwd:root,env:{...env,AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off'},encoding:'utf8',timeout:45000,maxBuffer:5*1024*1024});
    if(result.error) throw new Error(result.error.code==='ENOENT'?'AWS CLI가 없습니다. AWS_CLI 경로나 PATH를 설정하세요.':`AWS CLI 실행 실패: ${result.error.message}`);
    if(result.status!==0) throw new Error((result.stderr||'AWS 명령이 실패했습니다.').trim());
    return result.stdout;
  };
}

function findStack(run,stackName) {
  try {return parse(run(['cloudformation','describe-stacks','--stack-name',stackName])).Stacks?.[0]||null;}
  catch(error) {if(/ValidationError[\s\S]*does not exist|Stack with id .+ does not exist/.test(error.message)) return null;throw error;}
}
function ownedStack(stack) {
  if(stack&&!stack.Tags?.some(tag=>tag.Key==='Application'&&tag.Value===application)) fail('같은 이름의 stack이 이 앱의 소유 태그를 갖지 않아 변경을 중단했습니다. AWS_STACK_NAME을 확인하세요.');
}

export function selectOidcProvider(run,identity,stack) {
  const previous=stack?.Parameters?.find(parameter=>parameter.ParameterKey==='ExistingGitHubOidcProviderArn');
  // 빈 문자열은 해당 stack이 provider를 소유한다는 뜻이다. 재실행 때 조건을 뒤집으면 안 된다.
  if(previous) return previous.ParameterValue||'';
  if(!/^\d{12}$/.test(identity.Account||'')) fail('AWS 계정 확인 응답 형식이 올바르지 않습니다.');
  const partition=/^arn:([a-z0-9-]+):/.exec(identity.Arn||'')?.[1];
  if(!partition) fail('AWS identity ARN을 확인할 수 없습니다.');
  const arn=`arn:${partition}:iam::${identity.Account}:oidc-provider/token.actions.githubusercontent.com`;
  try {run(['iam','get-open-id-connect-provider','--open-id-connect-provider-arn',arn]);return arn;}
  catch(error) {if(/NoSuchEntity/.test(error.message)) return '';throw error;}
}

export async function runBootstrap({env=process.env,args=process.argv.slice(2),root=projectRoot,run,log=console.log}={}) {
  const settings=bootstrapSettings(env,args,root);
  if(settings.mode==='help') return {help:'GITHUB_REPOSITORY=owner/repo AWS_PROFILE=jeju-deploy node scripts/aws-bootstrap.mjs [--apply | --status]. 기본은 계획만 출력합니다.'};
  const template=JSON.parse(await readFile(settings.templatePath,'utf8'));
  if(template.Description?.includes('synthetic')!==true) fail('시연 인프라 템플릿을 확인하세요.');
  if(settings.mode==='plan') return {...settings,changes:'비공개 S3·CloudFront OAC·GitHub production OIDC 역할',authentication:'AWS 호출 없음. --apply 때 기본 인증 경로 사용',provider:'기존 stack의 파라미터 또는 계정의 GitHub provider를 확인 후 재사용',requiredCapability:'CAPABILITY_IAM',applied:false};
  run ||= awsRunner(env,settings.region,root);
  const stack=findStack(run,settings.stackName);
  ownedStack(stack);
  if(settings.mode==='status') {
    if(!stack) return {stackName:settings.stackName,status:'NOT_FOUND',applied:false};
    const status=stack.StackStatus;
    const inProgress=status.endsWith('_IN_PROGRESS');
    return {stackName:settings.stackName,status,inProgress,failed:!inProgress&&/FAILED|ROLLBACK/.test(status),outputs:Object.fromEntries((stack.Outputs||[]).map(output=>[output.OutputKey,output.OutputValue]))};
  }
  if(stack?.StackStatus?.endsWith('_IN_PROGRESS')) fail('stack 작업이 진행 중입니다. --status로 확인하고 완료 후 다시 실행하세요.');
  if(stack?.StackStatus==='ROLLBACK_COMPLETE') fail('생성 실패로 ROLLBACK_COMPLETE 상태입니다. 이벤트를 확인하고 전용 stack을 정리하거나 다른 stack 이름으로 재시도하세요. 보존된 버킷은 자동 삭제하지 않습니다.');
  const identity=parse(run(['sts','get-caller-identity']));
  const existingProvider=selectOidcProvider(run,identity,stack);
  run(['cloudformation','validate-template','--template-body',`file://${settings.templatePath}`]);
  const parameters=[{ParameterKey:'ProjectName',ParameterValue:settings.projectName},{ParameterKey:'GitHubRepository',ParameterValue:settings.repository},{ParameterKey:'ExistingGitHubOidcProviderArn',ParameterValue:existingProvider}];
  const operation=stack?'update-stack':'create-stack';
  const command=['cloudformation',operation,'--stack-name',settings.stackName,'--template-body',`file://${settings.templatePath}`,'--parameters',JSON.stringify(parameters),'--capabilities','CAPABILITY_IAM','--tags',`Key=Application,Value=${application}`,`Key=Project,Value=${settings.projectName}`];
  log(`${settings.stackName}: 템플릿 검증 완료, ${operation} 제출`);
  try {
    const result=parse(run(command));
    return {stackName:settings.stackName,operation,stackId:result.StackId,applied:true,status:'REQUEST_SUBMITTED',next:'node scripts/aws-bootstrap.mjs --status',note:'CloudFront 배포 완료를 기다리지 않았습니다. 상태와 출력 URL을 확인하세요.'};
  } catch(error) {
    if(operation==='update-stack'&&/No updates are to be performed/.test(error.message)) return {stackName:settings.stackName,operation:'unchanged',applied:false,status:stack.StackStatus,outputs:Object.fromEntries((stack.Outputs||[]).map(output=>[output.OutputKey,output.OutputValue]))};
    throw error;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {const result=await runBootstrap();console.log(JSON.stringify(result,null,2));if(result.failed)process.exitCode=1;}
  catch(error) {console.error(error.message);process.exitCode=1;}
}

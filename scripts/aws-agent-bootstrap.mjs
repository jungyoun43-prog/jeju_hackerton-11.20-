import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { awsRunner, validateOidcSubject } from './aws-bootstrap.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const application='jeju-care-compass';
const parse=value=>typeof value==='string'?JSON.parse(value||'{}'):value;
const fail=message=>{throw new Error(message);};
const output=(stack,key)=>stack?.Outputs?.find(item=>item.OutputKey===key)?.OutputValue;
const parameter=(stack,key)=>stack?.Parameters?.find(item=>item.ParameterKey===key)?.ParameterValue;

export function agentBootstrapSettings(env=process.env,args=[],root=projectRoot) {
  if(args.some(arg=>!['--apply','--status','--link-site','--help'].includes(arg))) fail('사용법: node scripts/aws-agent-bootstrap.mjs [--apply | --status] [--link-site]');
  if(args.includes('--apply')&&args.includes('--status')) fail('--apply와 --status를 함께 사용할 수 없습니다.');
  if(args.includes('--status')&&args.includes('--link-site')) fail('--status는 agent stack만 조회합니다.');
  const settings={
    mode:args.includes('--help')?'help':args.includes('--status')?'status':args.includes('--apply')?'apply':'plan',
    linkSite:args.includes('--link-site'),region:env.AWS_REGION||env.AWS_DEFAULT_REGION||'ap-northeast-2',
    stackName:env.AWS_AGENT_STACK_NAME||'jeju-care-compass-agent',siteStackName:env.AWS_STACK_NAME||'jeju-care-compass-demo',
    distributionId:env.AWS_DISTRIBUTION_ID||'',projectName:env.PROJECT_NAME||application,
    enableModel:env.AGENT_MODEL_ENABLED||'false',enableStore:env.AGENT_SESSION_STORE_ENABLED||'false',
    modelId:env.BEDROCK_MODEL_ID||'apac.amazon.nova-lite-v1:0',dailyTurnLimit:String(env.DEMO_DAILY_TURN_LIMIT||80),
    enableOpenAI:env.AGENT_OPENAI_ENABLED||'false',openAIModelId:env.OPENAI_MODEL||'gpt-6.1-sol',
    templatePath:resolve(root,'infra/aws-agent-api.yaml'),siteTemplatePath:resolve(root,'infra/aws-static-site.yaml'),
  };
  if(settings.region!=='ap-northeast-2') fail('이 템플릿은 서울 ap-northeast-2 기준입니다. 다른 리전은 모델·OAC 검증 후 수정하세요.');
  if(!/^[A-Za-z][A-Za-z0-9-]{0,54}$/.test(settings.stackName)) fail('AWS_AGENT_STACK_NAME은 함수 이름 여유를 포함해 55자 이내여야 합니다.');
  if(!/^[A-Za-z][A-Za-z0-9-]{0,127}$/.test(settings.siteStackName)) fail('AWS_STACK_NAME 형식을 확인하세요.');
  if(!/^[a-z][a-z0-9-]{2,29}$/.test(settings.projectName)) fail('PROJECT_NAME 형식을 확인하세요.');
  if(![settings.enableModel,settings.enableStore,settings.enableOpenAI].every(value=>['true','false'].includes(value))) fail('모델·상태 저장 flag는 true 또는 false여야 합니다.');
  if(!['gpt-6.1-sol','gpt-6.1-terra'].includes(settings.openAIModelId)) fail('OPENAI_MODEL은 gpt-6.1-sol 또는 gpt-6.1-terra여야 합니다.');
  if(settings.enableOpenAI==='true'&&env.AGENT_SESSION_STORE_ENABLED==='false') fail('OpenAI 활성화에는 AGENT_SESSION_STORE_ENABLED=true인 영속 저장소가 필요합니다.');
  if(!/^apac\.amazon\.nova-(?:lite|micro|pro)-v1:0$/.test(settings.modelId)) fail('확인한 APAC Nova profile만 허용합니다. 모델 변경은 IAM 지역 범위도 검토하세요.');
  if(!/^\d+$/.test(settings.dailyTurnLimit)||Number(settings.dailyTurnLimit)<1||Number(settings.dailyTurnLimit)>80) fail('DEMO_DAILY_TURN_LIMIT은 1~80입니다.');
  if(settings.distributionId&&!/^[A-Z0-9]{8,32}$/.test(settings.distributionId)) fail('AWS_DISTRIBUTION_ID 형식을 확인하세요.');
  if(settings.mode==='apply'&&!settings.distributionId) fail('기존 사이트의 AWS_DISTRIBUTION_ID를 지정하세요.');
  return settings;
}

// 미지정 값은 기존 stack을 보존한다. 새 설정이 추가됐다는 이유로 활성 모델·예산을 끄지 않는다.
export function agentStackParameters(template,settings,env,stack) {
  const overrides={
    ProjectName:env.PROJECT_NAME,DistributionId:settings.distributionId,
    EnableModel:env.AGENT_MODEL_ENABLED,EnableSessionStore:env.AGENT_SESSION_STORE_ENABLED,
    BedrockModelId:env.BEDROCK_MODEL_ID,DemoDailyTurnLimit:env.DEMO_DAILY_TURN_LIMIT,
    EnableOpenAI:env.AGENT_OPENAI_ENABLED,OpenAIModelId:env.OPENAI_MODEL,
  };
  const effective={};
  const parameters=Object.entries(template.Parameters).map(([key,spec])=>{
    const explicit=overrides[key]!==undefined&&overrides[key]!=='';
    const previous=stack?.Parameters?.find(item=>item.ParameterKey===key);
    const value=explicit?String(overrides[key]):previous?.ParameterValue!==undefined?String(previous.ParameterValue):'Default' in spec?String(spec.Default):undefined;
    if(value===undefined) fail(`Agent 파라미터 ${key}를 확인할 수 없습니다.`);
    if(spec.AllowedValues&&!spec.AllowedValues.map(String).includes(value)) fail(`Agent 파라미터 ${key}의 허용 값을 확인하세요.`);
    if(spec.AllowedPattern&&!new RegExp(`^(?:${spec.AllowedPattern})$`).test(value)) fail(`Agent 파라미터 ${key}의 형식을 확인하세요.`);
    if(spec.Type==='Number'&&(!/^\d+$/.test(value)||Number(value)<spec.MinValue||Number(value)>spec.MaxValue)) fail(`Agent 파라미터 ${key}의 허용 범위를 확인하세요.`);
    effective[key]=value;
    return previous&&!explicit?{ParameterKey:key,UsePreviousValue:true}:{ParameterKey:key,ParameterValue:value};
  });
  if(effective.EnableOpenAI==='true'&&effective.EnableSessionStore!=='true') fail('OpenAI 활성화에는 AGENT_SESSION_STORE_ENABLED=true인 영속 세션·일일 예산 저장소가 필요합니다.');
  if(effective.EnableOpenAI==='true'&&effective.EnableModel!=='false') fail('OpenAI 활성화 시 기존 Bedrock AGENT_MODEL_ENABLED=false를 유지하세요.');
  return parameters;
}

function findOwnedStack(run,name) {
  let stack;
  try {stack=parse(run(['cloudformation','describe-stacks','--stack-name',name])).Stacks?.[0]||null;}
  catch(error) {if(/ValidationError[\s\S]*does not exist|Stack with id .+ does not exist/.test(error.message)) return null;throw error;}
  if(stack&&!stack.Tags?.some(tag=>tag.Key==='Application'&&tag.Value===application)) fail('이 앱의 소유 태그가 없는 stack은 변경하지 않습니다.');
  return stack;
}

function requireComplete(stack,label) {
  if(!stack) fail(`${label} stack이 없습니다.`);
  if(!['CREATE_COMPLETE','UPDATE_COMPLETE','UPDATE_ROLLBACK_COMPLETE'].includes(stack.StackStatus)) fail(`${label} stack의 안정화 완료를 확인하세요: ${stack.StackStatus}`);
}

export function linkedSiteParameters(template,siteStack,agentStack) {
  const repository=parameter(siteStack,'GitHubRepository');
  const subject=parameter(siteStack,'GitHubOidcSubject');
  if(!repository||!subject) fail('기존 사이트의 정확한 GitHub repository·production subject를 먼저 확정하세요.');
  validateOidcSubject(subject,repository);
  if(!siteStack.Parameters?.some(item=>item.ParameterKey==='ExistingGitHubOidcProviderArn')) fail('기존 OIDC provider 소유 파라미터를 확인할 수 없어 중단했습니다.');
  const additions={AgentOriginDomainName:output(agentStack,'AgentOriginDomainName'),AgentFunctionArn:output(agentStack,'AgentFunctionArn')};
  if(!/^[a-z0-9]+\.lambda-url\.[a-z0-9-]+\.on\.aws$/.test(additions.AgentOriginDomainName||'')||!/^arn:[a-z0-9-]+:lambda:[a-z0-9-]+:\d{12}:function:[A-Za-z0-9-_]+$/.test(additions.AgentFunctionArn||'')) fail('정상 agent stack의 URL·함수 ARN 출력이 필요합니다.');
  return Object.entries(template.Parameters).map(([key,spec])=>{
    if(key in additions) return {ParameterKey:key,ParameterValue:additions[key]};
    if(siteStack.Parameters.some(item=>item.ParameterKey===key)) return {ParameterKey:key,UsePreviousValue:true};
    if('Default' in spec) return {ParameterKey:key,ParameterValue:String(spec.Default)};
    fail(`기존 사이트 파라미터 ${key}를 보존할 수 없습니다.`);
  });
}

export async function runAgentBootstrap({env=process.env,args=process.argv.slice(2),root=projectRoot,run,log=console.log}={}) {
  const settings=agentBootstrapSettings(env,args,root);
  if(settings.mode==='help') return {help:'기본은 AWS 호출 없는 계획입니다. --apply: API stack 생성/갱신. 새 stack은 모델·DB 비활성, 기존 stack의 미지정 설정은 보존. OpenAI는 AGENT_OPENAI_ENABLED=true·AGENT_SESSION_STORE_ENABLED=true로 준비하며 키는 root가 Secret에 별도 입력합니다. --status: 상태. --link-site --apply: 기존 OAC origin 연결.'};
  const template=JSON.parse(await readFile(settings.templatePath,'utf8'));
  if(!template.Description?.includes('synthetic')) fail('합성 시연 API 템플릿을 확인하세요.');
  if(settings.mode==='plan') return {...settings,applied:false,changes:settings.linkSite?'기존 OIDC 소유·정확한 subject를 보존한 /api/agent* OAC 연결':'Node22 IAM API; OpenAI는 전용 Secret ARN·영속 budget과 함께 선택 활성화',note:'새 stack 기본값은 비활성이며 기존 미지정 설정은 보존합니다. 계획은 AWS를 조회하지 않습니다. Secret 값·로컬 .env를 읽거나 업로드하지 않으며 설정과 실제 모델 접근 성공은 구분합니다.'};
  run ||= awsRunner(env,settings.region,root);
  const agentStack=findOwnedStack(run,settings.stackName);
  if(settings.mode==='status') {
    const status=agentStack?.StackStatus||'NOT_FOUND';
    return {stackName:settings.stackName,status,inProgress:status.endsWith('_IN_PROGRESS'),failed:/FAILED|ROLLBACK/.test(status),outputs:Object.fromEntries((agentStack?.Outputs||[]).map(item=>[item.OutputKey,item.OutputValue])),applied:false};
  }
  const identity=parse(run(['sts','get-caller-identity']));
  if(!/^\d{12}$/.test(identity.Account||'')) fail('AWS 계정을 확인할 수 없습니다.');
  let stack=agentStack,name=settings.stackName,templatePath=settings.templatePath,parameters,tags;
  if(settings.linkSite) {
    requireComplete(agentStack,'Agent');
    const siteStack=findOwnedStack(run,settings.siteStackName);requireComplete(siteStack,'사이트');
    if(output(siteStack,'DistributionId')!==settings.distributionId||parameter(agentStack,'DistributionId')!==settings.distributionId) fail('두 stack과 지정한 CloudFront 배포가 일치하지 않습니다.');
    if(!output(agentStack,'AgentFunctionArn')?.includes(`:${identity.Account}:function:`)) fail('Agent 함수와 현재 AWS 계정이 일치하지 않습니다.');
    const siteTemplate=JSON.parse(await readFile(settings.siteTemplatePath,'utf8'));
    parameters=linkedSiteParameters(siteTemplate,siteStack,agentStack);
    stack=siteStack;name=settings.siteStackName;templatePath=settings.siteTemplatePath;tags=stack.Tags;
  } else {
    if(agentStack) requireComplete(agentStack,'Agent');
    // 기존 public site의 배포임을 읽기로 확인한 후에만 새 API의 권한 범위를 설정한다.
    const siteStack=findOwnedStack(run,settings.siteStackName);requireComplete(siteStack,'사이트');
    if(output(siteStack,'DistributionId')!==settings.distributionId) fail('기존 사이트와 CloudFront 배포가 일치하지 않습니다.');
    parameters=agentStackParameters(template,settings,env,agentStack);
    tags=agentStack?.Tags||[{Key:'Application',Value:application},{Key:'Project',Value:settings.projectName},{Key:'DataMode',Value:'synthetic'}];
  }
  run(['cloudformation','validate-template','--template-body',`file://${templatePath}`]);
  const operation=stack?'update-stack':'create-stack';
  log(`${name}: 검증 완료, ${operation} 제출`);
  try {
    const result=parse(run(['cloudformation',operation,'--stack-name',name,'--template-body',`file://${templatePath}`,'--parameters',JSON.stringify(parameters),'--capabilities','CAPABILITY_IAM','--tags',...tags.map(tag=>`Key=${tag.Key},Value=${tag.Value}`)]));
    return {stackName:name,operation,stackId:result.StackId,status:'REQUEST_SUBMITTED',applied:true,note:'장시간 waiter를 실행하지 않았습니다. stack 완료 후 검증 ZIP 게시와 공개 경로 확인이 필요합니다.'};
  } catch(error) {
    if(operation==='update-stack'&&/No updates are to be performed/.test(error.message)) return {stackName:name,operation:'unchanged',status:stack.StackStatus,applied:false};
    throw error;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await runAgentBootstrap(),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}

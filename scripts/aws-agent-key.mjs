import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { awsRunner } from './aws-bootstrap.mjs';
import { openAISettings } from '../agent/config.mjs';

const projectRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const application='jeju-care-compass';
const fail=message=>{throw new Error(message);};
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const privateFreeEnv=env=>Object.fromEntries(Object.entries(env).filter(([key])=>key!=='OPENAI_API_KEY'));
// Node의 child stdin은 Unix socket일 수 있다. Python의 실제 OS pipe로 바꿔
// AWS CLI가 /dev/stdin을 다시 열 수 있게 한다. 값은 메모리에만 머문다.
const cliPipeBridge='import subprocess,sys\nr=subprocess.run(sys.argv[1:],input=sys.stdin.buffer.read(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25)\nsys.stdout.buffer.write(r.stdout)\nsys.exit(r.returncode)';

/** SecretString은 argv·파일·로그가 아닌 파이프로만 전달한다. */
export function putKeyWithCli({env,root=projectRoot,region,secretArn,secretString,clientRequestToken,spawn=spawnSync}) {
  const result=spawn('python3',['-c',cliPipeBridge,env.AWS_CLI||'aws',
    'secretsmanager','put-secret-value','--secret-id',secretArn,
    '--secret-string','file:///dev/stdin','--client-request-token',clientRequestToken,
    '--region',region,'--no-cli-pager','--output','json',
  ],{cwd:root,env:{...privateFreeEnv(env),AWS_PAGER:'',AWS_CLI_AUTO_PROMPT:'off'},input:secretString,encoding:'utf8',timeout:30000,maxBuffer:65536});
  if(result.error||result.status!==0)fail('AWS 비밀값 업로드에 실패했습니다. CLI 인증·대상 Secret 권한을 확인해 주세요.');
  try {return JSON.parse(result.stdout);}catch {fail('비밀값 업로드 결과 형식을 확인하지 못했습니다.');}
}

export async function runAgentKeyUpload({env=process.env,args=process.argv.slice(2),root=projectRoot,run,upload=putKeyWithCli}={}) {
  if(args.some(arg=>!['--apply','--help'].includes(arg)))fail('사용법: node --env-file-if-exists=.env scripts/aws-agent-key.mjs [--apply]');
  if(args.includes('--help'))return {help:'기본은 계획만 출력합니다. --apply는 현재 OpenAI 키를 소유한 AWS Secret에만 stdin으로 저장합니다. 키 값은 출력하지 않습니다.'};
  const region=env.AWS_REGION||env.AWS_DEFAULT_REGION||'ap-northeast-2';
  const stackName=env.AWS_AGENT_STACK_NAME||'jeju-care-compass-agent';
  if(region!=='ap-northeast-2'||!/^[A-Za-z][A-Za-z0-9-]{0,54}$/.test(stackName))fail('서울 리전과 전용 Agent stack 이름을 확인해 주세요.');
  const settings=openAISettings(env);
  if(!args.includes('--apply'))return {applied:false,stackName,region,keyConfigured:Boolean(settings),transport:'AWS CLI stdin; no plaintext file or argument',note:'AWS 호출 없음. 실행에는 현재 키와 소유한 Secret 출력이 필요합니다.'};
  if(!settings)fail('OPENAI_API_KEY가 설정되지 않았습니다. 키를 채팅에 보내지 말고 .env에 넣어 주세요.');
  run ||= awsRunner(privateFreeEnv(env),region,root);
  let identity,stack,secret;
  try {
    identity=parse(run(['sts','get-caller-identity']));
    stack=parse(run(['cloudformation','describe-stacks','--stack-name',stackName])).Stacks?.[0];
  }catch {fail('AWS 계정·Agent stack 확인에 실패했습니다. 인증과 stack 상태를 확인해 주세요.');}
  if(!stack?.Tags?.some(tag=>tag.Key==='Application'&&tag.Value===application))fail('이 앱이 소유한 stack만 사용할 수 있습니다.');
  if(!['CREATE_COMPLETE','UPDATE_COMPLETE','UPDATE_ROLLBACK_COMPLETE'].includes(stack.StackStatus))fail('Agent stack 안정화 후 키를 업로드해 주세요.');
  for(const key of ['EnableOpenAI','EnableSessionStore']) {
    if(stack.Parameters?.find(parameter=>parameter.ParameterKey===key)?.ParameterValue!=='true')fail('OpenAI와 영속 호출 한도를 먼저 활성화해 주세요.');
  }
  const secretArn=stack.Outputs?.find(item=>item.OutputKey==='OpenAISecretArn')?.OutputValue;
  const expectedName=stackName+'/openai-api-key';
  const prefix=`arn:aws:secretsmanager:${region}:${identity.Account}:secret:${expectedName}-`;
  if(!/^\d{12}$/.test(identity.Account||'')||typeof secretArn!=='string'||!secretArn.startsWith(prefix)||!/^[A-Za-z0-9]{6}$/.test(secretArn.slice(prefix.length)))fail('현재 계정·리전·stack의 완전한 Secret ARN이 필요합니다.');
  try {secret=parse(run(['secretsmanager','describe-secret','--secret-id',secretArn]));}
  catch {fail('Secret 소유 정보를 확인하지 못했습니다.');}
  if(secret.ARN!==secretArn||secret.Name!==expectedName||secret.DeletedDate||!secret.Tags?.some(tag=>tag.Key==='Application'&&tag.Value===application))fail('소유 태그와 이름이 일치하는 활성 Secret만 갱신합니다.');
  const clientRequestToken=randomUUID();
  let result;
  try {result=parse(await upload({env,root,region,secretArn,secretString:JSON.stringify({OPENAI_API_KEY:settings.apiKey}),clientRequestToken}));}
  catch {fail('AWS 비밀값 업로드에 실패했습니다. 키 값과 공급자 오류 원문은 출력하지 않습니다.');}
  if(result.ARN!==secretArn||result.VersionId!==clientRequestToken)fail('업로드한 Secret 버전이 일치하지 않습니다.');
  return {applied:true,stackName,region,secretArn,versionId:result.VersionId,keyLogged:false,note:'값은 서버 비밀 저장소에만 전달했습니다. 코드 배포 후 공개 모델 응답을 별도로 확인하세요.'};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {console.log(JSON.stringify(await runAgentKeyUpload(),null,2));}
  catch(error) {console.error(error.message);process.exitCode=1;}
}

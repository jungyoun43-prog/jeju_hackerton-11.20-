import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createRuntimeAgent } from './config.mjs';
import { AgentError, isObject } from './errors.mjs';
import { readBody, validateMessageRequest, validateProgressRequest, validateResumeRequest } from './validation.mjs';
import { createAgentService } from './service.mjs';
import { PROGRESS_IO_TIMEOUT_MS } from './progress.mjs';

const REGION = 'ap-northeast-2';
const SDK_CONFIG = Object.freeze({maxAttempts:2,requestHandler:{connectionTimeout:1500,requestTimeout:3000}});
// budget ADD의 응답이 유실되면 SDK 재시도도 재차감이므로 DDB는 한 번만 보낸다.
export const DYNAMODB_SDK_CONFIG = Object.freeze({...SDK_CONFIG,maxAttempts:1});
const STORE_METHODS = ['loadOrCreate','acquire','release','save','consumeTurn'];
const text = value => typeof value === 'string' ? value.trim() : '';
const unavailable = () => new AgentError('CLOUD_RUNTIME_UNAVAILABLE','서버의 모델 연결을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.',503);
const hasSecretSetting = env => env.OPENAI_SECRET_ARN !== undefined && env.OPENAI_SECRET_ARN !== '';
const CONFIG_FIELDS = ['OPENAI_MODEL','OPENAI_REASONING_EFFORT','OPENAI_MAX_OUTPUT_TOKENS','OPENAI_TIMEOUT_MS','DEMO_DAILY_TURN_LIMIT'];

function cloudSettings(env, expectedAccountId, accountId) {
  const region = text(env.AWS_REGION) || text(env.AWS_DEFAULT_REGION) || REGION;
  const arn = text(env.OPENAI_SECRET_ARN), tableName = text(env.SESSION_TABLE_NAME);
  const match = /^arn:aws:secretsmanager:(ap-northeast-2):(\d{12}):secret:([A-Za-z0-9/_+=.@-]{1,512})-([A-Za-z0-9]{6})$/.exec(arn);
  const accounts = [expectedAccountId,env.AWS_ACCOUNT_ID,accountId].filter(value => value !== undefined && value !== '').map(text);
  if (region !== REGION || !match || !/^[A-Za-z0-9_.-]{3,255}$/.test(tableName)
    || !accounts.length || accounts.some(value => !/^\d{12}$/.test(value) || value !== match[2])) throw unavailable();
  return {region,arn,tableName,accountId:match[2]};
}
function secretKey(response, arn) {
  if (!isObject(response) || response.ARN !== arn || (response.$metadata?.httpStatusCode !== undefined && response.$metadata.httpStatusCode !== 200) || response.SecretBinary !== undefined || typeof response.SecretString !== 'string'
    || Buffer.byteLength(response.SecretString,'utf8') > 4096
    || (response.VersionStages !== undefined && (!Array.isArray(response.VersionStages) || !response.VersionStages.includes('AWSCURRENT')))) throw unavailable();
  let secret; try { secret = JSON.parse(response.SecretString); } catch { throw unavailable(); }
  if (!isObject(secret) || Object.keys(secret).length !== 1 || !Object.hasOwn(secret,'OPENAI_API_KEY') || typeof secret.OPENAI_API_KEY !== 'string') throw unavailable();
  const key = secret.OPENAI_API_KEY.trim();
  if (!key || key.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(key)) throw unavailable();
  return key;
}
async function bounded(promise, signal) {
  if (signal.aborted) throw unavailable();
  let onAbort;
  const interrupted = new Promise((_,reject) => {onAbort = () => reject(unavailable());signal.addEventListener('abort',onAbort,{once:true});});
  try { return await Promise.race([promise,interrupted]); } finally {signal.removeEventListener('abort',onAbort);}
}
async function defaultStoreFactory(options) {
  const {createDynamoSessionStore} = await import('./dynamodb-store.mjs');
  return createDynamoSessionStore(options);
}

/**
 * ARN이 없는 로컬 Node에서만 기존 동기 local factory를 사용한다.
 * cloud에서는 store 구성과 exact ARN/account/region 검증 후에만 키를 가져온다.
 * SDK client는 warm 재사용하고 secret/provider promise는 성공 시 캐시·실패 시 제거한다.
 * 비밀값·SDK 오류·환경 전체를 출력하지 않고 process.env를 변경하지 않는다.
 */
export function createCloudRuntimeGetter({env = process.env,secretsClient,documentClient,storeFactory = defaultStoreFactory,runtimeFactory = createRuntimeAgent,fetchImpl = globalThis.fetch,config = {},expectedAccountId,setupTimeoutMs = 8000} = {}) {
  if (!Number.isSafeInteger(setupTimeoutMs) || setupTimeoutMs < 1 || setupTimeoutMs > 10000 || typeof storeFactory !== 'function' || typeof runtimeFactory !== 'function') throw unavailable();
  let runtimePromise, cacheKey, cacheMode, storePromise, storeKey, progressPromise, progressCacheKey, secretClient = secretsClient, docClient = documentClient;
  function getStore(settings) {
    const identity=JSON.stringify({region:settings.region,tableName:settings.tableName,accountId:settings.accountId});
    if(!storePromise || storeKey !== identity) {
      storeKey=identity;
      docClient ??= DynamoDBDocumentClient.from(new DynamoDBClient({region:settings.region,...DYNAMODB_SDK_CONFIG}),{marshallOptions:{removeUndefinedValues:true}});
      const attempt=Promise.resolve().then(()=>storeFactory({client:docClient,tableName:settings.tableName,region:settings.region})).then(store=>{
        if(!isObject(store) || store.kind !== 'dynamodb' || STORE_METHODS.some(name=>typeof store[name] !== 'function'))throw unavailable();
        return store;
      }).catch(()=>{if(storePromise===attempt){storePromise=undefined;storeKey=undefined;}throw unavailable();});
      storePromise=attempt;
    }
    return storePromise;
  }
  async function boundedStore(settings,signal) {
    const attempt=getStore(settings);
    try {return await bounded(attempt,signal);}
    catch(error){if(storePromise===attempt){storePromise=undefined;storeKey=undefined;}throw error;}
  }
  function progressRuntime(settings) {
    const identity=JSON.stringify(settings);
    if(!progressPromise || progressCacheKey !== identity) {
      progressCacheKey=identity;
      const attempt=(async()=>{
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),PROGRESS_IO_TIMEOUT_MS);
        try {
          const store=await boundedStore(settings,controller.signal);
          // 조회 전용 runtime은 secret·유료 provider 구성·세션 생성·lease·budget을 실행하지 않는다.
          return createAgentService({store,config,progressReadOnly:true});
        } finally {clearTimeout(timer);controller.abort();}
      })().catch(()=>{if(progressPromise===attempt){progressPromise=undefined;progressCacheKey=undefined;}throw unavailable();});
      progressPromise=attempt;
    }
    return progressPromise;
  }
  async function initialize(settings) {
    const controller = new AbortController(),timer = setTimeout(() => controller.abort(),setupTimeoutMs);
    try {
      const store = await boundedStore(settings,controller.signal);
      secretClient ??= new SecretsManagerClient({region:settings.region,...SDK_CONFIG});
      const response = await bounded(Promise.resolve().then(() => secretClient.send(new GetSecretValueCommand({SecretId:settings.arn,VersionStage:'AWSCURRENT'}),{abortSignal:controller.signal})),controller.signal);
      const key = secretKey(response,settings.arn);
      // cloud ARN이 있으면 env의 plaintext 키를 읽거나 대체 키로 사용하지 않는다.
      const runtimeEnv = Object.fromEntries(CONFIG_FIELDS.filter(name => env[name] !== undefined).map(name => [name,env[name]]));
      runtimeEnv.OPENAI_API_KEY = key;
      const service = await bounded(Promise.resolve().then(() => runtimeFactory({env:runtimeEnv,store,fetchImpl,config})),controller.signal);
      if (!service || typeof service.handleAgentRequest !== 'function' || typeof service.getCapabilities !== 'function' || service.getCapabilities().llm !== true) throw unavailable();
      return service;
    } catch { throw unavailable(); }
    finally {clearTimeout(timer);controller.abort();}
  }
  return async function getRuntime({accountId,progressOnly=false} = {}) {
    try {
      if (!hasSecretSetting(env)) {
        // Lambda에서는 plaintext env key + memory store로 cloud gate를 우회하지 않는다.
        if (accountId !== undefined || env.AWS_LAMBDA_FUNCTION_NAME !== undefined) throw unavailable();
        // 진행·준비 조회만으로 provider/env 키를 구성하지 않고 기존 local runtime만 읽는다.
        if(progressOnly)return cacheMode === 'local' && runtimePromise ? await runtimePromise : createAgentService({config});
        if (cacheMode !== 'local') {runtimePromise=undefined;cacheKey=undefined;cacheMode='local';}
        if (!runtimePromise) runtimePromise = Promise.resolve().then(() => runtimeFactory({env,fetchImpl,config})).catch(() => {runtimePromise=undefined;throw unavailable();});
        return await runtimePromise;
      }
      const settings = cloudSettings(env,expectedAccountId,accountId);
      if(progressOnly)return await progressRuntime(settings);
      const identity = JSON.stringify({...settings,configuration:CONFIG_FIELDS.map(name => env[name] ?? '')});
      if (!runtimePromise || cacheMode !== 'cloud' || cacheKey !== identity) {
        cacheMode='cloud';cacheKey = identity;
        const attempt = initialize(settings).catch(() => {if(runtimePromise===attempt){runtimePromise=undefined;cacheKey=undefined;}throw unavailable();});
        runtimePromise = attempt;
      }
      return await runtimePromise;
    } catch { throw unavailable(); }
  };
}

function lambdaAccount(context) {
  if (context?.invokedFunctionArn === undefined) return undefined;
  const match = /^arn:aws:lambda:ap-northeast-2:(\d{12}):function:[A-Za-z0-9_-]+(?::[A-Za-z0-9_$-]+)?$/.exec(context.invokedFunctionArn);
  if (!match) throw unavailable();
  return match[1];
}
function errorResponse(requestId, fallback, resumeOnly = false) {
  const error = resumeOnly?new AgentError('SESSION_STORE_UNAVAILABLE','저장된 준비를 확인하지 못했습니다. 잠시 후 다시 불러와 주세요.',503):unavailable(), revision = fallback.getCapabilities().revision;
  return {statusCode:503,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','x-app-revision':revision},body:JSON.stringify({error:{code:error.code,message:error.message},requestId})};
}

/** Preview/잘못된 HTTP 입력은 secret·DB를 건드리지 않고 기존 안전한 서비스로 처리한다. */
export function createCloudAgentRequestHandler({getRuntime = createCloudRuntimeGetter(),config = {}} = {}) {
  const fallback = createRuntimeAgent({env:{},config});
  return async function handleRequest(input = {}, lambdaContext = {}) {
    const path = typeof input.path === 'string' ? input.path.split('?')[0] : '/', method = input.method ?? 'GET';
    const progressOnly=path === '/api/agent/progress';
    const resumeOnly=path === '/api/agent/resume', readOnly=progressOnly || resumeOnly;
    if (path !== '/api/agent' && !readOnly && !(path === '/api/agent/capabilities' && method === 'GET')) return fallback.handleAgentRequest(input);
    if ((path === '/api/agent' || readOnly) && method !== 'POST') return fallback.handleAgentRequest(input);
    let requestId = '';
    if (path === '/api/agent' || readOnly) {
      try {
        if(progressOnly)validateProgressRequest(readBody(input.body));
        else if(resumeOnly)validateResumeRequest(readBody(input.body));
        else requestId = validateMessageRequest(readBody(input.body)).requestId;
      } catch { return fallback.handleAgentRequest(input); }
      const type = Object.entries(input.headers ?? {}).find(([name]) => name.toLowerCase() === 'content-type')?.[1];
      if (type !== undefined && !/^application\/json(?:;|$)/i.test(String(type))) return fallback.handleAgentRequest(input);
    }
    try {
      const accountId=lambdaAccount(lambdaContext);
      const service = await getRuntime(readOnly?{accountId,progressOnly:true}:{accountId});
      return await service.handleAgentRequest(input);
    } catch {
      if (path === '/api/agent/capabilities' || progressOnly) return fallback.handleAgentRequest(input);
      return errorResponse(requestId,fallback,resumeOnly);
    }
  };
}

import { createAgentService } from './service.mjs';
import { createDisconnectedProvider } from './providers.mjs';
import { createOpenAIProvider } from './openai-provider.mjs';

export const OPENAI_MODELS=Object.freeze(['gpt-6.1-sol','gpt-6.1-terra']);
const text=value=>typeof value==='string'?value.trim():'';
function integer(value,fallback,min,max,name) {
  if(!text(value))return fallback;
  const number=Number(value);
  if(!Number.isSafeInteger(number)||number<min||number>max)throw new TypeError(`${name} 설정 범위를 확인해 주세요.`);
  return number;
}

/** 키 원문을 출력하거나 파일을 읽지 않는다. .env 로딩은 Node 실행 옵션이 맡는다. */
export function openAISettings(env={}) {
  const apiKey=text(env.OPENAI_API_KEY);
  if(!apiKey || /^(?:your[_ -]|replace[_ -]|여기에|<|sk-\.{3}|test[_ -]?key$)/i.test(apiKey))return null;
  if(/[\s\u0000-\u001f\u007f]/.test(apiKey)||apiKey.length>1024)throw new TypeError('OPENAI_API_KEY 형식을 확인해 주세요.');
  const model=text(env.OPENAI_MODEL)||OPENAI_MODELS[0];
  if(!OPENAI_MODELS.includes(model))throw new TypeError('OPENAI_MODEL은 gpt-6.1-sol 또는 gpt-6.1-terra로 설정해 주세요.');
  const reasoningEffort=text(env.OPENAI_REASONING_EFFORT)||'low';
  if(!['low','medium','high','xhigh','max'].includes(reasoningEffort))throw new TypeError('OPENAI_REASONING_EFFORT 설정을 확인해 주세요.');
  return {
    apiKey,model,reasoningEffort,
    maxOutputTokens:integer(env.OPENAI_MAX_OUTPUT_TOKENS,4096,256,8192,'OPENAI_MAX_OUTPUT_TOKENS'),
    timeoutMs:integer(env.OPENAI_TIMEOUT_MS,40000,1000,45000,'OPENAI_TIMEOUT_MS'),
  };
}

export function createRuntimeAgent({env=process.env,fetchImpl=fetch,store,config={}}={}) {
  const settings=openAISettings(env);
  const provider=settings?createOpenAIProvider({...settings,fetchImpl}):createDisconnectedProvider();
  // provider와 budget 환경도 명시적으로 주입하여 검사가 실제 계정·키를 사용하지 않게 한다.
  return createAgentService({provider,...(store?{store}:{}),config:{dailyTurns:integer(env.DEMO_DAILY_TURN_LIMIT,80,1,80,'DEMO_DAILY_TURN_LIMIT'),maxRounds:8,maxTools:16,...config}});
}

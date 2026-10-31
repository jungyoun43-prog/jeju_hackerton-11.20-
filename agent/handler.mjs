import { createRuntimeAgent } from './config.mjs';

// OPENAI_API_KEY가 있을 때만 호출 어댑터를 구성한다. 생성·상태 조회는 API를 호출하지 않는다.
const service = createRuntimeAgent();
export const handleAgentRequest = input => service.handleAgentRequest(input);
export function createLambdaHandler(handleRequest) {
  return async function lambdaHandler(event = {}) {
    let body = event.body;
    if (event.isBase64Encoded) {
      if (typeof body !== 'string' || body.length > 32768) return {statusCode:413,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify({error:{code:'BODY_TOO_LARGE',message:'요청 내용이 너무 깁니다.'},requestId:''})};
      body = Buffer.from(body,'base64').toString('utf8');
    }
    return handleRequest({method:event.requestContext?.http?.method ?? event.httpMethod ?? 'GET',path:event.rawPath ?? event.path ?? '/',headers:event.headers ?? {},body});
  };
}
export const handler=createLambdaHandler(handleAgentRequest);
export { createAgentService } from './service.mjs';
export { createConverseProvider, createDisconnectedProvider } from './providers.mjs';
export { createOpenAIProvider } from './openai-provider.mjs';

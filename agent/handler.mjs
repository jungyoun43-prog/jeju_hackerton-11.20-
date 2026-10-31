import { createCloudRuntimeGetter, createCloudAgentRequestHandler } from './cloud-runtime.mjs';

// local: env factory. cloud: Secrets Manager + DynamoDB를 첫 요청에만 준비한다.
const getRuntime = createCloudRuntimeGetter();
export const handleAgentRequest = createCloudAgentRequestHandler({getRuntime});
export function createLambdaHandler(handleRequest) {
  return async function lambdaHandler(event = {},context = {}) {
    let body = event.body;
    if (event.isBase64Encoded) {
      if (typeof body !== 'string' || body.length > 32768) return {statusCode:413,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify({error:{code:'BODY_TOO_LARGE',message:'요청 내용이 너무 깁니다.'},requestId:''})};
      body = Buffer.from(body,'base64').toString('utf8');
    }
    return handleRequest({method:event.requestContext?.http?.method ?? event.httpMethod ?? 'GET',path:event.rawPath ?? event.path ?? '/',headers:event.headers ?? {},body},context);
  };
}
export const handler=createLambdaHandler(handleAgentRequest);
export { createAgentService } from './service.mjs';
export { createConverseProvider, createDisconnectedProvider } from './providers.mjs';
export { createOpenAIProvider } from './openai-provider.mjs';

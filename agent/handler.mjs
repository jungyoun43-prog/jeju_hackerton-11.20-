import { createAgentService } from './service.mjs';

// 실제 모델 연결은 나중에 provider 한 곳에 주입한다. 환경값만으로 활성화하지 않는다.
const service = createAgentService();
export const handleAgentRequest = input => service.handleAgentRequest(input);
export async function handler(event = {}) {
  let body = event.body;
  if (event.isBase64Encoded) {
    if (typeof body !== 'string' || body.length > 32768) return {statusCode:413,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},body:JSON.stringify({error:{code:'BODY_TOO_LARGE',message:'요청 내용이 너무 깁니다.'},requestId:''})};
    body = Buffer.from(body,'base64').toString('utf8');
  }
  return handleAgentRequest({method:event.requestContext?.http?.method ?? event.httpMethod ?? 'GET',path:event.rawPath ?? event.path ?? '/',headers:event.headers ?? {},body});
}
export { createAgentService } from './service.mjs';
export { createConverseProvider, createDisconnectedProvider } from './providers.mjs';

import { AgentError } from './errors.mjs';

export function createDisconnectedProvider() {
  return Object.freeze({
    connected: false, model: '',
    async respond() { throw new AgentError('MODEL_NOT_CONNECTED', '대화 모델 API를 아직 연결하지 않았습니다. 입력은 보존되며 고정 대화 예시를 확인할 수 있습니다.', 503); },
  });
}

/**
 * 유일한 모델 연결 지점. default handler는 이 어댑터를 자동 활성화하지 않는다.
 * 승인된 공급자를 연결할 때 createAgentService({provider})에 주입한다.
 * respond 결과는 공급자와 무관하게 {content,stopReason}을 반환한다.
 */
export function createConverseProvider({ client, modelId, maxTokens = 800, region = 'ap-northeast-2' } = {}) {
  if (!modelId || !client?.send) throw new TypeError('명시적인 Bedrock client와 modelId가 필요합니다.');
  let available = true;
  return {
    get connected() { return available; }, model: modelId, region,
    async respond({system, messages, tools, signal}) {
      try {
        const { ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime');
        const response = await client.send(new ConverseCommand({
          modelId, system: [{text:system}], messages,
          inferenceConfig: {maxTokens: Math.min(1200, Math.max(1, maxTokens)), temperature:0.2},
          toolConfig: {tools:tools.map(tool => ({toolSpec:{name:tool.name, description:tool.description, inputSchema:{json:tool.inputSchema}}}))},
        }), {abortSignal:signal});
        const message = response.output?.message;
        if (message?.role !== 'assistant' || !Array.isArray(message.content)) throw new AgentError('INVALID_MODEL_RESPONSE', '모델 응답을 확인하지 못했습니다. 다시 시도해 주세요.', 502);
        return {content:message.content, stopReason:response.stopReason};
      } catch (error) {
        if (error instanceof AgentError) throw error;
        if (error?.name === 'AccessDeniedException' || (error?.name === 'ValidationException' && /Error 002/.test(error.message ?? ''))) {
          available = false;
          throw new AgentError('MODEL_NOT_CONNECTED', '모델 API 접근이 허용되지 않아 대화를 실행할 수 없습니다.', 503);
        }
        if (error?.name === 'AbortError' || signal?.aborted) throw new AgentError('AGENT_TIMEOUT', '처리 시간이 길어 요청을 중단했습니다. 다시 시도해 주세요.', 504);
        throw new AgentError('MODEL_UNAVAILABLE', '모델 API 응답을 받지 못했습니다. 잠시 후 다시 시도해 주세요.', 503);
      }
    },
  };
}

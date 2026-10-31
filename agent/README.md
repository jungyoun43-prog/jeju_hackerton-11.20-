# 보호자 대화 API 연결 준비

현재 런타임 모델은 미연결입니다. 일반 요청을 키워드나 고정 답변으로 대신 처리하지 않습니다. 전화·기록 연계도 실제 사업자 연결이 없으며 합성 자료·전화 역할 시연을 명시합니다.

- `GET /api/agent/capabilities`: 직접 capability 객체. 기본 `llm:false`, `phone:simulation`, `healthRecords:demo`. 모델·DB를 호출하지 않습니다.
- `POST /api/agent`: 공통 계약 DTO. 현재 `MODEL_NOT_CONNECTED`/503. 입력 원문을 저장하지 않습니다.
- `POST /api/agent/preview`: `{scenarioId:'aewol-parent-visit',requestId:'...12자이상...'}`만 받습니다. 임의 message를 거절하고 사전 작성 예시의 snapshot 검색·순수 reducer를 실행합니다. `isPreview:true`와 `previewMessages`를 반환하며 마지막 assistant는 reply와 같습니다. 모델·DB·전화망을 사용하지 않습니다. preview sessionId는 빈 문자열이며 일반 대화 세션으로 재사용하지 않습니다.

`agent/handler.mjs`의 `handler(event)`는 Lambda HTTP event를, `handleAgentRequest({method,path,body,headers})`는 로컬 서버를 받습니다. 두 경로의 반환은 `{statusCode,headers,body:JSON문자열}`입니다.

## 추후 모델 API 연결 지점

`createAgentService({provider})` 한 곳에 `{connected:true,model,respond}`를 주입합니다. `respond({system,messages,tools,signal})`는 `{content:[{text:'...'}|{toolUse:{toolUseId,name,input}}],stopReason:'tool_use'|'end_turn'}`를 반환합니다. Bedrock Converse 어댑터는 `createConverseProvider({client,modelId})`로 준비했지만 기본 handler에서 활성화하지 않습니다. modelId 환경값만으로 실제 연결 성공을 표시하지 않습니다. 공급자는 abort signal을 지키고, SDK client의 요청 시간·재시도를 제한해야 합니다. Converse는 maxTokens 800 기본값을 명시합니다. 계정 접근 차단은 미연결503으로 정리하며 SDK 오류 원문을 노출하지 않습니다.

모델의 도구 인자는 별도 allowlist 스키마로 검증하고, 상태는 공공 snapshot·고정 합성 템플릿·기존 domain reducer로만 변경합니다. 의료진 진찰 소견과 임상 결론을 생성하는 도구는 없습니다. 선택 병원은 현재 메시지에 명시된 공개 기관만 허용합니다. 실명·상세주소·임의 의료기록·출처 URL을 도구 입력으로 받지 않습니다. 공단 기록 연계는 승인된 어댑터가 없으므로 인증·조회 완료를 표시하거나 추측 endpoint를 만들지 않습니다.

## 상태·한도·배포

현재 기본 저장소는 인스턴스별 메모리이며 선택적 `store`를 주입할 수 있습니다. 미연결 일반 요청과 preview는 session store에 접근하지 않습니다. 연결 후에는 정규화된 합성 상태·opaque sessionId·requestId·턴 수·TTL만 저장하고 원문/대화 전문/모델 답변은 저장하지 않습니다. 세션 내 중복 requestId는 도구를 재실행하지 않습니다. 모델 오류·타임아웃의 도구 상태는 commit하지 않습니다. 실제 외부 작업이 추가되면 별도 영속 idempotency·승인/수신처 검증이 필요합니다.

기본 한도는 요청24KiB·메시지4,000자·최근이력8개/각2,000자·세션20턴·도구12개·루프6회·45초·하루80턴(인스턴스 기준)입니다. `DEMO_DAILY_TURN_LIMIT`만 1~1,000 사이에서 조정할 수 있습니다. 메모리 한도는 분산 Lambda의 전역 유료 호출 quota가 아니므로 실제 모델 공개 연결 전에는 영속 budget store 등을 붙여야 합니다. 현재 DynamoDB는 연결하지 않습니다. 미래 저장소는 pk String과 expiresAt epoch seconds TTL 규약을 따릅니다.

`APP_REVISION=<커밋SHA> node scripts/build-agent.mjs`는 esbuild·Python3를 사용해 `output/agent-lambda.zip`을 만듭니다. ZIP에는 `index.mjs`와 `deployment.json`이 있고 Handler는 `index.handler`입니다. metadata는 `{revision,runtime:'lambda',mode:'synthetic'}`이며 capabilities/revision 및 x-app-revision과 일치합니다. 비밀키와 .env는 포함하지 않습니다. SDK·공공 JSON·prompt는 Lambda bundle에 포함됩니다.

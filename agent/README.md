# 보호자 대화 API 연결 준비

루트 `.env`에 OpenAI 키를 넣으면 실제 API를 사용할 수 있는 연결 템플릿입니다. 기본 모델 `gpt-6.1-sol`, 선택 모델 `gpt-6.1-terra`만 사용하며 자동 fallback하지 않습니다. 실제 계정·모델 호출은 아직 검증하지 않았습니다. 전화·기록 연계는 계속 합성 자료·전화 역할 시연입니다.

- `GET /api/agent/capabilities`: 직접 capability 객체. 키가 없으면 llm:false, 키 설정 시 llm:true는 호출 어댑터 구성 상태이며 계정 접근 성공을 사전 검증한 값이 아닙니다. 상태 조회는 모델·DB를 호출하지 않습니다.
- `POST /api/agent`: 키 설정 시 OpenAI Responses API를 호출합니다. 키가 없으면 MODEL_NOT_CONNECTED/503. 입력 원문을 저장하지 않습니다.
- `POST /api/agent/preview`: `{scenarioId:'aewol-parent-visit',requestId:'...12자이상...'}`만 받습니다. 임의 message를 거절하고 사전 작성 예시의 snapshot 검색·순수 reducer를 실행합니다. `isPreview:true`와 `previewMessages`를 반환하며 마지막 assistant는 reply와 같습니다. 모델·DB·전화망을 사용하지 않습니다. preview sessionId는 빈 문자열이며 일반 대화 세션으로 재사용하지 않습니다.

`agent/handler.mjs`의 `handler(event)`는 Lambda HTTP event를, `handleAgentRequest({method,path,body,headers})`는 로컬 서버를 받습니다. 두 경로의 반환은 `{statusCode,headers,body:JSON문자열}`입니다.

## 키 입력과 실행

루트 `.env`에서 `OPENAI_API_KEY=` 뒤에 본인의 키를 입력하고 `npm run dev`를 다시 실행합니다. 템플릿은 `.env.example`이며 기존 키는 덮어쓰지 않습니다. `npm start`와 `npm run preview`도 루트 `.env`를 읽습니다. `OPENAI_MODEL=gpt-6.1-terra`로 바꾸면 Terra만 호출합니다. 기본값은 Sol입니다.

OpenAI 기본 한도는 reasoning low, 호출당 최대 출력4,096토큰, 호출 timeout40초·요청 전체45초, 요청당 최대8라운드·16도구, 인스턴스 하루80턴입니다. 출력 한도는 reasoning 토큰을 포함하며 잘린 응답을 완료로 표시하지 않습니다. 실제 계정의 권한·이용 한도는 키만으로 보장되지 않습니다.

서버가 store:false를 보내고 reasoning/encrypted 항목을 같은 요청 안의 다음 도구 결과와 함께 재전달합니다. 이 옵션은 공급자의 모든 보관 정책을 끄는 설정이 아닙니다. 키는 서버에서만 읽고 HTTP 응답·로그·브라우저·빌드·소스 ZIP에 넣지 않습니다. 로컬 `.env`는 AWS Lambda에 자동 배포되지 않습니다.

## 공급자 연결 지점

`agent/config.mjs`의 `createRuntimeAgent()`가 키 설정을 읽어 `createAgentService({provider})`에 주입합니다. `respond({system,messages,tools,signal,context})`는 `{content:[{text}|{toolUse}],stopReason,context?}`를 반환합니다. context는 한 요청의 reasoning replay에만 사용하고 세션·응답·로그에 저장하지 않습니다. OpenAI 어댑터는 고정 공식 HTTPS endpoint만 쓰고 redirect·자동 재시도·모델 fallback을 하지 않습니다. Bedrock Converse도 보존하되 기본 handler에서 선택하지 않습니다. 공급자 오류는 정해진 공개 문구로 처리하며 키나 오류 원문을 노출하지 않습니다.

모델의 도구 인자는 별도 allowlist 스키마로 검증하고, 상태는 공공 snapshot·고정 합성 템플릿·기존 domain reducer로만 변경합니다. 의료진 진찰 소견과 임상 결론을 생성하는 도구는 없습니다. 선택 병원은 현재 메시지에 명시된 공개 기관만 허용합니다. 실명·상세주소·임의 의료기록·출처 URL을 도구 입력으로 받지 않습니다. 공단 기록 연계는 승인된 어댑터가 없으므로 인증·조회 완료를 표시하거나 추측 endpoint를 만들지 않습니다.

## 상태·한도·배포

현재 기본 저장소는 인스턴스별 메모리이며 선택적 `store`를 주입할 수 있습니다. 미연결 일반 요청과 preview는 session store에 접근하지 않습니다. 연결 후에는 정규화된 합성 상태·opaque sessionId·requestId·턴 수·TTL만 저장하고 원문/대화 전문/모델 답변은 저장하지 않습니다. 세션 내 중복 requestId는 도구를 재실행하지 않습니다. 모델 오류·타임아웃의 도구 상태는 commit하지 않습니다. 실제 외부 작업이 추가되면 별도 영속 idempotency·승인/수신처 검증이 필요합니다.

기본 한도는 요청24KiB·메시지4,000자·최근이력8개/각2,000자·세션20턴·도구12개·루프6회·45초·하루80턴(인스턴스 기준)입니다. `DEMO_DAILY_TURN_LIMIT`만 1~1,000 사이에서 조정할 수 있습니다. 메모리 한도는 분산 Lambda의 전역 유료 호출 quota가 아니므로 실제 모델 공개 연결 전에는 영속 budget store 등을 붙여야 합니다. 현재 DynamoDB는 연결하지 않습니다. 미래 저장소는 pk String과 expiresAt epoch seconds TTL 규약을 따릅니다.

`APP_REVISION=<커밋SHA> node scripts/build-agent.mjs`는 esbuild·Python3를 사용해 `output/agent-lambda.zip`을 만듭니다. ZIP에는 `index.mjs`와 `deployment.json`이 있고 Handler는 `index.handler`입니다. metadata는 `{revision,runtime:'lambda',mode:'synthetic'}`이며 capabilities/revision 및 x-app-revision과 일치합니다. 비밀키와 .env는 포함하지 않습니다. SDK·공공 JSON·prompt는 Lambda bundle에 포함됩니다.

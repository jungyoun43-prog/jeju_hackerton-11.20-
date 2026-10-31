# Agent API 연결과 운영

로컬은 `.env`의 `OPENAI_API_KEY`로 실행하고 AWS는 Secrets Manager에서 키를 읽습니다. 기본 `gpt-6.1-sol`, 선택 `gpt-6.1-terra`만 사용하며 자동 대체하지 않습니다. 2026-10-31 로컬5.5초·공개 AWS5.2초의 Sol→get_case→응답을 각각 확인했습니다. Terra·복합 요청·모델 전반 품질은 별도입니다. 전화·공단 기록·의료진 회신은 합성 시연입니다.

## 경로와 실행

- `GET /api/agent/capabilities`: capability 객체. llm:true는 어댑터 설정이며 요청 성공을 보장하지 않습니다. AWS의 첫 조회는 Secret을 준비하지만 모델 추론·세션/예산 DB는 호출하지 않습니다. 준비 실패 시 llm:false를 반환합니다.
- `POST /api/agent`: `{message,requestId,sessionId?,history?}`. OpenAI Responses API와 검증된 도구를 실행합니다. 로컬 키가 없으면 MODEL_NOT_CONNECTED/503, AWS 키/저장소 준비 실패는 CLOUD_RUNTIME_UNAVAILABLE/503입니다.
- `POST /api/agent/preview`: `{scenarioId:'aewol-parent-visit',requestId}`. 별도 고정 예시이며 모델·Secret·세션 DB를 호출하지 않습니다.

로컬은 `.env.example`을 복사한 뒤 키를 채우고 `npm run dev`를 실행합니다. 기존 .env를 덮어쓰지 않습니다. `npm start`·`npm run preview`도 .env를 읽습니다. `OPENAI_MODEL=gpt-6.1-terra`는 Terra만 선택합니다. 키 없는 검사는 `OPENAI_API_KEY= PORT=4180 node scripts/server.mjs`로 실행합니다.

## 모델과 도구

`createRuntimeAgent({env,store})`가 provider를 구성하고 `createAgentService`에 주입합니다. Native fetch로 공식 HTTPS Responses endpoint만 사용하며 redirect·자동 재시도·모델 대체를 하지 않습니다. reasoning/encrypted 항목은 같은 요청의 도구 결과와 재전달하고 HTTP·로그·세션에 저장하지 않습니다. store:false는 공급자의 모든 보관 정책을 해제하는 설정이 아닙니다.

도구 인자는 allowlist 스키마로 검증합니다. 상태는 공공 snapshot·고정 합성 템플릿·도메인 reducer로만 변경합니다. 실명·상세주소·임의 의료기록·출처 URL을 도구 인자로 받지 않고 진찰 소견·임상 결론을 작성하지 않습니다. 공단 연계의 승인된 어댑터가 없어 조회 완료를 표시하지 않습니다. Bedrock 어댑터는 보존하되 선택하지 않습니다.

## 보관과 한도

로컬은 메모리, AWS는 `createDynamoSessionStore`입니다. AWS 저장 필드는 opaque sessionId·requestIds·턴 수·정규화된 합성 상태·TTL 및 처리 중 lease입니다. 원문·이력·모델 답변·reasoning·키는 저장하지 않습니다. 강한 읽기와65초 lease 소유권 조건으로 동시 저장을 보호하고, 애플리케이션에서도1시간 TTL 만료를 검사합니다. DynamoDB의 실제 삭제는 TTL 정책에 따라 지연될 수 있습니다.

기본 OpenAI 한도는 low reasoning·호출당 출력4,096토큰(추론 포함)·호출40초·처리 전체45초·최대8라운드/16도구·세션20턴입니다. 요청24KiB·message4,000자·최근이력8개/각2,000자이며 UI 입력은1,600자입니다. cloud 준비8초와 정리2.5초는 별도이고 브라우저는65초까지 기다립니다. Lambda·CloudFront origin은60초입니다.

AWS는 UTC 하루80개 대화 요청을 모델 호출 전에 조건부 원자 갱신으로 차감합니다. 한 요청 내부 Responses 호출은 최대8회이며 API 호출80회나 금액 한도를 뜻하지 않습니다. 실패한 요청도 차감하고 DB 오류 시 모델을 실행하지 않습니다. AWS store 상한은1~80이고 로컬 메모리 한도는 인스턴스별입니다.

중복 방지는 sessionId가 있는 세션 안에서만 적용합니다. 최초 응답 유실로 sessionId 없는 채 재시도하면 새 세션과 추가 유료 턴이 생길 수 있습니다. 실제 외부 작업은 아직 없고 전역80턴 한도는 유지됩니다. 이후 실제 발신·예약·결제를 붙이기 전에 최초 요청까지 포함한 영속 중복 방지가 필요합니다.

## AWS 키와 배포

Lambda는 전용 `OPENAI_SECRET_ARN`·`SESSION_TABLE_NAME`을 함께 요구하며 평문 키만으로 메모리 경로를 사용할 수 없습니다. exact ARN·계정·서울 리전과 한 필드 JSON을 확인하고 성공한 runtime을 warm cache에 둡니다. Secret·SDK 오류 원문은 공개하지 않습니다.

`scripts/aws-agent-key.mjs --apply`는 현재 계정·stack·소유 태그·활성 Secret을 확인하고 로컬 키를 메모리 파이프로만 전달합니다. CLI 인자·임시 비밀파일·자식 환경·GitHub·Lambda 환경변수·프런트·빌드·제출 ZIP에 키를 넣지 않습니다. AWS CLI와 Python3가 필요합니다. 키를 교체하면 코드 재게시 등으로 warm cache도 갱신합니다. 자세한 명령·롤백은 [배포 매뉴얼](../docs/deployment.md)을 따릅니다.

`APP_REVISION=<SHA> npm run build:agent`는 Node22·esbuild·Python3로 별도 `output/agent-lambda.zip`을 만듭니다. ZIP은 index.mjs·deployment.json, handler는 index.handler입니다. revision은 capabilities/x-app-revision과 일치합니다. SDK·공공 JSON·prompt를 번들하며 .env는 포함하지 않습니다.

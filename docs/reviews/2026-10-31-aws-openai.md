# AWS OpenAI 공개 활성화 전 독립 검토

확인일: 2026-10-31. 대상: 통합 main `0bbe7f2` 및 root의 service deadline·키 업로드 스크립트 작업본. 읽기 전용 검토이며 소스·AWS 리소스·모델 설정은 변경하지 않았다. `.env`·인증 파일·실제 키를 열람하지 않았고 AWS API·유료 모델을 호출하지 않았다.

## 판정

**현재 통합 코드에서 키 노출 또는 UTC 일일 전역 한도 우회를 일으키는 배포 차단 결함은 발견하지 못했다.** root가 예정한 브라우저 요청 대기 45→65초 변경과 아래 첫 요청 중복 처리 한계의 문서화를 반영하면 공개 활성화를 막을 추가 사유가 없다. 실제 Secret/IAM/DynamoDB 접근·공개 모델 응답은 root의 배포 후 검증 범위이며 이 검토로 성공을 대신 주장하지 않는다.

## 확인한 한계와 후속 사항

1. **P2 — 세션을 아직 받지 못한 첫 요청은 requestId 재사용만으로 중복 방지되지 않는다.** `agent/service.mjs:56`의 `loadOrCreate(request.sessionId)`는 sessionId가 없으면 새 세션을 생성하고, 중복 확인은 해당 세션의 requestIds에만 적용한다(`:60`). 첫 응답이 유실된 뒤 같은 본문·requestId를 다시 보내면 모델과 일일 turn을 다시 소비한다. 주입 provider/store 검사에서 동일 초기 requestId로 HTTP200 두 건, 서로 다른 세션, provider2회·budget2회를 재현했다. 세션을 이미 확보한 요청의 중복 방지와 전역80turn 제한은 유지된다. 합성 상태만 수정하고 외부 발신·예약·결제도 없어 이번 배포의 차단 사유로 분류하지 않았다. 문서에는 세션 범위 중복 방지와 첫 응답 유실 재시도의 추가 차감을 명시한다.
2. **P2 — 브라우저 45초는 서버 최악 처리 시간보다 짧다.** `app/conversation.js:249`는 검토 당시45초, cloud setup은 최대8초(`agent/cloud-runtime.mjs:52`), service는45초(`agent/service.mjs:45`), lease 정리는2.5초(`:111`)다. root는65초로 늘릴 예정이라고 알렸다. Lambda60초·CloudFront OriginReadTimeout60초 안에서 서버 오류가 먼저 돌아오도록 하며 provider/tool 상한은 그대로 유지하는 수정이 타당하다. 이 문서는 아직65초가 배포되었다고 주장하지 않는다.
3. **운영 한계 — 키 회전은 warm runtime을 자동 갱신하지 않는다.** 성공한 secret/provider promise는 동일 ARN/config 동안 캐시된다(`agent/cloud-runtime.mjs:83`). 현재 단일 키 업로드에는 문제가 없으나 추후 AWSCURRENT를 바꾸면 cold-start/코드 갱신 또는 별도 refresh 정책이 필요하다. 401/403 이후 provider가 비활성화되어도 성공한 runtime cache는 제거하지 않는다.
4. **한도 의미 — 80은 금액이나 모델 HTTP 호출 수가 아니다.** DynamoDB는 UTC 날짜별 `budget#YYYY-MM-DD`에서 대화 turn을 모델 호출 전에 원자적으로 예약한다. 한 turn 안의 Responses 호출은 runtime maxRounds8까지이므로 ‘일80개 대화 요청, 요청 내부 최대8회 모델 호출’로 표현한다. 실패한 turn도 환불하지 않는다.

## 핵심 확인 내용

- `infra/aws-agent-api.yaml`은 빈 전용 Secret만 만들고 ARN을 Lambda에 전달한다. `SecretString`·실제 키 stack 파라미터/출력은 없다. 실행 역할의 Secret 권한은 exact Ref ARN의 `secretsmanager:GetSecretValue` 한 작업이다. API 원점의 AWS_IAM/OAC·해당 배포 SourceArn 범위는 유지된다.
- `scripts/aws-agent-key.mjs:16`은 키를 AWS CLI argv·임시 파일 대신 stdin으로만 전달하며 자식 환경에서도 OPENAI_API_KEY를 제거한다. 현재 계정·리전·안정 stack·전용 이름·소유 태그·완전한 Secret ARN을 검사한 뒤 업로드한다. 실패에 원본 stderr·키·공급자 오류를 출력하지 않는다.
- `agent/cloud-runtime.mjs`는 exact ARN/account/region, 한 필드 JSON, AWSCURRENT와 DynamoDB store kind/필수 메서드를 검사한다. Secret 접근 실패·store 구성 실패는 안전한503이다. Lambda에서 ARN 누락 시 local plaintext key/memory 경로로 우회하던 문제는 후속 수정으로 막혔고 관련3개 검사도 통과했다.
- `agent/service.mjs`의 요청 deadline은 첫 DB 접근 전 시작한다. load/acquire/read/budget/save에 같은 AbortSignal을 전달하고 SDK·provider가 지연되어도 bounded 대기로 종료한다. release는 별도2.5초 상한이며 실패 시65초 lease가 회복 경로다. 정리 실패가 이미 성공한 저장 결과를 HTTP 오류로 바꾸지 않는다.
- `agent/dynamodb-store.mjs`는 consistent read, expiresAt의 애플리케이션 만료 검사, 독립 lease token과 조건부 획득·저장·해제를 사용한다. 이전 실행의 지연 save/release가 새 소유자를 덮거나 지우지 않는다. 세션에는 정규화된 합성 상태만 저장하고 원문 대화·reasoning·키/추가 context 필드를 거부한다.
- budget 증가의 조건은 `attribute_not_exists(#used) OR (#used >= :zero AND #used < :limit)`이며 같은 항목 Update의 `ADD #used :one`과 함께 수행한다. 제한은 store에서도1~80을 강제한다. 다른 실행100개 중80개만 통과하는 주입 검사를 확인했다.
- `agent/openai-provider.mjs`는 키를 Authorization 헤더에만 쓰고 API 응답·공급자 오류를 그대로 공개하지 않는다. reasoning은 요청 범위 WeakMap handle에만 두며 HTTP·상태 저장에 포함하지 않는다. 빌드는 `.env`를 읽거나 env 키를 literal로 치환하지 않는다.

## 롤백

보존 정책이 붙은 Secret·테이블을 가진 현재 CF stateful flag를 끄거나 template을 이전 형태로 돌리는 방식은 사용하지 않는다. 검증한 과거 코드 ZIP으로 Lambda 코드만 되돌리고 capabilities/실제 일반요청503·revision/hash를 확인하는 경로가 적합하다. 확인한 `32d0694:agent/handler.mjs`는 `createAgentService()`의 기본 disconnected provider를 사용하고 env를 모델 활성화에 쓰지 않는다. 따라서 남은 Secret/table pointer를 무시하여 모델 off가 된다. 구체 롤백 artifact 보존·게시·공개 검증은 root가 수행한다.

## 실행 검사

통합 root에서 다음 주입 검사87개가 모두 통과했다.

`node --test tests/dynamodb-store.test.mjs tests/agent.test.mjs tests/agent-infra.test.mjs tests/aws-secret-upload.test.mjs tests/cloud-runtime.test.mjs`

검사는 가짜 SDK/provider/CLI 입력을 사용하며 실제 AWS·모델 호출이나 민감값을 사용하지 않았다. 별도 초기 requestId 재전송 재현도 injected memory store/provider만 사용했다. 원본 DDB worktree에서 처음 실행한 검사는 SDK 의존성이 없어서 실행되지 않았고, 통합 root의 실제 모듈·설치된 의존성으로 다시 확인했다.

## 공식 근거

root가 insane-search로 보존한 `/tmp/jeju-aws-openai-{0,1,2,3}.txt`의 공식 원문을 사용했다. 이번 독립 검토에서 별도 웹 수집을 실행하지 않았다.

- [Secrets Manager JavaScript 조회와 GetSecretValue 권한](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets-javascript.html)
- [PutSecretValue의 민감값·CLI 인자 노출 주의와 버전 동작](https://docs.aws.amazon.com/cli/latest/reference/secretsmanager/put-secret-value.html)
- [CloudFormation Secret의 빈 값 생성·Ref ARN](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-secretsmanager-secret.html)
- [DynamoDB 조건식](https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Expressions.ConditionExpressions.html)

IAM·AWS SDK v3·DynamoDB 지침의 로컬 문서도 확인했다. 이번 작업은 기존 정책·코드의 검토이며 정책 생성이나 권한 변경을 수행하지 않았다.

## 통합 담당자의 후속 확인

브라우저65초와 재시도 한계는96563ea에 반영했다. 실제CLI 전송은 Node socket 재열기 실패를 Python 실제 OS pipe로 수정하고 가짜CLI 실프로세스 검사 후 적용했다. 공개 Sol→get_case→답변 HTTP200·5.2초, DynamoDB 세션 저장·같은세션재요청 예산1→1, 원점403을 확인했다. 이는 읽기 전용 검토자가 실제 AWS를 검사했다는 뜻이 아니다.

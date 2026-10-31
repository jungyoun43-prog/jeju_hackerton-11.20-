# AWS 데모 배포와 CI/CD

확인일: 2026-10-31. [공개 데모](https://d1mfksxrj025bx.cloudfront.net)는 S3·CloudFront·Lambda와 OpenAI Sol·Secrets Manager·DynamoDB를 사용한다. 공개 실제 Sol→get_case→응답 HTTP200·5.2초, 영속 상태·동일 세션 재요청 미차감·직접 원점403을 확인했다. 실제 전화·공단 기록·예약·배차는 미연동이다. 최종 SHA·CI 실행은 [검증 기록](implementation-results.md)과 orchestration/state.json을 따른다.

## 1. 경로와 외부 의존성

| 경로·산출물 | 처리 위치 |
| --- | --- |
| /·/workspace.html·정적 자산 | 서울 ap-northeast-2 비공개 S3·CloudFront OAC |
| /api/config·/api/health | 정적 JSON. 모델·병원 가용성 확인이 아님 |
| /api/agent* | 캐시 없는 Lambda origin. OAC가 AWS_IAM Function URL에 서명 |
| output/agent-lambda.zip | index.mjs·deployment.json의 Node22 ESM 코드. 사이트 S3에 올리지 않고 함수에 직접 게시 |
| output/jeju-care-compass-mvp.zip | 대회 제출용 개발 스냅샷. 함수 ZIP·정적 artifact와 구분 |

POST는 UTF-8 본문의 SHA256을 x-amz-content-sha256으로 보낸다. viewer Host만 제외해 전달하며 임의 X-Amz-* whitelist는 만들지 않는다. API no-store·정적 S3 읽기 전용을 유지한다. Lambda512MiB·60초·reserved concurrency2·로그7일이며 CloudFront OriginReadTimeout60초, 브라우저 대기65초다. 서버는 입력 원문·답변·reasoning을 로그/DB에 저장하지 않는다.

OpenAI·AWS·브라우저 음성·지도는 각 외부 서비스 정책·인터넷·사용량 비용에 의존한다. store:false가 공급자의 모든 보관을 해제하는 것은 아니다. 실제 환자 자료로 운영한 검증은 없다.

## 2. 인프라와 인증

AWS CLI2의 기본 인증 체인을 사용한다. 필요하면 로컬 `aws login --remote --profile jeju-deploy --region ap-northeast-2`로 인증한다. AWS_CLI로 설치 경로를 지정할 수 있다. 장기 키·인증 캐시는 소스/CI에 넣지 않는다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 GITHUB_REPOSITORY=jungyoun43-prog/jeju_hackerton-11.20- node scripts/aws-bootstrap.mjs
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 GITHUB_REPOSITORY=jungyoun43-prog/jeju_hackerton-11.20- node scripts/aws-bootstrap.mjs --apply
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 node scripts/aws-bootstrap.mjs --status
```

기본은 무접속 계획, --apply는 검증 후 요청 제출, --status는 완료/rollback 조회다. 버킷 공개 차단·암호화·버전·보존을 유지한다. immutable production OIDC subject와 기존 provider 소유권을 보존한다. 정적 stack 재적용 시 AgentOriginDomainName·AgentFunctionArn의 이전 값도 유지한다.

[API stack](../infra/aws-agent-api.yaml)은 기본 EnableOpenAI=false·EnableModel=false·EnableSessionStore=false다. 현재 배포는 OpenAI/SessionStore만 true이고 Bedrock은 false다. 아래 배포ID는 소유한 사이트 출력으로 바꾼다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_DISTRIBUTION_ID=배포ID AGENT_OPENAI_ENABLED=true AGENT_SESSION_STORE_ENABLED=true AGENT_MODEL_ENABLED=false OPENAI_MODEL=gpt-6.1-sol DEMO_DAILY_TURN_LIMIT=80 node scripts/aws-agent-bootstrap.mjs --apply
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 node scripts/aws-agent-bootstrap.mjs --status
```

OpenAI는 빈 전용 Secret과 테이블을 함께 만든다. SecretString을 CF 파라미터·코드에 넣지 않고 Lambda에 OPENAI_SECRET_ARN·SESSION_TABLE_NAME·AWS_ACCOUNT_ID만 전달한다. 실행 역할은 exact Secret GetSecretValue와 exact table의 필요한 작업만 허용한다. stack이 정상 완료되면 소유한 빈 Secret을 채운다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 node --env-file-if-exists=.env scripts/aws-agent-key.mjs
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 node --env-file-if-exists=.env scripts/aws-agent-key.mjs --apply
```

키는 .env에서 Node로 읽고 Python3 OS pipe→AWS CLI stdin으로만 전송한다. Node socket을 /dev/stdin으로 다시 여는 방식은 이 환경에서 실패해 실제 OS pipe를 사용한다. CLI argv·임시 비밀파일·자식 환경·GitHub·Lambda 환경변수에 평문 키를 넣지 않는다. 실패 출력도 정해진 문구만 사용한다. 키 교체 후에는 코드 재게시 등으로 warm cache도 새로 시작한다.

## 3. 코드 게시와 공개 확인

동일 소스를 검사하고 Node22·잠금 의존성·Python3로 번들한다. 검증한SHA·함수이름은 실제 값으로 바꾼다.

```bash
npm ci --ignore-scripts
npm test
APP_REVISION=검증한SHA npm run build:agent
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_AGENT_FUNCTION_NAME=함수이름 APP_REVISION=검증한SHA node scripts/aws-agent-publish.mjs --apply
```

게시 스크립트는 ZIP 경로·항목·revision·전용 태그·handler를 검사하고 RevisionId로 동시 갱신을 막는다. 함수가 정상 갱신된 뒤 확인한다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_AGENT_FUNCTION_NAME=함수이름 APP_REVISION=검증한SHA AWS_SITE_URL=https://공개주소 AGENT_EXPECT_MODEL=true OPENAI_MODEL=gpt-6.1-sol node scripts/aws-agent-publish.mjs --verify
```

검증은 코드 hash·공개 revision·모델 설정·실제 전화/공단 미연동 표시를 확인한다. 유료 추론을 실행하지 않으므로 실제 모델 스모크와 구분한다. 새 모델 연결에는 별도 최소 합성 요청으로 실제 응답·도구·저장을 확인한다. 직접 비인증 원점403·고정preview200도 대조한다.

신규 사이트 연결이 필요한 경우 API stack 출력으로 아래를 실행하며 기존 OIDC·정적 파라미터를 보존한다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_DISTRIBUTION_ID=배포ID node scripts/aws-agent-bootstrap.mjs --link-site --apply
```

## 4. GitHub Actions

production environment는 main만 허용한다. CI 역할은 전용 S3·CloudFront와 exact Lambda 코드 갱신/설정 조회/태그 조회에만 접근한다. Secret 값·Secret 변경·DynamoDB·IAM/CF 변경 권한을 주지 않는다.

| 변수 | 값 |
| --- | --- |
| AWS_REGION | ap-northeast-2 |
| AWS_SITE_BUCKET·AWS_DISTRIBUTION_ID·AWS_SITE_URL | 소유한 정적 stack 출력 |
| AWS_DEPLOY_ROLE_ARN | production OIDC 배포 역할 |
| AWS_DEPLOY_ENABLED | 정적 게시 true |
| AWS_AGENT_DEPLOY_ENABLED·AWS_AGENT_FUNCTION_NAME | 서버 게시 true·전용 함수 이름 |
| AGENT_EXPECT_MODEL | 현재 true. 모델 없는 코드로 rollback할 때 false |
| OPENAI_MODEL | 현재 gpt-6.1-sol. 키를 넣는 변수가 아님 |

재사용 CI는 설치·검사·정적/Lambda 빌드 뒤 같은 SHA의 artifact를 분리 보존한다. main 최신 커밋 여부를 확인해 OIDC로 게시하며 진행 중 업로드를 중간 취소하지 않는다. 정적 게시 시 소유권·symlink·대표 비밀 패턴·MIME·index 마지막 업로드를 검사한다. API는 코드 hash·정상 상태·공개 capabilities를 확인한다. 정적 revision과 API revision이 모두 같은 SHA여야 완료로 기록한다.

## 5. 상태·한도와 운영 한계

DynamoDB는 합성 준비 상태 TTL1시간, 강한 읽기·65초 lease 소유권·조건부 저장을 사용한다. 실제 TTL 삭제가 늦어져도 앱이 만료 항목을 거절한다. UTC 날짜 budget 항목의 조건부 ADD로 하루80개 요청을 모델 호출 전에 차감하고 실패도 차감한다. 요청 내부 Responses는 최대8회라서 API 호출80회·원화 비용 상한을 뜻하지 않는다. DB 실패는 모델 실행 전 안전한 오류로 처리한다.

같은 sessionId 안의 requestId 중복은 재실행/재차감하지 않는다. 첫 응답 유실로 sessionId 없이 재시도하면 새 세션과 유료 턴이 생길 수 있다. 실제 발신·예약·결제 전에는 초기 요청까지 포함한 영속 중복 방지가 필요하다. 로컬 메모리 한도는 분산 전역 한도가 아니다.

## 6. 롤백

소스 문제는 검토한 revert 커밋을 새 revision으로 배포한다. Secret·테이블을 Retain한 CF flag를 끄거나 리소스를 삭제하는 것은 코드 롤백에 포함하지 않는다. stateful flag를 끄면 보존 리소스가 stack에서 빠져 재활성화가 복잡해질 수 있다.

모델 긴급 중지는 검증한 과거 disconnected handler(32d0694)를 같은 태그·IAM/OAC 구성의 함수에 코드만 게시하는 경로다. 이 handler는 남아 있는 Secret/table 환경 포인터를 읽지 않는다. AGENT_EXPECT_MODEL=false로 설정하고 공개 llm:false·일반 요청503·revision/hash를 검증한다. 단지 모델 키가 없는 로컬 템플릿으로 돌아가는 것과 구분한다. rollback artifact는 해당 SHA의 Actions artifact 또는 격리 checkout에서 빌드하고 키 파일을 복사하지 않는다.

## 7. 검증 범위

cfn-lint1.59.0·AWS ValidateTemplate는 schema를 확인했다. cfn-guard3.2.1의 기존5개 S3/HTTPS 규칙은 API 리소스가 없어 SKIP이므로 API 보안 통과로 기록하지 않는다. 실제 CF UPDATE_COMPLETE와 공개 모델/DB 성공은 별도 확인했다. [독립 코드 검토](reviews/2026-10-31-aws-openai.md)는 실제 AWS·유료 호출을 하지 않았다. 센터 실기기·실제 마이크·의료진 참여·최종 PDF는 별도다.

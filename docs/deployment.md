# AWS 데모 배포와 CI/CD

2026-10-31. 기존 정적 공개 데모와 이번 대화 API 준비를 구분한다. **새 대화 UI·API의 사이트 연결·공개 revision 검증은 진행 중**이다. 실제 성공·실패·수정 이력은 [구현 결과](implementation-results.md)와 GitHub Actions를 따르며 템플릿·코드 작성만으로 배포 완료를 기록하지 않는다.

실제 LLM 연결은 후속 보류했다. 기본 API는 capabilities의 `llm:false`, 일반 요청의 `MODEL_NOT_CONNECTED`/503, 별도 고정 preview를 제공한다. 실제 전화·공단 기록·예약·배차·병원 전송을 활성화하지 않는다.

## 1. 정적 화면과 API의 경로

| 경로·산출물 | 처리 위치와 조건 |
| --- | --- |
| `/`, `/workspace.html`, 자산·공개 snapshot | 서울 `ap-northeast-2`의 비공개 S3·CloudFront OAC |
| `/api/config`, `/api/health` | S3 정적 JSON. health의 `runtime:static`은 모델·병원 상태 확인이 아님 |
| `/api/agent*` | 선택한 Lambda origin. CloudFront OAC가 AWS_IAM Function URL에 SigV4 인증, API 캐시 비활성 |
| `dist/` | 검증한 정적 사이트 artifact만 S3에 게시 |
| `output/agent-lambda.zip` | `index.mjs`·`deployment.json`으로 구성한 Node22 ESM Lambda 코드. S3 사이트에 올리지 않고 직접 업로드 |
| 제출용 MVP ZIP | `output/jeju-care-compass-mvp.zip`. Lambda 코드 ZIP·공개 사이트 artifact와 구분 |

브라우저는 POST 본문의 SHA256을 `x-amz-content-sha256`으로 보낸다. API origin은 viewer Host를 제외해 전달하고, CloudFront OAC가 Lambda origin에 서명한다. 임의의 `X-Amz-*` header whitelist를 만들지 않는다. API 응답은 no-store이며 허용하지 않은 경로·HTTP method는 handler가 거절한다. 정적 S3 기본 behavior는 읽기 전용을 유지한다.

Lambda는 512MiB·60초·reserved concurrency2이고 운영 로그는7일 보관한다. handler는 원문·대화 전문·실환자 기록을 로그/DB에 저장하지 않는다. 외부 서비스 사용량에 따른 AWS 비용은 발생할 수 있다. 키·Git·AWS 인증 캐시·backend ZIP은 공개 정적 경로에 게시하지 않는다.

## 2. 정적 사이트 인프라

AWS CLI2의 기본 인증 체인을 사용한다. 필요한 경우 로컬에서 `aws login --remote --profile jeju-deploy --region ap-northeast-2`로 인증하고 키·로그인 코드를 소스나 GitHub Secrets에 넣지 않는다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 GITHUB_REPOSITORY=jungyoun43-prog/jeju_hackerton-11.20- node scripts/aws-bootstrap.mjs
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 GITHUB_REPOSITORY=jungyoun43-prog/jeju_hackerton-11.20- node scripts/aws-bootstrap.mjs --apply
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 node scripts/aws-bootstrap.mjs --status
```

기본은 AWS 호출 없는 계획이다. `--apply`는 검증 후 create/update를 제출하고 즉시 반환한다. `--status`에서 정상 완료·진행·rollback을 확인한다. CLI가 PATH에 없으면 `AWS_CLI`를 지정한다. 버킷은 공개 차단·암호화·버전 관리·삭제/교체 보존을 유지한다.

출력은 `SiteBucketName`, `DistributionId`, `SiteUrl`, `DeployRoleArn`이다. 기존 GitHub OIDC provider 소유 조건과 정확한 production subject를 보존한다. GitHub가 immutable owner/repository ID를 쓰는 경우 발견한 정확한 subject를 그대로 사용하며 이름 기반·와일드카드 trust로 바꾸지 않는다. API origin 연결 후 정적 bootstrap을 재실행해도 `AgentOriginDomainName`·`AgentFunctionArn`의 이전 값을 보존해야 한다.

## 3. 선택 API stack과 코드 게시

[API 템플릿](../infra/aws-agent-api.yaml), [bootstrap](../scripts/aws-agent-bootstrap.mjs)은 기존 사이트 소유 태그와 배포 ID를 확인한 뒤 별도 API stack을 만든다. `EnableModel=false`, `EnableSessionStore=false`가 기본이다. 모델 권한·DDB resource는 조건부이고 현재 저장 어댑터는 구현하지 않았다. flag 변경만으로 실제 공급자·영속 budget이 연결되지는 않는다.

아래 `배포ID`·`함수이름`은 정상 완료한 stack 출력으로 바꾼다. 모델을 연결하지 않는 현재 배포에서는 두 비활성 기본값을 유지한다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_DISTRIBUTION_ID=배포ID node scripts/aws-agent-bootstrap.mjs
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_DISTRIBUTION_ID=배포ID node scripts/aws-agent-bootstrap.mjs --apply
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 node scripts/aws-agent-bootstrap.mjs --status
```

API stack 정상 완료 후 동일 커밋의 소스를 검사·번들한다. Node22·잠금 의존성·Python3가 필요하다. 아래 `검증한SHA`는 실제 커밋으로 바꾼다.

```bash
npm ci --ignore-scripts
npm test
APP_REVISION=검증한SHA npm run build:agent
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_AGENT_FUNCTION_NAME=함수이름 APP_REVISION=검증한SHA node scripts/aws-agent-publish.mjs
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_AGENT_FUNCTION_NAME=함수이름 APP_REVISION=검증한SHA node scripts/aws-agent-publish.mjs --apply
```

게시 스크립트는 고정 경로·ZIP 항목·빌드 명세·revision·전용 함수 태그·handler를 검사하고 낙관적 RevisionId로 코드를 갱신한다. 장시간 waiter는 실행하지 않는다. 초기 CloudFormation inline 코드는503 placeholder이므로 ZIP 게시가 필요하다.

코드 갱신 뒤 `AgentOriginDomainName`·`AgentFunctionArn` 출력으로 사이트를 연결한다. 링크 스크립트는 기존 subject·provider 소유·다른 파라미터를 previous value로 보존한다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_DISTRIBUTION_ID=배포ID node scripts/aws-agent-bootstrap.mjs --link-site --apply
```

CloudFormation·CloudFront 정상 완료와 API 코드 갱신 뒤 확인한다. `AWS_SITE_URL`은 실제 HTTPS 공개 주소다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_AGENT_FUNCTION_NAME=함수이름 APP_REVISION=검증한SHA AWS_SITE_URL=https://공개주소 node scripts/aws-agent-publish.mjs --verify
```

이 검사는 코드 hash와 공개 capabilities revision·미연동 표시를 확인한다. 별도로 일반 POST503, 고정 preview200·합성 표시, 직접 비인증 Lambda URL403, 정적 health·화면·출처를 확인한다. 실제 모델 추론·마이크·병원 발신 검증을 대신하지 않는다.

## 4. GitHub Variables와 OIDC

`production` environment는 main 브랜치만 허용한다. 기존 역할은 전용 버킷·CloudFront 배포에만 정적 게시 권한을 갖고, API 연결 시 정확한 함수의 코드 갱신·설정 조회·태그 조회 권한만 추가한다. CI에 IAM·인프라 변경·모델 호출 권한을 주지 않는다.

| 변수 | 설정 |
| --- | --- |
| `AWS_REGION` | `ap-northeast-2` |
| `AWS_SITE_BUCKET` | `SiteBucketName` |
| `AWS_DISTRIBUTION_ID` | `DistributionId` |
| `AWS_SITE_URL` | `SiteUrl` |
| `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` |
| `AWS_DEPLOY_ENABLED` | 정적 배포 설정·권한 확인 후 `true` |
| `AWS_AGENT_DEPLOY_ENABLED` | 기본 미설정/false. API origin·코드 게시·권한 확인 후 명시적으로 `true` |
| `AWS_AGENT_FUNCTION_NAME` | API 배포를 켤 때 `AgentFunctionName` |

장기 access key/secret key를 저장하지 않는다. API toggle이 꺼져 있으면 backend 게시·검증만 생략하고 정적 사이트는 정상 배포한다. static toggle이 꺼져 있으면 CI는 실행하고 AWS 배포 job을 건너뛴다.

## 5. 자동 배포와 검증

재사용 CI는 설치·검사·정적 빌드·별도 Lambda 빌드를 하고 같은 SHA의 `jeju-static-<SHA>`·`jeju-agent-<SHA>` artifact를 나눠 보존한다. main 배포는 최신 커밋 여부를 먼저 확인하고, 검증한 artifact를 내려받아 OIDC 역할로 게시한다. backend는 명시한 toggle에서만 Lambda에 직접 올린다. action은 확인한40자리 SHA로 고정한다.

배포는 직렬화하고 진행 중 업로드를 중간 취소하지 않는다. 정적 게시 스크립트는 버킷 태그·origin·실제 dist 경로·symlink·대표 키 패턴을 검사하고 JSON MIME·index 마지막 게시·비파괴 업로드를 따른다. 캐시 무효화 후 공개 deployment revision·정적 health·HTML을 확인한다. API 배포 때는 Lambda 코드 hash·정상 상태·공개 capabilities revision도 확인한다. 모델 미설정 배포는 `llm:false`여야 한다.

## 6. 재게시와 롤백

정적 재게시:

```bash
APP_REVISION=검증한SHA npm run build
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_SITE_BUCKET=버킷명 AWS_DISTRIBUTION_ID=배포ID node scripts/aws-publish.mjs --directory dist
```

backend는 같은 SHA로 다시 빌드한 ZIP을 전용 게시 스크립트로 올리고 hash·공개 revision을 재검증한다. 소스 문제는 검토한 커밋을 `git revert`하고 main에 push해 이전 동작을 새 revision으로 배포한다. 함수·인프라·버킷·테이블 삭제는 자동 롤백에 포함하지 않는다. S3 버전 관리나 게시 요청 성공만으로 공개 CloudFront 전파가 끝났다고 기록하지 않는다.

## 7. 모델·상태 연결 전의 제한

`createAgentService({provider})`와 [API 연결 문서](../agent/README.md)가 후속 연결 지점이다. Bedrock SDK3.1161.0과 Converse 어댑터가 있어도 기본 handler는 연결하지 않는다. 실제 합성 probe는 계정 Error002로 실패했으며 사용자 요청으로 추가 시도를 중단했다. 조회한 APAC Nova 후보 profile은 서울·도쿄·오사카·싱가포르·시드니·뭄바이 모델 지역을 포함하므로 실제 연결 전 전송 지역·계약·요금·접근을 확인한다.

기본 메모리 세션의 일일80턴은 인스턴스별 한도다. 분산 Lambda의 전역 유료 호출 quota가 아니며 DDB flag를 켜도 저장 어댑터가 자동 구현되지 않는다. 실제 모델을 공개 연결하기 전에 영속 budget·외부 작업 idempotency·민감정보 처리·공급자 실패를 검증한다. 현재 일반 미연결 요청·preview는 모델·session store에 접근하지 않는다.

## 8. 검사 범위

cfn-lint1.59.0은 두 템플릿 schema를, cfn-guard3.2.1의 기존5개 규칙은 버킷·HTTPS를 검사한다. API 템플릿은 해당 리소스가 없어 기존 guard 규칙이 SKIP이므로 이를 API 보안 통과로 기록하지 않는다. API의 IAM origin·조건부 권한·한도·archive·revision은 별도 단위 검사를 사용한다. ValidateTemplate·로컬 lint 통과와 실제 서비스 생성 검증은 다르다. 실패·수정과 최종 공개 검증은 결과 기록에 남긴다.

과거 계정 조회에서 별도 CloudTrail trail0개가 관측됐으며 장기 audit trail을 검증한 것은 아니다. 원문·버전·확인 범위는 [외부 의존성](../THIRD_PARTY.md)과 제출 자료에 함께 기록한다.

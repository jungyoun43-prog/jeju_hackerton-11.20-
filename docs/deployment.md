# AWS 데모 배포와 CI/CD

현재 실행 기록은 [오케스트레이션 상태](../orchestration/state.json)를 따른다. 실제 URL·GitHub Actions 성공 여부는 확인 후 README에 기록한다. 이 배포는 합성 사례 MVP의 공개 웹 시연이며 실제 전화·LLM·병원 기록 전송을 활성화하지 않는다.

## 구조

- 서울 `ap-northeast-2`의 전용 비공개 S3 버킷, CloudFront HTTPS/OAC.
- 정적 앱·Leaflet·생성 이미지, 공개 시연 설정만 배포한다. 서버·Git·AWS 인증 캐시는 업로드하지 않는다.
- `/api/config`, `/api/health`는 정적 JSON 객체다. health의 `runtime:static`과 전화·전송 false는 실제 서버/의료 서비스 상태 점검과 다르다.
- 버킷 객체는 버전 관리·암호화하고 삭제/교체 시 보존한다. CloudFront·S3는 사용량에 따른 AWS 비용이 발생한다.
- AWS 계정의 기존 GitHub OIDC provider는 재사용하며 기존 stack의 provider 소유 조건을 뒤집지 않는다.

## 최초 인프라 생성

AWS CLI 2를 설치하고 서버에서 `aws login --remote --profile jeju-deploy --region ap-northeast-2`로 인증한다. 키·연결 코드를 소스나 GitHub Secrets에 넣지 않는다.

```bash
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 GITHUB_REPOSITORY=jungyoun43-prog/jeju_hackerton-11.20- node scripts/aws-bootstrap.mjs
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 GITHUB_REPOSITORY=jungyoun43-prog/jeju_hackerton-11.20- node scripts/aws-bootstrap.mjs --apply
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 node scripts/aws-bootstrap.mjs --status
```

기본은 변경 없는 계획이다. `--apply`는 템플릿 검증 후 create/update를 제출하고 즉시 반환한다. `--status`가 CREATE_COMPLETE/UPDATE_COMPLETE인지, 실패·rollback 상태인지 확인한다. 기존 다른 앱의 같은 이름 stack은 변경하지 않는다. CLI가 PATH에 없으면 `AWS_CLI`에 실행 파일 경로를 설정한다.

Outputs는 `SiteBucketName`, `DistributionId`, `SiteUrl`, `DeployRoleArn`이다. 콘솔 로그인은 로컬 인프라 작업용이며 CI는 별도의 OIDC 역할을 쓴다.

## GitHub 설정

저장소의 `production` environment는 main 브랜치만 허용한다. 역할 trust는 정확한 저장소/environment와 STS audience를 검사하고, 버킷·배포 한 쌍에만 파일 게시·조회·캐시 무효화를 허용한다.

Repository Variables를 성공한 인프라 출력으로 설정한다.

| 변수 | 값 |
| --- | --- |
| `AWS_REGION` | `ap-northeast-2` |
| `AWS_SITE_BUCKET` | `SiteBucketName` |
| `AWS_DISTRIBUTION_ID` | `DistributionId` |
| `AWS_SITE_URL` | `SiteUrl` |
| `AWS_DEPLOY_ROLE_ARN` | `DeployRoleArn` |
| `AWS_DEPLOY_ENABLED` | 모든 설정·권한을 확인한 뒤 `true` |

실제 AWS access key/secret key를 저장하는 단계는 없다. 설정 전에는 CI 검사는 수행하고 AWS 배포 job은 skip한다.

## 자동 배포와 검증

PR은 재사용 CI의 설치·검사·빌드를 수행한다. main push와 수동 workflow_dispatch는 같은 CI를 호출하고, 통과한 **동일 dist artifact**를 production job에서 내려받아 게시한다. actions는 확인한 40자리 commit SHA로 고정한다.

오래된 main 커밋이면 AWS 역할을 얻기 전에 배포를 건너뛴다. 배포 작업은 직렬화하며 진행 중인 업로드를 임의로 취소하지 않는다. 게시 스크립트가 버킷 태그·origin을 먼저 검사하고 dist 밖 경로·symlink·숨김 파일·대표 키 패턴을 거부한다. JSON은 정확한 MIME으로, index는 마지막에 업로드하며 기존 객체를 무조건 삭제하지 않는다.

캐시 무효화 요청 후 HTTPS의 배포 revision·정적 health·메인 HTML을 확인한다. Actions의 성공과 사이트 URL 확인까지 끝나야 배포 완료로 기록한다. 상태·진행 기록은 GitHub Actions와 CloudFormation 이벤트로 관측한다.

## 수동 재게시와 롤백

```bash
npm ci --ignore-scripts
npm test
npm run build
AWS_PROFILE=jeju-deploy AWS_REGION=ap-northeast-2 AWS_SITE_BUCKET=버킷명 AWS_DISTRIBUTION_ID=배포ID node scripts/aws-publish.mjs --directory dist
```

배포의 게시 결과와 CloudFront 전파 완료는 다르다. URL의 `deployment.json`을 확인한다. 소스 문제는 해당 커밋을 `git revert`하고 main에 push해 이전 동작을 새 revision으로 다시 배포한다. 인프라·버킷 삭제는 이 자동 롤백에 포함하지 않는다.

## 검사 범위

로컬 cfn-lint 1.59.0은 템플릿 속성·schema, cfn-guard 3.2.1은 이 프로젝트의 다섯 가지 버킷/HTTPS 규칙을 검사했다. guard 통과는 모든 보안·규정 준수 인증이 아니다. AWS validate-template와 기본 활성화된 CloudFormation 서비스 검증을 함께 확인한다. 계정에 구성된 CloudTrail trail은 0개로 관측했으며 장기 별도 audit trail의 정상 작동을 검증한 것은 아니다.

원문·버전·검증 상태는 [외부 의존성 명세](../THIRD_PARTY.md)와 제출 자료에 함께 남긴다.

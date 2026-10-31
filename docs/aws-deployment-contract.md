# AWS 배포·CI/CD 공통 계약

요청일: 2026-10-31. 사용자는 AWS에서 볼 수 있는 배포와 자동 CI/CD를 요청했다. GitHub 저장소는 `jungyoun43-prog/jeju_hackerton-11.20-`이며 현재 비어 있는 private 저장소다. GitHub 읽기·쓰기 인증은 확인했다. AWS 계정 인증은 사용자가 서버에서 `aws login --remote --profile jeju-deploy --region ap-northeast-2`로 연결 중이다. 로그인 성공·계정 권한은 아직 검증하지 않았다.

## 구조

정적 MVP를 **비공개 S3 origin + CloudFront HTTPS**로 공개한다. 실제 환자 기록이나 서버의 인증정보를 업로드하지 않는다. CloudFront 링크를 아는 사람이 합성 시연을 볼 수 있는 공개 데모다. 실제 LLM·전화·병원 전송은 여전히 미연동이다.

GitHub Actions는 PR/push에서 설치·단위 검사·정적 빌드를 수행한다. `main`의 승인된 배포 job만 OIDC로 AWS 역할을 받아 전용 버킷에 배포하고 CloudFront 캐시를 무효화한다. 장기 AWS access key를 GitHub Secrets에 저장하지 않는다. AWS 설정 전에는 배포 job을 명시적으로 skip하고 테스트는 실행한다.

## 소유 파일과 인터페이스

| 작업 | 소유 파일 |
| --- | --- |
| aws-infra | `infra/aws-static-site.yaml`, `scripts/aws-bootstrap.mjs`, `scripts/aws-publish.mjs`, `tests/aws-infra.test.mjs` |
| aws-ci | `.github/workflows/ci.yml`, `.github/workflows/deploy-aws.yml`, `scripts/build.mjs`, `tests/static-hosting.test.mjs` |
| 통합 | README, package.json, 배포 매뉴얼·의존성 문서, orchestration/*, 인증·GitHub 설정·실제 배포·검증 |

CloudFormation 파라미터: `ProjectName` (기본 `jeju-care-compass`), `GitHubRepository` (`owner/repo`), `ExistingGitHubOidcProviderArn` (기존 provider가 있으면 ARN, 없으면 빈 문자열). 출력: `SiteBucketName`, `DistributionId`, `SiteUrl`, `DeployRoleArn`.

OIDC 신뢰 subject는 `repo:<owner/repo>:environment:production`, audience는 `sts.amazonaws.com`이다. 통합 담당자가 GitHub `production` environment의 배포 브랜치를 `main`으로 제한한다. 배포 역할은 전용 버킷의 파일 배포·목록, 지정 배포의 캐시 무효화에 필요한 권한만 갖는다. 인프라 자체 수정 권한은 CI에 부여하지 않는다.

GitHub Repository Variables: `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `AWS_SITE_BUCKET`, `AWS_DISTRIBUTION_ID`, `AWS_SITE_URL`, `AWS_DEPLOY_ENABLED`. AWS 설정 전 ENABLED는 false/미설정이며 성공한 인프라 출력으로 root가 채운다. 리전 기본은 서울 `ap-northeast-2`, 실제 계정 권한 확인 후 적용한다.

`node scripts/aws-bootstrap.mjs`는 `AWS_PROFILE=jeju-deploy`, `AWS_REGION=ap-northeast-2`, `GITHUB_REPOSITORY=owner/repo`를 사용한다. 기본은 검토 가능한 계획 출력이며 `--apply` 시 전용 CloudFormation stack을 생성/갱신한다. 실제 적용은 통합 담당자가 사용자 요청 범위에서 실행한다. 스크립트는 기존 GitHub OIDC provider를 재사용한다. stack name은 `jeju-care-compass-demo`. 상태 대기는 60초 이내에 반환/출력해 관측할 수 있게 한다.

`node scripts/aws-publish.mjs --directory dist`는 `AWS_SITE_BUCKET`, `AWS_DISTRIBUTION_ID`, `AWS_REGION`을 입력으로 받으며 AWS CLI 기본 provider chain을 쓴다. CI는 OIDC, 로컬은 `AWS_PROFILE`을 사용한다. `.env`·Git·실환자 파일을 올리지 않으며 dist만 게시한다. index/JS/CSS 등 이름이 고정된 파일에 immutable 장기 브라우저 캐시를 주지 않는다. 버킷은 이 앱 전용이다. 기존 파일을 무조건 삭제하는 것보다 검증·복원 가능성을 우선한다.

## 정적 호스팅 계약

기존 `/api/config`, `/api/health`는 Node 서버 전용이므로 빌드에 동일 JSON 형태의 **정적 객체**를 각각 `dist/api/config`, `dist/api/health`로 생성한다. 업로드 때 이 두 객체의 Content-Type을 `application/json`으로 지정한다. config는 `mode:simulation`, 공개 `tileUrl`만 포함한다. health는 시연 표식·실전화/전송 false이며 서버 상태나 실제 통신 점검이라고 과장하지 않는다. 빌드 버전은 `dist/deployment.json`에 `{revision,builtAt,mode}`로 공개할 수 있다. 실제 인증값을 빌드 환경에서 추출하지 않는다.

## 검증과 실행 증거

단위 검사·빌드·템플릿 구조 검토와 실제 AWS 적용을 구분한다. `aws cloudformation validate-template`와 실제 stack·S3·CloudFront 생성은 AWS 인증 후 root가 검증한다. URL과 GitHub workflow run을 확인하기 전에는 배포/CI 완료라고 보고하지 않는다. 실제 서비스가 뜨면 해당 HTTPS URL의 화면·주요 흐름을 확인한다.

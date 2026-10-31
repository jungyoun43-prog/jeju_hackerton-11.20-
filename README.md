# 제주 AI·빅데이터 AI Agent 프로젝트

「제주 AI·빅데이터 활용 AI Agent 개발 챌린지」 참가를 위한 저장소입니다.
제주데이터허브 데이터를 활용해 비전문가도 데이터 탐색과 분석 결과를 이용할 수 있는 AI Agent 서비스를 개발합니다.

## AWS 데모와 자동 배포

**[제주 진료 나침반 데모](https://d1mfksxrj025bx.cloudfront.net)** · [GitHub 배포 실행 기록](https://github.com/jungyoun43-prog/jeju_hackerton-11.20-/actions/workflows/deploy-aws.yml)

서울 리전의 비공개 S3와 CloudFront HTTPS로 데모를 공개합니다. 배포 흐름은 `main` push → 재사용 CI 검사·빌드 → 같은 artifact → GitHub production OIDC 역할 → 게시·캐시 무효화 → 공개 revision 확인입니다. AWS 장기 키를 GitHub Secrets에 저장하지 않습니다. [실제 자동 배포 41198341223](https://github.com/jungyoun43-prog/jeju_hackerton-11.20-/actions/runs/41198341223)이 성공했고 공개 revision과 검사한 커밋의 일치를 확인했습니다. 공개 사이트에서도 PC·모바일 브라우저 검사 33개가 통과했습니다.

배포 구조·변수·수동 재게시·롤백은 [AWS 배포 매뉴얼](docs/deployment.md)을 따릅니다. 인프라 코드는 [CloudFormation 템플릿](infra/aws-static-site.yaml)에 있습니다. 서비스의 실제 전화·LLM·의료기관 연동 상태는 아래 MVP 설명과 같습니다.

## MVP 실행

현재 버전은 **실제 공공데이터 기관 조회·선택 → 병원 문의 시연 → 자료 보완 → 공유 허용 → 의료진 검토 접수 시연 → 합성 회신 → 일정·동행 부담 갱신**을 눌러볼 수 있는 웹 MVP입니다. 제주데이터허브 859의 공개 미리보기에서 기관 13곳을 연결했습니다. 환자 기록·문의 응답·의료진 회신은 합성이며, 런타임 LLM·실제 전화·의료기관 전송은 아직 연결하지 않았습니다.

Node.js 22 이상과 npm을 설치한 뒤 실행합니다.

```bash
npm ci --ignore-scripts
npm run dev
```

터미널에 표시된 **http://127.0.0.1:4173** 을 엽니다. 키 없이 실행됩니다. 기관 후보와 집계는 포함된 공개 미리보기 snapshot에서 읽습니다. 사례 변경·가져온 파일은 화면 메모리에만 있으며 새로고침하면 초기 사례와 기본 후보로 돌아갑니다. 다른 기기에서 열 때는 해당 호스트의 접근 경로를 별도로 구성해야 합니다.

```bash
npm test
npm run build
npm run preview
npm run package
```

`npm run preview`도 기본 4173 포트를 사용하므로 개발 서버를 먼저 종료합니다. ZIP 패키징에는 Python 3의 표준 `zipfile`이 추가로 필요합니다. ZIP 경로는 `output/jeju-care-compass-mvp.zip`이며 **개발 스냅샷**입니다. 현재의 미완료 제출 요건은 [제출 추적표](docs/submission-checklist.md)에 남겨두었습니다.

- 기술: 브라우저 ES modules + Node.js 정적 서버 + Leaflet 1.9.4. 별도 DB·GPU·유료 API 없음.
- 외부 의존성: 최초 npm 설치와 OSM 지도 타일은 인터넷이 필요합니다. 지도 실패 시 설명과 외부 지도 링크를 제공하며 나머지 시연은 유지됩니다. 타일을 ZIP에 수집하지 않습니다.
- 환경변수: [예시](.env.example)의 `HOST`, `PORT`, `MAP_TILE_URL`. `.env`는 선택 사항이며 제출하지 않습니다. Google Maps 외부 링크는 키 없이 열고, Google Embed는 미구현입니다.
- 사용법·오류: [사용자 매뉴얼](docs/user-manual.md). 모델·스킬·자산·오픈소스: [외부 의존성 명세](THIRD_PARTY.md). 실제 확인 결과: [검증 기록](docs/implementation-results.md).

## 개발 오케스트레이션과 검사

UI·Workflow·문서를 별도 worktree와 브랜치에서 병렬 개발하고, 읽기 전용 독립 검토를 거쳐 작업별 커밋으로 통합합니다. 개발용 서브에이전트 구조와 서비스 런타임 구조는 구분합니다.

```bash
npm run observe
npm run eval
npm run rollback -- <통합-커밋-SHA>
```

위 세 명령은 Git 브랜치·worktree가 유지된 개발 저장소용입니다. `rollback`은 기본적으로 미리보기만 하며, 기록된 통합 커밋에 한해 `--apply`로 revert 커밋을 만듭니다. 미커밋 변경이 있으면 중단합니다. 압축 해제한 소스에서는 `npm test`, `npm run build`, 앱 실행으로 검증합니다.

[하네스 규칙](orchestration/README.md), [파일·인터페이스 계약](docs/implementation-contract.md), [회고와 규칙 개선](orchestration/retrospective.md)을 확인하세요. 자동 eval의 준수율은 기계 검증한 항목만의 결과이며, 실제 데이터 사용 권리·임상·기관 연동 등 미검증 항목을 별도로 표시합니다.

선택 브라우저 QA는 Playwright와 Chromium이 필요합니다. 앱 실행 의존성과 분리되어 있습니다. 먼저 개발 서버를 켠 뒤 다른 터미널에서 실행합니다.

```bash
npm install --no-save --package-lock=false playwright@1.64.1
npx playwright install chromium
npm run test:browser
```

기존 도구를 쓸 때는 `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`, 다른 서버 주소는 `BASE_URL`을 사용할 수 있습니다. QA는 최초 두 viewport만 타일을 조회하고, 반복 기능 검사는 외부 타일 요청을 막습니다. 결과는 `orchestration/runs/browser.json`과 `.impeccable/review/desktop.png`, `mobile.png`에 저장합니다.

## 확정된 프로젝트 방향

- 저장소: [jeju_hackerton-11.20-](https://github.com/jungyoun43-prog/jeju_hackerton-11.20-)
- 참가 대회: [제주 AI·빅데이터 활용 AI Agent 개발 챌린지](https://daker.ai/public/hackathons/jeju-ai-bigdata-agent-challenge)
- 활용 자료: [사용자가 지정한 제주데이터허브 데이터 목록](https://jejudatahub.net/data/list/12)에 있는 데이터
- 데이터 명세 참고: [제주데이터허브 센터 데이터 페이지](https://jejudatahub.net/center/data) — 사용자가 추가로 지정한 명세 확인처
- 자료조사 도구: `insane_search` — [fivetaku/insane-search 스킬](https://github.com/fivetaku/insane-search), 설치명 `insane-search`
- 에이전트 작업 지침: [AGENTS.md](AGENTS.md)

## 서비스 방향과 PRD

**제주 진료 나침반** — 제주에서 받는 대면 진찰과 도외의 기존 주치의·전문의 협진이 이어지도록, 기록 정리부터 전화 문의·자료 보완·회신·후속 일정까지 진행하는 Agent를 기획합니다.

- [현재 기능 파이프라인](docs/agent-pipeline.md): 요청·기록 정리 → 도외 병원 전화 → 제주 후보 조회·전화 → 현지 진찰·자료 준비 → 전문의 협진 → 실행 계획 → 보완·변경 추적.
- [PRD v0.4](docs/prd.md): 보호자 중심 원격협진 준비, 실제 기관 데이터 활용, 도구·판단 범위, UI, 센터 실행과 제출 요건을 연결한 현재 요구사항.
- [데이터와 출처 명세](docs/data-sources.md): 사용 중인 필수 데이터의 항목·시점·변환·제약, 의학적 근거·급여·통신 의존성과 확인 범위.
- [원격협진 유사 사례 조사](research/remote_collaboration_cases_2026-10-31.md): 제주 DHIS, 국내 병원 간 협진, 해외 암 원격협진과 eConsult, 피클의 전화·예약 대행 공개 기능 비교.
- 첫 시연의 질환·상세 사례는 재검토 중이며 암 치료 후 추적 진료를 예시로 검토합니다. 현재의 범위 제안은 합성 환자 1명과 제주·도외 기관 역할 각 1곳, 협진 요청 1건입니다.
- 기록·문헌 근거 정리, 전화 문의, 자료 보완과 회신 추적을 Agent가 맡고, 진찰과 환자별 협진·진료 계획의 임상 판단은 의료진이 맡는 구조입니다.
- 의료진이 검토한 실행안에 대해 한국의 급여·의료비와 반복 방문의 비용·시간·동행 부담을 계산하고 조건 변경 시 갱신합니다.

런타임 모델·음성 사업자는 아직 미정입니다. UI·상태 엔진의 기술 스택은 위 MVP 실행 설명을 따릅니다. 전화 문의는 실제 발신 경로부터 별도로 검증하며, 브라우저 음성 대화를 전화망 발신 완료로 표시하지 않습니다.

## 대회 주요 요건

아래 내용은 2026-10-31 확인한 [공식 안내](https://daker.ai/public/hackathons/jeju-ai-bigdata-agent-challenge)를 요약한 것입니다. 제출 전 최신 공지를 다시 확인합니다.

| 항목 | 내용 |
| --- | --- |
| 제출 마감 | 2026년 11월 20일 10:00 — 공식 안내 표기 기준 |
| 필수 데이터 | 제주빅데이터센터 또는 제주데이터허브 데이터 1종 이상 |
| 기획서 | 분석 주제와 Agent 구현 계획을 담은 15페이지 이내 문서 |
| 최종 결과물 | 실행 소스 코드, 실행환경·매뉴얼, 데이터 활용 명세, 결과 설명자료를 ZIP으로 제출 |
| 센터 운영 PC 최소사양 | Intel Core i7-8700 / GTX 1060 / RAM 32GB |

실행 문서에는 설치·실행 절차, 의존성, 환경변수 예시, 사용자 안내와 제약사항을 포함합니다.
사용 모델, AI 활용 범위, 외부 API·서비스, 외부 데이터와 오픈소스를 명시하고, 센터 실행환경과 외부 서비스 의존성을 고려합니다.

## 수상 전략과 모의 심사

2026-10-31 공식 평가기준을 확인하고 5개 항목별 서브에이전트로 첫 검토를 수행했습니다.

- 전문가 평가 70% + ELO 기반 참가팀 상호 평가 30%로 구성됩니다.
- 전문가 배점은 주제 15점, 데이터 활용 20점, 기술·완성도 25점, 편의·실용성 25점, 신뢰·재현성 15점입니다.
- 동점에서는 기술·완성도 → 편의·실용성 → 데이터 활용 순으로 비교합니다.
- 첫 검토 당시에는 실행 증거가 없어 전 항목 채점을 보류했습니다. 이후 의료 분야의 서비스 방향을 위 PRD에 구체화했으며, 과거 검토 기록은 당시 상태를 보존합니다.

출처: [공식 대회 공개 응답](https://daker.ai/api/hackathons/jeju-ai-bigdata-agent-challenge)의 평가 안내. 확인일: 2026-10-31.

관련 문서: [수상 전략 제안](docs/award-strategy.md), [평가기준별 심사 역할·재사용 지시문](docs/judging-agents.md), [첫 검토 기록](docs/reviews/2026-10-31.md).

심사 에이전트는 개발 과정의 검토 역할입니다. 상시 실행 시스템이나 제출 서비스의 다중 에이전트 구조를 구현한 상태는 아닙니다.

## 데이터 활용 기록

지정된 목록에서 구체적인 데이터셋을 선정할 때는 [센터 데이터 페이지](https://jejudatahub.net/center/data)의 명세도 함께 확인하고 다음을 기록합니다.

- 데이터명과 상세 출처 URL
- 제공 기간, 갱신 주기, 활용 항목과 단위
- 수집 방식과 이용조건
- 전처리 방법과 분석 흐름

사용 중인 데이터는 [병·의원 정보 · ID 859](https://jejudatahub.net/data/view/data/859), 원 제공처 표기 LOCALDATA입니다. 2026-10-31 공개 미리보기 **20행을 실제 분석**하고, 폐업 7행을 제외한 **13개 기관의 최소 등록 사실**을 후보 조회·선택·문의 대상에 연결했습니다. 기관명·주소·등록 진료과·행정 상태·갱신일·수집일을 표시합니다. 선택을 바꾸면 제주 문의와 검토 접수를 다시 준비하도록 상태가 갱신됩니다.

- 후보: `app/data/hospital-candidates.json`의 13개 행정 정상 등록 기관. 현재 수용·협진 참여 확인 결과가 아닙니다.
- 집계: `app/data/datahub-profile.json`의 20행 기준 상태·과목 빈도·주소/과목 결측·시점 분석. 후보 13곳의 집계와 구분합니다.
- 원자료 수집 시점: **2024-10-17 13:53**. 허브 페이지 수정일과 현재 병원 운영 상태는 별개입니다.
- 기본 공개 미리보기 조회에는 프로젝트 키나 사용자 파일 업로드가 필요하지 않습니다. 전체 운영 API는 미연결입니다.

```bash
node scripts/datahub-profile.mjs --fetch
```

이 명령은 공개 메타데이터·미리보기를 읽어 두 JSON을 다시 생성합니다. 전체 원문 CSV는 저장하지 않습니다. 공개 데이터의 출처를 표시하며 자유 라이선스나 전체 원자료 재배포 허락을 확인했다고 주장하지 않습니다. 사용자 지정 URL의 `/12`는 전체 목록의 페이지 번호입니다.

최신 확인 범위와 전처리 계획은 [데이터와 출처 명세](docs/data-sources.md)에 기록했습니다. 이전 목록 조사와 전략 제안은 [수상 전략의 데이터 확인 기록](docs/award-strategy.md)에 남아 있습니다.

## 현재 상태와 다음 결정 사항

보호자 UI·지도·결정적 상태 엔진·기관 데이터 정규화·공개 후보 13곳·집계 분석·검사·로컬 실행 코드를 구현했습니다. 준비 단계 도우미와 합성 의료진 응답은 실제 모델 추론·임상 판단과 다릅니다. 공개 표본을 넘어 전체 제주 기관을 조회하거나 실시간 수용 여부를 확인하지는 않습니다.

화면은 큰 홍보 배너와 반복 카드 대신 사례 제목·현재 병목·다음 행동·담당자 중심으로 재설계했습니다. 의사·가족 일러스트는 사용자 피드백으로 제거했고, Imagegen으로 만든 현무암·연결 모티브의 투명 PNG 로고 `app/assets/jeju-mark-v1.png`를 사용합니다. 정확한 프롬프트는 자산 명세에 기록합니다. 58개 단위 검사·33개 공개 사이트 브라우저 검사·19개 자동 규칙·새 ZIP 설치와 실행 결과는 [검증 기록](docs/implementation-results.md)에 정리했습니다.

- 첫 시연 질환·치료 단계·합성 기록과 협진 참여 의료진.
- 전체 운영 API 확장 여부와 사례별 근거 문헌·급여 항목.
- 국내 전화 발신 경로, 실제 문의 창구, 음성 품질과 비용.
- 런타임 모델·Prompt/Tool 연동과 센터 실기기 실행 검증.

기능과 수락 기준은 PRD, 실제 확인 범위는 구현·검증 결과와 제출 추적표를 따릅니다. 최종 기획서 PDF의 15페이지 이내 편집·확인은 아직 남아 있습니다.

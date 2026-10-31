# 혼디 UX — Assessment B 독립 탐지기·브라우저 증거

대상: `app/conversation.js`. 읽기 전용 독립 관측. Assessment A의 보고서·점수·판단은 읽지 않았다. B 관측이 완료된 뒤 부모가 A 완료와 독립성 게이트 해제를 알렸다. 이 문서는 디자인 권고나 품질 판정을 포함하지 않는다.

확인일: 2026-10-31 UTC. 기준 HEAD: `ae4b7e56c8008632051f22fcf5c5c5854db37375`. 실행: `http://127.0.0.1:4196`. 브라우저: Chromium `156.0.8078.4`, headless, deviceScaleFactor 1, locale ko-KR, reduced motion. 각 크기마다 새 context와 새 page를 만들고 종료했다.

## 실행·탐지기 한계

- 실제 CLI 명령 `/home/ubuntu/.codex/skills/impeccable/scripts/impeccable detect --json app/conversation.js`는 exit **126**, `/bin/bash: line 1: /home/ubuntu/.codex/skills/impeccable/scripts/impeccable: Permission denied`로 끝났다. 파일 mode는 `664`였다. 결정적 검사·규칙 수·위치·false positive 판정은 **미확보**다. 이 값을 발견 0건이나 검사 통과로 해석할 수 없다.
- slug 명령도 같은 경로에서 1회 실제 실행하여 exit 126을 받았다. target slug·Impeccable 저장·추세 조회는 확보하지 못했다. `.impeccable/critique/ignore.md`는 존재하지 않았다. 컨텍스트 런처는 세션의 기존 실패와 수동 문서 읽기 지시를 따르고 재실행·권한수정·우회하지 않았다.
- 사용 가능한 native browser/presentation 도구가 없어 기존 Playwright 설치를 사용했다. 네 context에서 임시 document.title 변경·script 삽입·실행·정리를 실제 확인했다. 이는 mutation preflight이며 **detector overlay 주입이 아니다**.
- launcher가 실제로 호출 불가였으므로 부모 지시에 따라 live-server를 시작하지 않았다. detector overlay·detector console finding·사용자에게 표시된 [Human] overlay는 없다. 브라우저 스크린샷·DOM 기하·문구/컨트롤 목록이 fallback 증거다.
- cloud environment 상태 도구는 노출되지 않았고 `/etc/codex/network-policy.json`도 없었다. 이로부터 외부 네트워크·자격증명 준비를 추정하지 않았다. 모든 앱 관측은 loopback 서버에서 했다.

## 범위·API 경계

- 브라우저 실행 전 `/api/agent/capabilities` GET을 별도로 두 번 확인했다. HTTP 200, `llm:false`, `model:""`, `phone:"simulation"`, `healthRecords:"demo"`, `progress:"unavailable"`였다. 키 파일·환경변수 값은 읽지 않았다.
- 브라우저 route는 동일 출처 GET/HEAD와 POST `/api/agent/preview`만 허용했다. 실제 브라우저 POST는 고정 preview **4건**이고 모두 HTTP 200·`isPreview:true`·`capabilities.llm:false`였다. 일반 `/api/agent`·진행 POST·실제 전화·외부 기록·공개 데모 요청은 없었다. 차단 요청과 pageerror도 없었다.
- 각 preview는 같은 기본 scenario `aewol-parent-visit`, 응답 207자, 처리 events 15건, `needsInput:true`였다. 실제 모델 결과의 길이·품질·실행 속도를 측정한 것이 아니다.
- 제공된 `conversation.js`, `conversation.css`, `preparation-board-view.js`는 저장소 소스와 SHA-256이 각각 일치했다. 전체 hash는 `preflight.json`과 `observations.json`에 있다.

## 소스에서 확인한 사실

| 위치 | 확인한 사실 |
| --- | --- |
| `app/conversation.js:828`, `:878` | planContent의 대화가 네 번째 칸에 들어가고, 네 칸 board가 공통 입력보다 먼저 생성된다. |
| `app/conversation.js:880`, `:884`, `:890` | 요청 예시는 board 뒤·공통 textarea 바로 앞, 개인정보/실제 실행 고지는 공통 입력 뒤다. |
| `app/preparation-board-view.js:18`, `:56`, `:66` | 네 항목 탐색과 네 칸의 헤더에 상태가 각각 표현된다. 짧은 상태와 긴 상태 문구가 병존한다. |
| `app/preparation-board-view.js:71`, `:76` | gap이 없는 칸에도 실제 기관 확인에 관한 문장을 표시하고, 각 칸에 처리 기록 건수를 표시한다. |
| `app/conversation.js:652`, `:679`, `:684` | 고정 preview에서 요청 예시를 숨기고 작성된 예시 메시지를 추가한 다음 마지막 assistant 시작으로 페이지를 이동한다. |
| `app/conversation.css:221`, `:229`, `:236`, `:328` | PC 2열·모바일 1열, 칸과 본문은 자동 높이·overflow visible이다. |

## 브라우저에서 직접 측정한 사실

기하 값은 CSS px다. “rendered”는 문서에 펼쳐져 보이는 요소이며 접힌 details·숨겨진 dialog·inert 서랍·visually-hidden 텍스트는 제외한다. “첫 화면”은 `scrollY=0`의 viewport다. 컨트롤은 button/link/input/select/textarea/summary/[role=button]을 중복 없이 센다. 사용성 성공 여부나 의사결정 수를 판정한 값은 아니다.

### 초기 입력·보내기 접근

| 화면 | 문서 높이 | 입력 top | 보내기 top | 입력/보내기 첫 화면 표시 | 보내기 전체 표시 최소 스크롤 | 실제 입력 중앙 이동 후 scrollY |
| --- | ---: | ---: | ---: | --- | ---: | ---: |
| 1440x900 | 1535 | 1213.9 | 1273.9 | 없음 / 없음 | 417.9 | 635 |
| 390x844 | 2102 | 1764.9 | 1824.9 | 없음 / 없음 | 1024.9 | 1258 |
| 360x780 | 2149 | 1811.8 | 1871.8 | 없음 / 없음 | 1135.8 | 1369 |
| 390x500 | 2102 | 1764.9 | 1824.9 | 없음 / 없음 | 1368.9 | 1543 |

- 1440×900의 초기 greeting은 문서 y=807.9, 높이 64.2로 첫 화면에 전체 표시됐다. 390×844·390×500에서는 y=1602.3, 360×780에서는 y=1649.2여서 첫 화면에 표시되지 않았다. 아직 사용자 요청 전이므로 이것은 답변이 아닌 greeting이다.
- 모든 크기에서 scrollIntoView(center)로 이동하면 입력·보내기가 모두 전체 표시됐다. 접근 불능이나 내부 스크롤에 갇힌 현상은 관측하지 않았다.

### 2×2·한 열의 실제 위치

| 화면 | 요청·자료 x/y/h | 병원·협진 x/y/h | 이동·동행 x/y/h | 혼디의 정리 x/y/h |
| --- | --- | --- | --- | --- |
| 1440x900 | 300.0 / 299.9 / 423.0 | 848.0 / 299.9 / 294.7 | 300.0 / 738.9 / 388.0 | 848.0 / 738.9 / 160.2 |
| 390x844 | 16.0 / 376.4 / 419.0 | 16.0 / 809.5 / 315.9 | 16.0 / 1139.3 / 384.0 | 16.0 / 1537.3 / 145.6 |
| 360x780 | 16.0 / 423.3 / 419.0 | 16.0 / 856.3 / 315.9 | 16.0 / 1186.2 / 384.0 | 16.0 / 1584.2 / 145.6 |
| 390x500 | 16.0 / 376.4 / 419.0 | 16.0 / 809.5 / 315.9 | 16.0 / 1139.3 / 384.0 | 16.0 / 1537.3 / 145.6 |

- PC는 두 칸씩 같은 y에 있고 두 번째 행은 y=738.9다. 모바일은 같은 x에 네 칸이 연속해서 렌더링됐다. 어느 칸도 선택 때문에 숨겨지지 않았다.
- 초기와 preview 상태의 네 칸·stage-pane-body는 모두 `overflowY:visible`이었다. 문서 폭은 viewport 폭을 넘지 않았다. textarea의 표준 내부 overflow는 별도다.

### 화면에 반복된 상태와 컨트롤

| 화면 | 초기 컨트롤 전체 / 첫 화면 | preview 컨트롤 전체 / 최상단 첫 화면 | 초기 “확인 전” 전체 / 첫 화면 | 초기 “처리 기록” 전체 / 첫 화면 |
| --- | ---: | ---: | ---: | ---: |
| 1440x900 | 26 / 18 | 29 / 19 | 6 / 6 | 3 / 2 |
| 390x844 | 18 / 9 | 22 / 9 | 6 / 4 | 3 / 1 |
| 360x780 | 18 / 9 | 22 / 9 | 6 / 3 | 3 / 0 |
| 390x500 | 18 / 8 | 22 / 8 | 6 / 3 | 3 / 0 |

- 초기 상태 표현은 탐색 4개 + 칸 헤더 4개, 총 8곳이다. `추가 확인`/`추가 확인 필요` 2곳과 `확인 전` 6곳으로 읽혔다. `처리 기록 0건`은 세 칸에 있다.
- 초기 이동·동행 두 사실 행에는 동일한 `문의처 선택 전 · 문의처 선택 전`이 각각 표시됐다. 요청·자료의 “확인할 내용 4건” 아래 화면에 펼쳐진 bullet은 3개였고, 이동·동행에서도 “4건” 아래 bullet은 3개였다. `getPreparationBoard`가 센 건수와 표시 목록의 차이를 관측한 것이며 누락 데이터 원인은 여기서 단정하지 않는다.
- preview에서는 상태가 탐색의 `추가 확인 / 결과 있음 / 실패·인계 / 결과 있음`, 칸 헤더의 `추가 확인 필요 / 준비 결과 있음 / 문의 실패 · 인계 / 준비 결과 있음`으로 바뀌었다. 네 번째 칸의 답변 아래에는 `이번 요청에서 확인한 일 15건`과 별도 `처리 기록 1건`이 함께 표시됐다.
- 단어 단위 반복은 문맥·범위를 구분하지 않는 기계적 카운트다. 예를 들어 preview 전체에서 “합성”은 모든 크기 7회, “실제”는 PC 10회·모바일 9회, “시연”은 7회였다. 이것만으로 제거 대상이나 품질 결론을 만들지 않았다.

### 고정 preview 뒤 답변·후속 입력

| 화면 | 자동 scrollY | 답변 top / 높이 | 입력 top / 보내기 top (viewport) | 답변 시작→입력 top | 답변 본문 끝→입력 top | 답변/입력/보내기 전체 표시 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 1440x900 | 831 | 223.6 / 245.9 | 578.5 / 638.5 | 354.9 | 172.0 | 예 / 예 / 예 |
| 390x844 | 1942 | 78.2 / 326.8 | 506.9 / 567.0 | 428.8 | 161.0 | 예 / 예 / 예 |
| 360x780 | 2073 | 24.3 / 356.3 | 482.6 / 542.6 | 458.3 | 161.0 | 예 / 예 / 예 |
| 390x500 | 1996 | 24.2 / 326.8 | 452.9 / 513.0 | 428.8 | 161.0 | 예 / 아니오 / 아니오 |

- 기본 preview는 보호자 요청과 assistant에 `작성된 예시`를 표시했다. 답변 첫 문장은 `고정 합성 대화 예시입니다.`이고, 답변에 병원 접수 안내·택시 가능 응답·동행 연락 실패가 합성임을 명시했다. 실제 공단 기록 조회·전화·예약·배차를 하지 않았다는 문장과 다음 확인 업무도 함께 있다.
- 최상단 mode notice는 `작성된 예시 · 환자·회신은 합성, LLM·실제 발신 없음`이었다. 답변으로 자동 이동한 순간 이 최상단 notice는 화면 밖이지만 메시지의 작성된 예시 표식과 입력 아래 `가상 사례 · 실제 연락·예약 없음`은 PC 및 긴 모바일 viewport에 표시됐다.
- 390×500에서는 답변이 전체 표시됐지만 입력의 마지막 9.0px와 보내기 버튼은 화면 아래에 있었다. 보내기 전체를 보려면 57.0px 더 내려야 했다. 이후 입력 중앙 이동 시 scrollY=2227에서 입력·보내기가 모두 표시됐다.
- 이 preview 답변은 짧은 고정 문장이다. 장문 모델 답변·실제 키보드가 열린 모바일·실기기 마이크·스크린리더·환자 실사용은 관측하지 않았다.

## 스크린샷과 원자료

- `observations.json`: 전체 좌표·가시성·문구·컨트롤별 목록·network path·preview 계약·오류·정리 기록.
- `compact-observations.json`: 상태별 핵심 수치 발췌. `preflight.json`, `cli-detector.json`, `slug-attempt.json`: 실행 근거.
- 각 화면 `{1440x900,390x844,360x780,390x500}`마다 `-initial-viewport.png`, `-initial-full.png`, `-initial-composer.png`, `-preview-answer-viewport.png`, `-preview-top.png`, `-preview-full.png`, `-preview-composer.png`를 저장했다.
- 실제로 연 이미지: 네 크기의 initial viewport와 preview-answer viewport 8장. 그 외 PNG는 같은 실행에서 자동 캡처된 별도 원자료다.

## 정리·독립성

- B는 repo source/test/server를 수정하지 않았다. 출력은 `/tmp/hondi-ux-assessment-b/`와 이 보고서뿐이다. 기존 root 소유 서버는 유지했다.
- 자체 Chromium browser와 네 context는 종료했다. 임시 title/script mutation도 각 context에서 정리했다. live-server는 시작하지 않아 종료할 프로세스가 없다.
- 요청된 원자료·PNG·재현 script는 `/tmp`에 의도적으로 보존한다. Impeccable 저장이나 trend는 slug 실패로 수행하지 않았다.
- B는 A의 발견·점수·권고를 읽지 않았고, 부모가 A 완료를 알린 뒤에만 B의 수치를 전달한다. 합성 평가는 부모가 담당한다.
- Questions skipped: 구현을 위한 독립 증거 수집 업무이고 사용자 확인은 부모의 통합·구현 단계에서 처리한다.

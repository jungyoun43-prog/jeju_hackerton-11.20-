# 혼디 입력 우선 UX 계약

2026-10-31. 사용자는 “사용자 관점에서 UI가 너무 별로”라고 평가했다. 기존 2×2·내부 스크롤 없음은 유지하면서 요청→결과→다음 행동의 우선순위를 고친다. 이 계약이 grid-flow의 입력 순서·기본 상세 펼침·반복 탐색보다 우선한다. Operate 모드, 새 브랜드/이미지/의존성/API/의료 판단 추가는 없다.

## 실제 문제와 수락 기준

- 서로 격리한 설계 검토 A와 브라우저 관측 B를 수행했다. B에서 첫 textarea는 PC 약1214px·390모바일 약1765px 아래, 상태는 nav4+header4로8회 표현됐다. 자료/이동의4건 중3개만 보이고 문의처 선택 전이 반복됐다. detector/slug는 실제126 실패로 자동 규칙 발견 수 미확보다. 수치·persona 검토와 실제 환자 사용성 검증을 구분한다.
- 첫 화면의 주 행동은 공통 입력 하나다. 기존 예시는 입력 바로 위에 두고 입력/말로 요청/보내기/범위·개인정보 고지를 board 앞에 둔다. PC1440×900/1280×800와 모바일390×844/360×780에서 첫 입력·보내기가 viewport 안에 보여야 한다. 짧은390×500·큰 글자는 문서로 접근하며 내용 높이를 자르지 않는다.
- PC900px 초과2×2, 모바일900px 이하 네 칸 전체1열을 유지한다. 네 제목·○△×/중립대시·짧은 핵심은 항상 표시한다. 전역4항목 상태 nav를 제거해 같은 상태를 두 번 나열하지 않는다. 자료/병원/이동의 전체 사실·누락·근거·이력은 각 칸의 native details로 기본 접어 두되 언제든 모두 읽을 수 있다. 단순 hidden 삭제/line-clamp/고정높이/내부Y스크롤은 금지다.
- 첫3칸은 짧은 현재 사실/문제 요약을 먼저 보여준다. 초기0건 이력과 빈 확인사항 안내로 공간을 채우지 않는다. 전체 누락 건수와 펼친 목록은 일치해야 하며 같은 문의처 선택 상태를 반복하지 않는다. 실제/합성·출처·현재 수용/예약 미확인 정보는 요약·근거에서 보존한다.
- 네 번째는 실제 대화·답변이다. 초기 안내는 짧고 첫 요청 뒤 중복 greeting은 줄인다. 결과를 확인한 뒤 입력을 다시 찾지 않도록 ‘요청 입력으로’ 동작과 기존 nextActions/requestDraft 기반 다음 문의 초안 경로를 가까이 둔다. 초안은 확인·수정 뒤 직접 보내며 교체 취소/대기·음성 중 제한/실제 발신 없음 규칙을 지킨다. 새 의료 판단·허용/동의 확대·자동 전송은 없다.
- 요청 대기·중지는 입력 가까이 있어야 한다. 상단으로 옮긴 입력을 바로 떠나도록 대기 시작 시 자동 스크롤하지 않는다. 완료/오류 후 관련 답변/오류·재시도에 접근하며 키보드 초점을 화면 밖 입력으로 강제하지 않는다. 이후 명시적인 입력 복귀는 draft를 보존하고 API를 호출하지 않는다.
- 상세를 펼쳐 읽는 선택·포커스·같은 출처 링크는 진행만으로 바꾸지 않는다. 기존 확정/진행 DOM 분리·WeakMap guard·현재 focus 링크 위치 보정을 유지한다. 상세 열기는 모델/기관 문의가 아니다.
- 기존 혼디 로고·인물 없는 제주 배경·Pretendard·청색/슬레이트와 상태 의미 색을 유지한다. 입력과 요청 행동이 시각적 주 계층, 네 요약은 보조, 출처/이력은 상세다. 큰 홍보 문구·장식 카드·색상을 추가해 문제를 덮지 않는다. 기존 전역 CSS 덧붙이기보다 해당 규칙을 수정한다.

## 소유권·검증

- root: 공통 projection의 전체 누락/문의처 중복 표시2건과 회귀, 문서·하네스·통합·최종CI/공개UI·ZIP. normalizePreparationProgress/모델·도구·세션·권한/실행 로직은 바꾸지 않는다.
- task-ui: app/conversation.js, app/conversation.css, app/preparation-board-view.js. 위 구조와 접근성·기존 설정/전화/기록/여정/취소·재시도/음성을 보존한다.
- task-qa: scripts/conversation-browser-check.mjs, scripts/journey-browser-check.mjs, scripts/preparation-board-browser-check.mjs. 사라진 nav/항상 펼친 내용 전제를 실제 details 동작으로 정정하며 기존 안전·진행·실제/시연 검사를 유지한다. 첫 viewport 입력/보내기·4개 상태·collapsed-first3·확장시 전체 누락 목록/자연높이·답변→초안/자유입력 복귀 noPOST·sourcefocus±2px를 확인한다.
- DOM: #preparation-board 직접4stage·기존 facts/gaps/sources/events/plan/message·공통form/input·dialog id 유지. 첫3 details는 [data-stage-details], 상태는각header만. #stage-navigation 삭제. stage열기helper/수동선택은 native details와 신규 답변 알림에 맞추며 다른 칸을 숨기지 않는다.
- proof 기존 runs키와 documentFlow/initialSignalSummary/gridLayout을 유지하고 view.composerFirst=true, view.compactSummary=true를 실제관측으로 추가한다. 첫화면/결과/확장/긴답변/큰글자·draft보호·키보드/대비를검사한다. source동결 후 4browser→unit/eval을순차완료한다. 최신 PNG는 .impeccable/review/task-first/. 실모델 재호출 없이 UI와기존fixedpreview를검증하고 과거9fc11bc실모델증거는원래revision유지한다.

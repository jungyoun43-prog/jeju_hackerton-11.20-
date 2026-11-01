# 실사용·로딩 보완 계약 · 2026-11-01

기준0b758e5, 실행지문1e470373. 사용자는 직접 사용하며 디자인·성능의 부족한 점을 개선하도록 승인했다. 중앙 현재 작업·선택 단계 상세와 오른쪽 네 단계, 단일 입력/100dvh·기존 로고/폰트/색/제주 배경은 유지한다. 실모델/전화/개인기록/예약은 추가 연결하지 않는다. 기존 크레딧 소진에 따라 유료 모델 호출0을 유지한다.

## 재현한 문제와 수정 범위

1. 모바일 새 대화의 시각 텍스트가 숨겨지며 접근성 이름이 없다. 같은 버튼에 이름/title을 제공한다.
2. 고정 흐름을 여는 예시와 입력 초안을 채우는 예시가 같은 레이블이다. 작은 화면 폭을 유지하면서 고정 흐름은 ‘체험’(접근성 이름 ‘준비 흐름 체험’), 입력 예시는 ‘요청 예시’로 구분한다. 로딩·실패·재시도·연결 안내도 같은 명칭을 사용하고 고정 예시/실모델 경계는 유지한다.
3. 중앙 현재 작업과 대화 기록의 다음 행동이 다른 우선순위다. 두 위치와 두 초안 버튼이 공통 workflow.currentTask를 따른다. 임상 경로/여정의 전체 할 일은 별도 읽기 정보로 보존한다.
4. AI 응대 거절이 지원 요약에서 불통으로 축약된다. 기존 call-recovery의 실제 이유/수신처 범위를 사용해 공유 지원 요약 label을 정확히 표시한다. 무응답·본인확인·서류/일정·거절을 구분하고 새 문의처에 예전 거절을 붙이지 않는다. 상태/권한/DB/실발신은 바꾸지 않는다.
5. 첫 화면에서 닫힌 dialog용 MaruBuri466,508B와 Pretendard전체2,057,688B를 강제 다운로드한다. 기존 캐시의 공식 pretendard1.3.9 배포물(/tmp/jeju-font-package/pretendard-1.3.9.tgz)의 공식92개 unicode-range CSS/WOFF2를 자체 호스팅한다. 바이너리·unicode 범위·이름을 수정하지 않으며 CSS family alias만 기존 Pretendard에 맞춘다. 두 전체 폰트 preload를 제거하고 불필요해진 전체 Pretendard 파일을 제거한다. MaruBuri는 기존 dialog 스타일에서 필요할 때 로드한다. 기존 OFL을 유지하고 패키지 버전·해시·개별 파일·재현 방법을 기록한다. 새 런타임 의존성/외부 CDN은 추가하지 않는다.
6. CPU6x 실제 keyless preview의 응답 적용에서 같은 준비판을3회 다시 그린다. 상태/데이터 캐시를 추가하기보다 최종 상태의 중복 렌더를 줄인다. 읽기 전용 단계 탐색도 이미 계산한 board를 재사용한다. 화면 상태·버튼 disabled/aria·소스 DOM/초점·입력·취소/late·진행 순서·resume는 보존한다. 임의 지연 타이머나 가짜 진척을 추가하지 않는다.

## 소유권

- use-polish-ui: app/conversation.js, app/preparation-board-view.js. 공통 다음 행동·버튼 명칭/접근성·불필요 렌더만 수정. 도메인/API/폰트/CSS는 수정하지 않는다.
- load-performance: app/index.html, app/conversation.css(폰트 선언만), app/assets/pretendard/**, app/assets/PretendardVariable.woff2(제거), scripts/prepare-fonts.py, tests/font-assets.test.mjs, tests/static-hosting.test.mjs(필요한 자산 계약만). 공식 자산·로딩/재현·글리프 보존 검사.
- support-reason: app/visit-support.js, tests/visit-support.test.mjs, tests/call-recovery.test.mjs(필요 시). 공통 이유 표시와 현재/이전 문의처 범위.
- root: 문서·하네스·통합·자기 서버/브라우저 사용·API키 없는 QA·독립 검토·push/배포/산출물.
- 후속 QA: 기존 browser scripts와 필요한 지표 측정. 별도 파일 소유권으로 등록하고 의미/보안 조건을 보존한다.

각 write 작업은 전용 worktree·branch에서 commit하고 root가 cherry-pick한다. 읽기 검토는 소스를 수정하지 않는다. 브라우저 최대2개, 실제 native zoom은 단독이다. baseline/후속 지표는 조건·캐시·n·resource body bytes·font ready·app 관측·최종 LCP 대상을 구분한다. 이전 실제 모델12과업을 현재 로직의 통과로 재사용하지 않는다. 실제기기/현장 INP/LLM·기관·임상/법률·센터PC는 별도다.

# 중앙 채팅·오른쪽 준비 패널 계약

기준: 0c502c7. 최신 사용자 요청(2026-11-01): “준비 됐냐는 오른쪽 패널에 세로로4칸, 중간은 원래처럼 채팅창 느낌”, “아이콘도 좀 넣고”. 이전2×2·상단 입력 배치보다 우선한다.

## 화면

- PC(900px 초과)는 기존 왼쪽 설정, 넓은 중앙 채팅, 오른쪽 준비 패널로 구성한다. `.chat-workspace`와 `.preparation-rail`은 형제다. 오른쪽은 약300~320px·한 열이며 기록/병원/이동/계획의 기존 stage ID와 상태 projection을 유지한다.
- `#message-list`와 `#conversation-scroll`은 중앙에 한 개이며 `#preparation-board` 밖이다. DOM 순서는 대화/현재·다음 행동 → 요청 예시 → 공통 입력과 고지다. 전체 답변을 오른쪽 plan에 복제하지 않는다. 넓게 읽기는 중앙 toolbar에서 기존 dialog를 연다.
- 오른쪽 `#preparation-board`의 직접 자식 네 칸은 records/hospitals/support/plan 순서다. 각 제목 옆에 기존 SVG 체계의 folder/hospital/car/calendar를 쓴다(`.stage-topic-icon`). 기호 ○△×·중립대시·상태 문장을 함께 보인다. fourth plan은 기존 summary/facts/events를 요약한다.
- 네 칸 모두 핵심 요약을 먼저, 전체 사실·누락·근거·처리 기록은 native details로 펼친다. 전체 누락과 건수가 일치해야 한다. 실제 진료·예약·배차 확정으로 보이게 하지 않는다.
- 900px 이하는 중앙 채팅 다음 오른쪽 패널을 문서 아래 한 열로 배치한다. 네 상태를 모두 확인할 수 있다. 설정은 기존1050px 서랍을 유지한다. 폼을 복제하거나 모바일 전용 대화를 만들지 않는다.
- 본문·오른쪽 각 칸은 자연 높이/최대높이 없음/내부Y스크롤 없음이다. 입력은 대화 다음 하단에 두고 채팅 영역 안 sticky를 쓸 수 있다. 짧은 화면/큰 글자에서는 자연 흐름으로 보장하며 긴 답변·표·고지를 가리지 않는다. textarea/긴 표/dialog의 표준 스크롤은 유지한다.

## 보존할 동작

단일 텍스트·음성 요청, 예시와 nextActions.requestDraft의 초안 채우기/기존 문장 교체 확인/noPOST, 입력 복귀와 초안 보존, pending/취소/재시도/late 응답 방어, 실제 enum 진행, 확정·live DOM 분리/같은 출처 노드·초점·읽기 위치, 오른쪽 내역을 읽는 중 새 답변 알림을 유지한다. plan도 이제 오른쪽 정보이므로 이 칸을 읽는 중 도착한 답변 역시 중앙으로 자동 이동시키지 않는다. API·모델·데이터·권한·기록·발신·임상 경계는 변경하지 않는다.

## 분업·검증

- UI: app/conversation.js, app/conversation.css, app/preparation-board-view.js, app/icons.js만 소유한다. 기존 분리 모듈을 재사용하고 불필요한 과거 배치 override를 남기지 않는다. 의존성/서버/model/state schema는 바꾸지 않는다.
- QA: scripts/conversation-browser-check.mjs, scripts/journey-browser-check.mjs, scripts/preparation-board-browser-check.mjs만 소유한다. 이전2×2/대화가plan안/입력상단 단언을 새 계약으로 교체한다. 기존 SHA·preview14/일반POST0·전화 인계·음성/취소·같은출처/focus·긴표/큰글자/6viewport 단언은 보존한다.
- 통합: 문서/하네스/eval/배포. PC 실제 좌표에서 패널이 채팅 오른쪽/네 칸 같은x·증가y, 모바일에서 채팅 다음 네 칸을 확인한다. 중앙 메시지와 입력이 각각 한 개, 오른쪽에 전체답변 없음, 네 제목 아이콘과 상태가 모두 있어야 한다. 준비판 proof는 layout='chat-right-rail' 또는 'chat-then-status', chatLayout/compactSummary/categoryIcons를 기록한다.
- 소유한 키 없는 로컬 서버와 route fixture로 검증한다. 실제 LLM/전화/개인기록 요청은 하지 않는다. 구현 후 PC·모바일 렌더와 동일 검토자의 사용자 흐름 재검토 후 기존 CI/CD로 게시한다. 과거 실제 Sol/DDB 증거는 원 revision에 남기며 이번 UI 결과로 재표기하지 않는다.

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

## 주황 포인트 후속 요청

환자 이름은 case-heading/rail-patient에서 이름 부분만 인라인으로 강조한다. 나머지 제목 문구와 접근성 이름은 그대로 보존하고, 기존 escape로 이름을 문자 처리한다. 주 행동/포커스 토큰은 짙은 주황, 활성 보내기는 흰 글자, 다음 문의 초안은 별도 옅은 peach 토큰을 사용한다. 비활성 보내기·전체 soft 바탕·보조 링크·아이콘·성공/미확인/실패의 의미색은 유지한다. 중앙 채팅·오른쪽4칸의 배치나 동작을 바꾸지 않는다. 낮은 영향의 시각 변경이므로 새 영구 테스트/설정/라이브러리를 추가하지 않고 실제 활성·hover·focus·비활성·답변 상태를 PC/모바일에서 확인한다.

## 초록 영역과 짧은 상호작용

최신 사용자 요청은 색이 부족하고 밋밋하므로 초록과 인터랙션을 더하는 것이다. 앞의 보조 파랑 유지 제한보다 이 항목을 우선한다. 주황 이름/보내기/다음초안은 유지하며 밝은 화면에서 다음 역할을 부여한다.

- 대화 toolbar는#1C4D36/흰 글자, 탐색면#F4F8F4, 선택/사용자 말풍선의soft#EDF6EF, 보조 링크/아이콘secondary#285C43/hover#1B4631. 오른쪽 카드는 흰 면, good#267149/warning#875617/danger#A33D34와 기호/설명은 보존한다. 본문ink/muted·제주 배경·구조/크기/모델/권한은 유지한다.
- 녹색toolbar의 글자/버튼/아이콘은 흰색이며 focus는 흰색 또는 옅은 밝은색으로3:1이상 구분한다. 주황focus를 이 어두운 면에 그대로 쓰지 않는다. 보조 hover의 과거 파랑 하드코딩도 현재 역할로 정리한다. 비활성 제어는 실제 disabled를 유지한다.
- CSS만으로 누름1px·주 행동/예시 arrow hover2px·native details chevron/면·경계 변화를 제공한다. 카드/본문 전체를 이동하거나 height/width/margin으로 여닫지 않는다. 펼친 내용은 여전히 자연높이/페이지 스크롤이다. input focus/색 피드백은 실제 입력에서만 보인다.
- 모션의 주 장면은 실제 최종 응답이 추가된 순간이다. `#message-list` 직계의 최신 assistant/non-greeting metadata에만 약240ms·1회의 옅은 초록 색/clip 피드백을 준다. 본문 전체 래스터·이전 답변·넓게읽기복사본·초기인사에는 재생하지 않는다. 본문/메타 기본상태는 항상 visible이며 keyframe/JS 실패에도 감추지 않는다. 새 클래스·JS 타이머/별도 진행/애니메이션 라이브러리는 필요 없다.
- reduced motion에서는 hover/active의 공간이동과 답변 등장 애니메이션을 제거한다. 정적인 열린 방향·선택/열림 면·실제 대기·키보드 focus는 남긴다. 기존 모바일 서랍의 닫힘 transform을 전역none으로 지우지 않는다.

구현은 전용worktree의 app/conversation.css만 소유한다. 검증은 별도worktree의 scripts/preparation-board-browser-check.mjs만 수정한다. 기존 reduce6viewport·진행/취소·출처DOM/focus·native표를 보존하고 PC/모바일×일반/줄인동작의 실제색/대비·hover/press·반복펼침/입력비발송·답변메타1회/복사본제외를 확인한다. normal-motion fixture도 실제 LLM/발신/기록은 요청하지 않는다. proof.motionScenarios는width/reducedMotion/greenSurfaces/contrastPassed/interactionFeedback/replyFeedback/readingStable/normalPostAttempts를 기록하며 일반·reduce 각2viewport를 포함한다. CSS compositor와 mock JS 시계를 구분해 실제 상태를 조건 대기한다. 통합 후 같은 소스의 기존 전체 하네스와 현재 CI/CD로 검증·게시한다.

## 대화 상단 개선

후속 사용자 피드백은 채팅창, 특히 ‘혼디와 대화’ 상단이 어색하다는 것이다. 이 절은 앞의 짙은 초록 띠와 제목 문구 고정보다 우선한다. 다른 영역의 초록·주황 역할은 유지한다.

- 두꺼운 전체 너비 색 띠를 흰 대화면과 이어지는 상단으로 바꾼다. 기존 `hondi-mark-v1.png`와 ‘혼디’ 이름, 짧은 진료 준비 역할 설명으로 대화 상대를 표시한다. 가짜 온라인·가용성·진행 상태나 새 인물/그림은 추가하지 않는다.
- 대화 상대와 도구를 분리한다. 기존 `conversation-title`, `expand-answer`, `preview-button`과 기능은 유지하고 예시/넓게 읽기는 작은 보조 행동으로 정리한다. 좁은 화면에서 아이콘으로 줄이는 버튼에는 같은 접근성 이름·설명과 44px 조작 영역을 남긴다. 초기 넓게 읽기의 실제 disabled도 유지한다.
- 흰 상단의 이름·보조 행동은 기존 초록, 보조 설명은 기존 muted, 초점은 흰 면에서 구별되는 주황/초록이다. 텍스트4.5:1·초점3:1을 확인하며 이전 어두운 띠의 흰색 강제 규칙을 남기지 않는다. 1440/1060/390/320에서 제목과 행동이 겹치거나 가로로 넘치지 않아야 한다.
- 중앙 대화/하단 입력·오른쪽 네 칸·자연 높이·단일 폼·고지·본문/출처·이미 구현한 짧은 CSS 피드백은 유지한다. 헤더 마크업/CSS 외 Controller·모델·데이터·권한·기록/전화는 바꾸지 않는다. 오래된 선택자/토큰은 교체하며 override를 추가로 쌓지 않는다.

UI는 전용 worktree에서 `app/conversation.js`의 상단 마크업과 `app/conversation.css`만 소유한다. QA는 별도 worktree의 기존 `scripts/preparation-board-browser-check.mjs`에서 상단의 기존 색/대비 단언을 새 의미와 접근성에 맞춘다. 새 라이브러리·프레임워크·별도 영구 검사 파일은 추가하지 않는다. 기존 motionScenarios의 greenSurfaces는 주변 민트/초록 역할과 흰 대화 상단을 함께 확인하며 나머지 모션·진행·취소·출처 읽기 단언은 유지한다. 통합 담당자가 문서/하네스와 같은 소스의 기존 검사·공개 배포를 마무리한다.

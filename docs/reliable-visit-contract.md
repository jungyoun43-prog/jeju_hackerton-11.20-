# 방문 준비의 중복 방지·이어하기와 다음 구현 계약

기준:607ce48 · 2026-11-01 사용자 요청: next-steps의 우선순위를 구현하고 피클 사례를 참고한다.

## 이번 구현

실제 Sol의 합성 복합 과업 평가·확인된 실패 수정, 문의에 쓰는 추가 공공자료, 첫 요청의 중복 방지와 새로고침 뒤 준비 이어하기를 구현한다. 현재 한 화면 배치·의료/전화/개인기록 경계와 기존 기능을 보존한다. 실제 기기·외부 기관·법률/임상 실증은 자동 검사로 대체하지 않는다. 최종 기획서 PDF와 실행 설명도 현재 구현에 맞춰 정리한다.

피클의 공개 안내는 대행 요청·조건 확인·업무 카드·후속 결과/인계의 참고다. 공개 API/소스를 확인하지 않고 피클 연결이나 실제 발신을 구현했다고 표시하지 않는다. 통신사 계정이 아직 없으므로 실제 전화·개인기록·예약/배차는 연결하지 않는다. 현재 호출 인터페이스와 위임/고지·결과·인계 경계를 지키며 추후 사업자 연결점을 명시한다.

## 서버/화면 인터페이스

- 일반 요청에 선택 `visitToken`을 추가한다. 브라우저가 첫 요청 전에 생성하는32byte/43자 base64url 값이다. 새 브라우저 흐름은 같은 방문의 재시도/후속 요청에 이를 유지한다. 기존 토큰 없는 API 요청은 호환한다.
- 서버는 도메인을 구분한 SHA-256으로 토큰에서 같은 opaque sessionId를 얻고 원자적으로 최초 세션을 만든다. 토큰과 전달된 sessionId가 다르면 거부한다. 원문 토큰을 DB·로그·모델·URL·보고서에 넣지 않는다. 1시간 만료·정규화된 합성 상태만 저장하는 원칙은 유지한다.
- 요청 receipt는 requestId·정규화된 업무 본문의 SHA-256·고정상태·시각만 보관한다. 본문 지문에서 progressToken/visitToken/sessionId를 제외해 응답 유실 뒤 동일 요청을 인식한다. 같은 ID에 다른 본문은409 `REQUEST_CONFLICT`다.
- receipt를 budget/모델/도구보다 먼저 lease 조건으로 저장한다. `started/completed/failed`만 허용하고 운영 원문/답변/reasoning을 저장하지 않는다. 같은 방문·요청의 재시도는 다시 차감하거나 실행하지 않는다. 결과가 불명확한 요청은 재실행하지 않고 처리중/중단 상태와 마지막 확인 상태를 안내한다. 완료한 중복 요청은 실제 저장된 상태를 반환하며 이전 모델 답변을 복원한 척하지 않는다. receipt 수는 제한하고 만료 전 오래된 receipt를 버려 중복 실행을 허용하지 않는다.
- 기존 세션20턴·전역UTC80요청·8라운드/16도구·45초/lease·진행정규화·선호설정·원문 미저장은 보존한다. 세션 메타데이터의 고정 receipt만 호환 가능하게 확장한다. API 성공이나 화면 중지를 실제 외부 업무 완료/취소로 만들지 않는다.
- capabilities에 `visitRecovery:'token'|'unavailable'`을 추가한다. 복구는 모델·Secret·budget·lease·도구 실행 없이 읽으며, AWS에서도 기존 진행 읽기처럼 저장소만 준비하는 경로를 재사용한다.
- `POST /api/agent/resume` 입력은 `{visitToken}`뿐이다. 유효 토큰으로 기존 미만료 세션만 읽는다. 없는/만료된 세션은404 `SESSION_EXPIRED`, 잘못된 입력은400이다. 조회로 새 세션·TTL 연장을 만들지 않는다.
- 복구200은 `{sessionId,caseState,pendingActions,recovery:{savedAt,expiresAt,request}}`다. savedAt은 마지막 완료 상태의 ISO시각 또는null, expiresAt은UTC epoch초, request는없으면null 또는 `{requestId,status:'running'|'completed'|'interrupted'}`이다. 원문·과거 모델 답변·진행토큰·새로 설정한 모델 상태를 반환하지 않는다. 서버의 완료 상태와 나중에 도착한 요청의 상태를 구분한다.
- 화면은 `sessionStorage`에 opaque token만 둔다. 대화/초안/환자/기록·sessionId·설정 원문을 새로 저장하지 않는다. token은 현재 탭의 새로고침 복구용이며 계정 인증·가족 공유가 아니다. 저장이 막히면 현재 탭의 대화는 계속되고 복구 미지원으로 안내한다.
- 초기 토큰이 있으면 읽기 전용 복구를 시도하되 늦은 응답이 새 대화/새 요청을 덮지 않게 소유권을 확인한다. 완료한 과거 대화를 재생하지 않고 확인된 준비·갱신/만료·남은 일을 표시한다. running/interrupted는 별도로 설명한다. 새 대화와 고정 preview 진입은 현재 탭의 복구 참조를 정리하며 서버 취소/삭제로 표시하지 않는다.

## 소유권

| 담당 | 파일 |
| --- | --- |
| recovery-backend | agent/service.mjs, agent/store.mjs, agent/dynamodb-store.mjs, agent/validation.mjs, agent/cloud-runtime.mjs, 새 agent/visit-recovery.mjs, 해당 기존 단위 tests 및 tests/visit-recovery.test.mjs |
| recovery-ui | app/conversation.js, app/conversation.css, 기존 scripts/conversation-browser-check.mjs, 필요한 독립 scripts/visit-recovery-browser-check.mjs |
| data-reliability | 승인된 공공자료 snapshot/수집 스크립트, app/public-data-skill.js·agent/public-data-tools.mjs와 해당 tests, research/pickle-reference-2026-11-01.md·research/visit-data-update-2026-11-01.md. 구체 새 파일은 조사 결과 뒤 고정 |
| root | prompts/caregiver-system.mjs·agent/openai-provider.mjs·agent/tools.mjs의 실제 평가로 필요한 최소 수정, 평가 CLI/fixtures/tests, 문서·하네스·빌드/배포/제출물·최종 통합 |

각 담당자는 전용 worktree·브랜치에서 커밋하며 root만 통합/게시한다. 인터페이스 변경은 먼저 공유한다. 데이터 담당은 기존859의20행/13후보와 기존 정규화 상태를 바꾸지 않고 새 자료를 독립 출처로 연결한다. 원자료 없는 ETA·등록정보로 실제 수용/운행 확인을 만들지 않는다.

## 검증과 완료

- 서버: 최초 응답 유실·동시 요청·DDB 쓰기 ack 유실·재시작/lease·같은 ID 다른 본문·만료/알 수 없는 토큰·복구의 무차감/무모델/원문 미저장·기존 v1 호환과 기존 실패/진행 회귀를 검사한다.
- 화면: 요청 성공/대기/끊김→reload→같은 준비/남은 일·늦은 복구 무시·만료·저장 차단·새 대화/preview 참조 정리,10개 가용 크기·긴 내용·32px 글자·44px·읽던 출처/초안/일관된 탭을 확인한다.
- 실제 LLM 평가는 합성 고정 입력만 순차 실행하고 모델/턴/도구·상태/지연·실패를 기록한다. fixture나 단위 검사 통과를 실제 LLM/전화/개인기록 성공으로 확대하지 않는다. 키/공급자 오류원문/reasoning은 저장하지 않는다.
- 새 공공자료는 실제 접근 범위·기준일·수집일·출처·이용조건·계산 분모·전처리를 남기고 후보/질문이 달라지는 사례를 검증한다. 피클의 자체 API와 혼디에서 제안한 설계를 구분한다.
- 동결 소스의 단위·브라우저·규칙/빌드와 같은 커밋의 CI·공개 API/화면을 확인해 게시한다. 실제 모델은 이번 변경에서 재평가한다. 기존 UI 버전의 실제 모델 증거를 새 버전으로 바꿔 쓰지 않는다.

# Ponytail 기반 기술부채 정리

2026-10-31. 사용자 요청에 따라 Ponytail 기본·audit·review 스킬을 적용한다. 감사 기준은 `d7cd983`이며, 기존 기능과 화면을 보존하는 네 가지 개선으로 범위를 제한한다. 대형 파일이라는 이유만으로 나누거나 새 프레임워크·의존성을 추가하지 않는다.

## 확인한 문제와 소유권

| 담당 | 문제와 수정 | 소유 파일 |
| --- | --- | --- |
| ponytail-progress | 진행 DTO와 도구 목록의 중복을 기존 공통 모듈로 통합. 서버의 엄격한 검증을 유지 | `app/preparation-stages.js`, `agent/progress.mjs`, `tests/preparation-stages.test.mjs`, `tests/progress.test.mjs`, `scripts/preparation-board-browser-check.mjs` |
| ponytail-frontend | 호출되지 않는 네 함수·전용 CSS 삭제. 대화의 중복 검증 제거. 취소된 음성 인식의 늦은 이벤트 차단 | `app/app.js`, `app/styles.css`, `app/conversation.js`, `scripts/conversation-browser-check.mjs` |
| ponytail-package | ZIP에 외부 파일을 따라 넣는 심볼릭 링크 차단과 재현 검사 | `scripts/package.mjs`, `tests/package.test.mjs` |
| root | 감사 기록·README·하네스·통합·최종 검증·배포 | 위 담당 파일 외 문서·구성 |

## 보존할 계약

- `normalizePreparationProgress`는 고정 키·plain object·단계 순서·정규 UTC 시각·양의 순번·UTF-8 8KiB 제한을 검사하고 잘못된 값은 null로 반환한다. 서버의 `normalizeProgressSnapshot`은 이를 재사용하며 기존 TypeError를 유지한다. `PROGRESS_TOOLS`는 고정 표시 목록에서 한 번만 정의한다.
- 대화는 기존 공통 검증 함수를 직접 사용한다. 빈 진행 예시는 순번1의 유효 DTO로 두고 순번0 거절을 따로 검증한다. 진행 타이머·가짜 결과를 추가하지 않는다.
- 기존 진행 writer의 소유·고정 TTL·조건부 순번·150ms I/O·1초 예산·325ms flush, 부모45초·일80요청·모델8회/도구16개를 바꾸지 않는다.
- 새 대화·음성 취소 뒤 이전 인식기의 start/result/error/end가 현재 초안·상태를 바꾸지 못하게 한다. 실제 마이크 서비스와 브라우저 fixture를 구분한다.
- 구형 `/workspace.html`은 살아 있는 개발 검증 화면이다. 삭제 대상은 전체 호출자·문자열·동적 참조 확인을 마친 네 함수와 그 전용 선택자뿐이다. 공유 스타일과 DOM·접근성·반응형 화면은 보존한다.
- 패키지는 일반 파일만 허용하고 선택 경로·중첩 파일/디렉터리의 심볼릭 링크를 거절한다. 외부 가짜 파일 fixture로 검증하며 실제 .env·키를 읽지 않는다. 기존 빌드의 링크 거절 정책과 맞춘다.

## 검증과 통합

담당자는 각각 전용 worktree에서 검사하고 커밋한다. root는 커밋 단위로 반영한다. 기존 전체 단위·서버, 대화·여정·수동·네 창 브라우저 검사와 하네스 eval을 새 실행 지문으로 확인한 뒤 독립 Ponytail review를 받는다. 회귀 검사는 새로 확인된 음성 경합·진행 계약·패키징 경계를 겨냥하며 기존 검사를 삭제해 통과시키지 않는다.

화면·의료·전화·동의·개인기록의 기능 범위는 바꾸지 않는다. 실제 기관·환자 연계나 임상·법률 검토 완료를 뜻하지 않는다. 사용자가 승인한 기존 CI/CD로 게시하고 공개 소스 버전과 실행 상태를 확인한다.

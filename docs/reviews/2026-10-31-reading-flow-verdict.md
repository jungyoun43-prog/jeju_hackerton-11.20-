# 혼디 단일 페이지 읽기 UI — 독립 수정 확인

확인일: 2026-10-31. 읽기 전용 검토. 확인한 HEAD는 `2bb41ace2e052b8f462ffbf84533ba1d38e24cfd`다. 상위 담당자가 동결한 실행 지문은 `9efde4f2f1ec03d1bfb84b1a823f35cccb13e084984fe0771a99b97e10fa3786`이며 이 검토에서 다시 계산하거나 테스트를 실행하지 않았다.

## 판정

**기존 필수 수정 1번과 디자인 문서 정합화는 해결됐다. 검토한 소스·문서 범위의 추가 차단 항목은 없다. 동결된 통합본의 예정된 QA가 통과하면 게시할 수 있다.**

이 판정은 `/tmp/hondi-reading-finish-review.md`에서 발견한 출처 링크의 포커스 제거와 그 후 확인된 읽기 위치 이동의 수정 확인이다. 새 디자인을 요구하거나 범위를 늘리는 검토가 아니다. 현재 UI는 세 상태 요약·접힌 준비 내역·하나의 대화/답변 본문·공통 입력을 사용한다.

기준은 최신 AGENTS, README, PRODUCT, `docs/reading-flow-contract.md`, Impeccable의 Operate/polish 지침과 Ponytail 변경 리뷰다. 이미 보고된 context launcher 오류126과 직접 문맥 읽기 사실을 이어받았으며 launcher·detector를 재실행하거나 수리하지 않았다.

## 기존 필수 수정 1 — 해결

직접 읽은 소스는 `app/preparation-board-view.js`, 호출 경로 `app/conversation.js`의 `startProgress → renderBoard → renderPreparationBoard`, 그리고 `scripts/preparation-board-browser-check.mjs`의 출처 포커스 회귀다.

- `renderedMarkup` WeakMap은 마지막으로 작성한 문자열과 다음 문자열을 비교한다. 브라우저가 SVG의 `<path/>`를 `<path></path>`로 직렬화하는 차이 때문에 같은 링크를 매번 다시 생성하던 경로가 사라졌다.
- `[data-stage-events]` 안에서 확정 이력 `[data-stage-confirmed-events]`와 관측 진행 `[data-stage-live-events]`가 분리됐다. 새 progress event는 진행 목록만 바꾸므로 이전 확정 이력의 동일 앵커가 유지된다.
- pending 상태에서 준비 본문 안의 현재 포커스를 가진 링크가 화면에 보일 때만, 갱신 전후 그 링크의 위치 차이를 문서 `scrollTop`으로 보정한다. 갱신 뒤에도 같은 노드에 포커스가 남아 있어야 한다. 입력·dialog·화면 밖 링크·포커스 없는 상태를 새로 선택하거나 단계/내역을 강제로 열지 않는다. `focus()`나 `scrollIntoView()`로 다른 대상으로 보내는 코드도 추가되지 않았다.
- 진행 polling은 여전히 검증된 DTO의 증가 순번만 반영한다. 이 수정은 API·모델·사례 상태·저장소·위임 경계를 바꾸지 않는다. 현재 브라우저 UI 한 인스턴스에서 최대26회·2.5초 이상 간격으로 갱신하는 범위에 맞는 작은 변경이다.

별도 QA 담당자의 `/tmp/hondi-reading-source-focus-fixed-qa.log`를 직접 읽었다. 실제 keyless preview의 출처 event를 일반 응답 fixture에 사용한 뒤 다음 요청의 records sequence4와 hospitals sequence8을 반영한다. 같은 ElementHandle이 계속 연결되고 activeElement가 유지되며, 초기 위치 대비 PC 최대0.50px·모바일 최대0.49px 이동으로 ±2px 기준을 통과했다. 8/8·errors0, 일반 실제 POST0, fixture main4·progress4, 실제 preview1이다. 이 결과는 본 검토자가 재실행한 검사가 아니며 유료 모델·실전화 검사도 아니다. 문서 scrollTop의 위치 보정과 `scrollIntoView/scrollTo/scrollBy` 호출0은 구분한다.

새 회귀는 같은 요청 토큰인지도 확인하고, 실제 관측한 progress 횟수를 기록한다. 원래 실패하던 링크 동일성·포커스·위치 기준을 지우지 않았다.

## 디자인 문서 정합화 — 해결

현재 미커밋 `DESIGN.md`와 `.impeccable/design.json`을 실제 CSS/DOM과 대조했다.

- 2×2·모바일 선택 창·본문 고정 높이·내부 세로 스크롤을 현행 지침에서 제거하고 최신 읽기 계약의 우선순위를 고정했다. 네 업무 ID를 유지하는 것과 네 독립 창을 표시하는 것을 구분한다.
- 세 요약 버튼·기본으로 접힌 native details·항상 읽는 ‘혼디의 정리’·공통 입력·아래 방문 상세가 현재 구조와 맞는다. 문서 흐름은 block·height auto·max-height none·overflow visible이며 긴 표의 가로 이동, 긴 textarea, 명시적으로 연 dialog와 설정 탐색의 예외를 구분한다.
- 현재 색 토큰은 바탕 `#F3F5F8`, 본문 `#24354B`, 행동/포커스 `#305D91`, 보조 행동 `#345D86`, 녹색 `#267149`, 황갈색 `#875617`, 붉은색 `#A33D34`로 일치한다. Pretendard 본문·사례/준비/답변 제목과 기존 MaruBuri dialog 제목도 구분했다.
- ○는 자료/문의 준비 결과, △는 미확인/부분 준비/재확인, ×는 기록된 문의 실패/사람 인계다. 색만으로 상태를 전달하지 않으며 진료·예약·배차 확정으로 설명하지 않는다.
- 기존 schemaVersion1·브랜드 seed 이력을 보존했다. sidecar의 `evidence.uiSourceRevision=de4bd86`은 문서 담당자가 확정/진행 DOM 분리와 WeakMap을 대조한 시점으로 기록돼 있다. 새 `2bb41ac`의 실제 통합 QA 통과나 배포를 주장하는 필드가 아니다. 최종 QA·공개 검증은 검증 기록으로 따로 남기는 현재 문서의 경계가 적절하다.

## 직접 확인한 렌더

새 서버나 브라우저를 실행하지 않고 기존 PNG를 `view_image`로 열었다.

- `.impeccable/review/reading/board/1440x900-initial.png`
- `.impeccable/review/reading/board/390x844-initial.png`
- `/tmp/hondi-reading-ui/preview-390x844.png`
- `/tmp/hondi-reading-ui/details-390x500.png`
- `/tmp/hondi-reading-ui/large-390x844.png`

첫 화면의 세 상태 요약과 입력, preview의 ○/△/×·상태 문장, 문서로 이어지는 답변, 펼친 모바일 자료 내역과 큰 글자의 줄바꿈이 문서와 맞는다. 보이는 독립 세로 스크롤 창이나 2×2 배치는 없다. 일부 캡처는 전체 문서이고 일부는 viewport 캡처이므로 파일명 높이를 모두 이미지 전체 높이로 취급하지 않았다. 이 이미지 관찰만으로 포커스 타이밍이나 모든 viewport의 최종 QA 통과를 증명했다고 주장하지 않는다.

## 최종 통합 검사의 상태와 한계

상위 담당자가 keyless4196에서 실행하는 `/tmp/hondi-reading-final-{conversation,journey,workspace,board}.log`는 검토 중 진행 중이었다. 이미 기록된 초기 문서 흐름·의미 대비 검사와 기존 preview 경로가 보였으나 종료 전 총 통과 수를 확정하지 않았다. 과거 proof나 격자 UI의 실행 기록을 새 버전의 통과로 사용하지 않았다. 최종 게시에는 같은 실행 지문의 네 브라우저 proof와 단위/eval, 빌드가 필요하며 root가 확인한다.

이 검토에서는 저장소 파일 수정·커밋·테스트·서버 기동·네트워크·키 접근을 수행하지 않았다. 유일한 작성 파일은 이 `/tmp` 보고서다. 실모델·실제 DynamoDB 진행·AWS 게시·실전화·개인기록 연계·실마이크·스마트폰 키보드·Safari/Firefox·OS/브라우저 확대·스크린리더·의료/법률·센터 실기기는 검증하지 않았다.

**최종 판정: 기존 발견사항 해결, 소스·문서 차단0. 예정된 동일 지문 통합 QA의 통과를 조건으로 Ship.**

# 혼디 네 작업창 계약

2026-10-31. 사용자가 선택하고 구현을 요청한 PC2×2 작업창·공통입력 구성이다. 기존 역할·데이터·위임/전화 경계를 보존한다. UI code-led 구현이며 새 시각 정체성/이미지 생성/의료 판단/LLM4개 동시 실행을 뜻하지 않는다.

## Direction contract

THESIS: 보호자가 한 번 말한 준비 요청이 자료·병원·이동·답변에서 어디까지 왔고 무엇이 막혔는지 읽는다. 사용자 지정2×2 구조가 구성의 기준이다.

OWN-WORLD: 기존 hondi 귤로고·Pretendard·MaruBuri, 흰 작업면·짙은녹색·귤색, 인물없는 제주 배경을 계승한다. 네 창의 헤더·짧은 상태·정렬된 결과에 집중하며 장식 통계·가짜 진척은 없다.

STORY: 공통입력 한 곳→실제 실행 중인 작업 표시→확인 결과/출처→막힌 이유와 담당→조건 변경 재확인. 모든 칸의 완료를 강제하지 않고 병원·이동의 병행을 지원한다.

FIRST VIEWPORT: PC는 왼쪽 선택설정과 넓은 본문의2×2 작업창, 아래 공통 예시·입력·고지. 4번은 실제 대화/답변을 담으며 별도의 다섯 번째 채팅창을 추가하지 않는다. 기존 방문 상세는 접어서 읽는다. 모바일은 네 단계 요약과 선택한 한 창, 공유입력이다.

FORM: 사용자 지정2×2, code-led. 기존 브랜드 내 구조 변경이며 별도 컨셉 선정을 다시 요구하지 않는다. seed: none (user-pinned). 실제 API 진행과 준비 상태가 강조/전환을 결정한다.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## 파일 소유권

- root: 이 계약, `app/preparation-stages.js`·검사, 문서·package·harness·통합·배포.
- board-ui: `app/conversation.js`, `app/conversation.css`, 필요시 `app/preparation-board-view.js`와 `app/index.html`. API/모델/도메인/문서 수정 금지.
- board-progress: `agent/progress.mjs`, `agent/service.mjs`, `agent/validation.mjs`, `agent/store.mjs`, `agent/dynamodb-store.mjs`, `agent/cloud-runtime.mjs`와 해당검사. UI·모델어댑터·대회데이터·인프라 수정 금지.
- board-qa: 기존 대화/여정 브라우저검사와 새 `scripts/preparation-board-browser-check.mjs`. 검증을 새 화면에 맞추되 기존 초안/취소·권한·서버/고정예시 범위/키보드·모바일 검사를 삭제해 통과시키지 않는다.

## 공유 모델·DOM

`app/preparation-stages.js`: `PREPARATION_STAGES`, `PREPARATION_STAGE_IDS`, `getToolStage(name,input={})`, `progressActivity(event)`, `getPreparationBoard(caseState,{events,progress,pending,responseCount,requestProblem})`를 제공한다. 단계id는 records/hospitals/support/plan. 판정은 읽기 전용이며 실제 임상 수락/예약/배차를 만들지 않는다. root가 함수의 사실/상태·경계/변경 재확인을 검증한다.

결과: `{version,activeStageId,stages,pending,hasResponse,progressAvailable,boundary,overallLabel}`. stages각항목은 `{id,number,title,shortTitle,status,label,summary,facts:[{label,value}],gaps,gapCount,sources:[{url,label}],events,liveActivity,live}`. status: waiting/available/needs_input/needs_recheck/not_needed. available은 자료/답변 존재이며 진료 준비완료가 아니다.

DOM: `#preparation-board`, `[data-stage-id=records|hospitals|support|plan]`, 각 `[data-stage-status]`·`[data-stage-summary]`·`[data-stage-events]`; `#stage-navigation`의 `[data-open-stage]`는 모바일 읽을 창만 바꾼다. 자동으로 focus를 옮기지 않는다. PC는 네 창, 모바일은 한 창+다른 단계 요약을 읽는다. `#conversation-scroll`·기존 메시지 DOM은4번 창에서 보존한다. `#request-input`·`#send-request`·`#conversation-form`·예시/음성·대기중지/고지·설정/기록/전화/여정 dialog의 기존id/핵심동작은 유지한다. `#visit-summary`는 원할 때 펼치는 방문 상세다. 주 화면은4창과입력에 집중한다.

## 실제 진행 API

기존 응답API를 유지하고 `POST /api/agent`의 선택필드 `progressToken`을 추가한다. UI가256bit URL-safe43자로 생성한다. 요청id·원문·history·preferences core는 재시도에서 보존하며 progressToken은 시도마다 새로 만들 수 있다. 토큰은 LLM에 보내지 않고 로그·세션·최종응답·HTTP URL에 넣지 않는다.

capabilities에 `progress:'poll'|'unavailable'`을 추가한다. UI는 poll인 일반요청에서만 별도 `POST /api/agent/progress` `{progressToken}`을2.5초 이상 간격, 동시에1개·최대26번 읽는다. JSON과x-amz-content-sha256을 사용한다. 이 endpoint는 모델/세션생성/lease/budget을 실행하지 않는다. 유효한 미등록/만료 토큰은200 `{available:false,progress:null}`이며 잘못된입력은400. preview는 poll하지 않는다. 취소/완료/새요청/새대화 뒤에는 멈추고 늦은진행 응답도 기존request/version guard로 무시한다. 진행연결이 실패해도 원래응답은 기다리고 실패한것을완료로표시하지않는다.

진행 DTO: `{version:1,status:'running'|'completed'|'failed',sequence,updatedAt,currentStage:'records'|'hospitals'|'support'|'plan'|null,stages:[{id,status:'waiting'|'running'|'observed'|'needs_input'|'failed',lastTool:string|null}],events:[{sequence,stage,tool:string|null,status:'started'|'completed'|'needs_input'|'failed'}]}`. events최대32·sequence상한128. tool은고정allowlist만 허용하고 실제tool시작/끝/안전한상태만 기록한다. 환자이름·query/원문·인자·결과·reasoning·연락처·출처URL·시연수신기관명·예약/위임 필드는 없다. UI문구는고정사전에서 만들며 실제/시연은기존경계와함께읽는다. 응답 전의caseState는마지막확인상태로유지한다.

로컬은메모리, AWS는기존DynamoDB의별도 `progress#sha256(token)` 키와120초TTL을 쓴다. 기존 session version1/lease/budget/엄격상태검증은 변경하지 않는다. 추가 테이블/권한/외부API를 만들지 않는다. 읽기는만료를앱에서도검사하고토큰원문은저장하지않는다. 행에는서버가임의생성한128bit writer소유표식을추가하며같은토큰을재사용한다른writer가덮거나TTL을연장할수없도록조건부기록한다. 소유표식은외부DTO/모델/세션/로그에보내지않는다. 잘못된일반요청/키없음/preview는progress저장을하지않는다. 진행 기록은best-effort·짧은별도timeout으로 제한하며 기록/읽기 실패가 모델/세션 저장·응답을 막지 않는다. 일시적인저장실패는같은제한예산안에서다음실제전이의최신snapshot부터이어가고, 소유권충돌은해당writer의기록을멈춘다. 응답을받지못한최초기록이이미저장됐어도동일소유자만재개할수있다. 생성/기록은실제런타임전이에서만하며최대도구16/모델8/45초·일80요청 한도는 그대로다.

## UI 상태와 검증

네 창은 의무적단계폼이 아니다. 병원응답대기에도 확보된조건으로이동문의준비가능; 시각변경시3번재확인; AI거절/본인확인은중단/담당표시; 미확인자료/교통원자료는그대로표시한다. timer로단계를앞당기거나 가짜퍼센트를 만들지않는다. 공통입력만있고상태창을클릭한다고모델·전화·예약을실행하지않는다. 4번 답변의확대/모바일창선택은읽기행위다.

PC1440×900·1280×800, 모바일390×844·360×780·390×500·가로768×512, 긴입력/200%CSS글자, 긴실제기관명/표/출처, 키보드탐색과기존modalfocus를검증한다. 모든버튼/중요링크44px·본문15/모바일입력16·중요고지14px. 감소모션에서는전환효과를제거한다. backend단위/API providerfixture의진행 관측·토큰검증/TTL·DDB왕복·원문미저장·오류비차단을검증한다. 실제공개모델·DDB진행은배포후대표1요청을단독실행해관측하고순차검증한다(배포동시실행상한2).

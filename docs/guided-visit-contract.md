# 현재 할 일 중심 진료 준비 계약

기준6cbc9d2 · 사용자 승인2026-11-01. 중앙 현재 준비 단계1개와 오른쪽 네 단계 진행 안내로 바꾼다. 기존 한 화면 작업 공간의 크기·단일 입력·초안/초점/읽기·복구·시연 경계는 보존한다. 이 계약의 중앙 업무 흐름이 이전 chat-rail/viewport의 채팅 중심 배치보다 우선한다. 로고·폰트·초록/주황·제주 배경은 기존 체계를 따른다.

## 사용자 흐름

처음에는 자유로운 텍스트/음성 의뢰 한 번으로 시작한다. 기존 사례와 이미 입력한 조건을 재사용하고 보호자가 모르는 조건을 임의로 채우지 않는다. 중앙에는 방문·자료 확인 / 병원·협진 준비 / 이동·동행 조율 / 방문 준비표 중 지금 할 일 한 개만 크게 보여 준다. 오른쪽 네 행은 전체 진행·미확인·인계의 길잡이이며 원하는 단계를 다시 읽을 수 있다. 기존 대화·처리 기록은 같은 중앙 스크롤에서 보조 기록으로 접근한다. 네 개의 채팅창·단계별 내부 스크롤은 만들지 않는다.

보호자 질문은 꼭 답이 필요한 조건만 둔다. 기관/의료진이 해야 하는 일은 보호자에게 반복 질문하지 않는다. 미확보 자료는 발급/제출 할 일로 남기고 독립적으로 할 수 있는 문의 초안은 이어 준비한다. 필요 없는 이동/동행은 해당 없음으로 표시한다. 실제 발신/예약/배차/임상 수락과 초안/합성 결과를 구분한다. 답변 도착·모델 종료·도구 observed만으로 준비 완료를 만들지 않는다.

## 공통 업무 projection

새 DB 상태·별도 workflow 저장소 없이 기존 caseState와 careJourney.tasks/handoffs/schedule, visitSupport를 재사용한다. app/preparation-workflow.js의 순수 getPreparationWorkflow(state)는 모델 도구와 UI가 공유한다. 기존 app/preparation-stages.js의 고정 진행 DTO/정규화는 유지하고 getPreparationBoard 결과에 workflow를 함께 제공한다. 고정 stage id와 표시 정의는 한 곳에서 재사용하고 순환 import를 만들지 않는다.

공개 인터페이스는 다음과 같다(표시 문자열은 기존 근거에서 생성).

```
workflow = {
  version: 1,
  currentStageId: 'records'|'hospitals'|'support'|'plan',
  currentTask: null|{id,stageId,status,actor,owner,title,detail,question:null|string,choices:[],requestDraft:null|string},
  stages: [{id,title,status,label,summary,actor,remainingCount}],
  remainingTasks: [{id,stageId,status,actor,owner,title,detail,requestDraft:null|string}],
  nextAutomaticActions: [{name:'prepare_inquiries',input:{kind:'taxi'|'companion'}}],
  summary: {label,remainingCount,waitingCount,preparedCount},
  visitReady: false
}
```

status는 not_started/needs_input/prepared/waiting_external/handoff/needs_recheck/not_needed 중 의미에 맞춰 사용한다. actor는 caregiver/agent/institution/clinician 중 하나다. 정의상 prepared는 준비 결과/초안이 있다는 의미다. 현재 real acceptance 등의 경계가 모두false이므로 visitReady를true로 만들지 않는다. currentTask는 보호자 핵심 조건→재확인/가능한 준비→인계/기관 대기→정리의 우선순위를 사용하되 기관 대기가 독립 작업을 가리지 않게 한다. 선택해서 읽는 단계와 실제 currentStageId는 별개다.

responseCount는 대화 존재·기록 접근·초기 화면 구분에만 사용한다. 업무 readiness/signal/완료는 상태에서 계산한다. 보고서 생성은 저장상태를 바꾸지 않으므로 과거에 생성한 기록을 만들어내지 않는다. 준비표는 현재 상태로 다시 계산한 내용이며 미확인을 포함한다. get_case/get_care_journey 등의 LLM 결과에는 currentTask·stage 상태·nextAutomaticActions의 작은 요약만 제공하고 이미 있는 전체 task/source를 중복해 토큰을 늘리지 않는다.

## 자동 이어가기와 비용 경계

신규 UI의 일반 제출은 선택적 guidedPreparation:true를 보낸다. 기존 요청/fixture는 필드가 없으면 이전 동작을 유지한다. 이 boolean은 strict validation하고 receipt 지문에 포함한다(없음/false의 기존 지문은 보존, true와 다른 본문은409). client caseState·동의 플래그를 받아 실행하지 않는다.

자동 이어가기는 하나의 명시적 POST와 기존45초·최대8모델회차/16도구 안에서만 수행한다. 실행 가능한 다음 행동을 공통 projection과 Prompt로 모델에 제공한다. 모델이 일찍 end_turn했을 때도 이번 메시지의 명시적 방문/지원 준비 범위가 확인되고 guidedPreparation:true인 경우 남은 안전한 문의 초안 최대2개만 기존 dispatcher로 이어 정리할 수 있다. 실제 toolCount·progress·events에 포함하고 요청 종료 후 새 모델 호출/POST를 추가하지 않는다. 이미 준비된 초안은 다시 만들지 않는다. 명시적 전체 방문 준비 요청이면 모델 도구 기록이 없어도 서버에서 읽은 방문일·지역·대상과 미시작 지원 상태로 안전한 공개 초안까지 준비할 수 있다. 시각 미정은 미확인으로 표기하고 다른 준비를 가리지 않는다. 날짜·지역·대상 누락은 보호자 확인으로 남긴다. 명시한 날짜/시각/지역/병원/지원조건을 해당 갱신 도구가 반영하지 못한 경우 과거 조건으로 자동 초안을 만들지 않고 보류한다. 같은 조건의 재언급도 보수적으로 보류할 수 있으며 자연어 조건 파서를 추가한 것은 아니다. 건강기록 미연결·의료진 대기는 독립 지원 초안의 전역 차단 사유로 쓰지 않는다. 대상별 준비 금지/단독 요청과 실제 전화만 하지 말라는 제한은 구분한다.

이 자동 경로는 공개 등록 자료에 기반한 내부 초안만 담당한다. 원문 기록을 자동 생성/조회하거나 전화 adapter·prepare_review·자료 전송·예약/배차·동의 변경·합성 실패 시나리오를 자동 실행하지 않는다. 읽기/비교만 한 요청에는 상태를 바꾸지 않는다. 준비하지 말라는 명시적 제한과 수신 거절/본인확인/미연결/필요 조건·한도를 존중한다. 실패/가능 응답/인계 상태를 새 초안으로 덮어 지우지 않으며 변경된 기존 일정의 재확인은 별도 남긴다. 실제로 이어 수행한 결과와 멈춘 이유를 최종 응답/후속 할 일에 명시한다.

capabilities/진행 polling/단계 선택/상세 열기/resume는 모델·budget·도구·추가 일을 실행하지 않는다. 새로고침은 저장된 확인 상태로 projection만 다시 계산한다. 원 요청 범위를 저장하지 않으므로 재개 시 자동 실행하지 않는다. 최초 요청/응답 유실·receipt/lease/TTL·원문 미저장 경계를 유지한다.

## 화면과 입력

app/conversation.js/css·preparation-board-view.js를 우선 재사용한다. 단일 form/textarea·음성·중지/재시도·설정/환자/전화/여정 dialog와 ID를 보존한다. 중앙 현재 할 일과 현재 단계 상세의 실제 DOM은 한 번만 유지하고 비활성 단계는 hidden/inert 처리한다. 오른쪽은 네 개의 작은 탐색 행이다. 단계 이동은 읽기이고 실제 업무 상태를 바꾸지 않는다.

질문 선택/후속 요청은 기존 fillRequestDraft와 초안 교체 확인을 사용한다. 클릭만으로 숨은 시각/권한/실제 실행을 추가하지 않고 '답변 초안' 의미를 명시한다. 공통 텍스트/음성에서 직접 보낸 요청만 API 실행이다. 미정은 미정으로 남겨 다른 준비를 볼 수 있고 임의 필수 값을 강제하지 않는다.

대화·처리 기록은 native details로 읽을 수 있으며 긴 본문/표/복사·넓게 읽기·오류 복구를 삭제하지 않는다. 출처를 읽는 중 새 응답이 와도 같은 DOM/focus/펼침/위치를 유지하고 알림으로 새 결과 접근을 제공한다. 중앙으로 옮긴 출처도 기존 읽기 보존 함수를 확장해 처리한다. 100dvh/실제16px·확대/44px·공통 입력/좁거나 낮은 창 전환을 유지한다. 모바일은 현재 할 일·단계 탐색이 분리돼도 같은 입력과 같은 단계 DOM을 사용한다.

## 소유권과 검증

- guided-backend: 공통 workflow/projection, service/tools/validation/receipt와 Prompt, 관련 단위검사. DB/인프라/모델/provider 변경 없음.
- guided-ui: conversation.js/css, preparation-board-view.js, 필요한 기존 icons.js. API/업무 상태 정의 수정 없음.
- guided-qa: 기존 conversation/journey/preparation-board/recovery/integration browser scripts. 기존 보안/초안/취소/접근성/복구의 목적을 보존하고 배치 전제만 새 계약에 맞춘다. 수동 workspace 검사는 유지.
- root: 문서·하네스·통합·키를 끈 QA 서버·독립 검토·커밋/배포·산출물.

단위는 responseCount 변경만으로 readiness가 바뀌지 않음, 미확보/기관대기/인계/해당없음/시각변경, 안전한 자동 초안/읽기-only/부정 요청/한도/중복/복구 부작용을 확인한다. UI는 최초 의뢰→실제 상태 기반 현재 작업→필요한 확인→다음 준비→미확인을 포함한 준비표를 fixture·실제 keyless preview로 재현한다. 기존10크기·긴 입력/표/큰글자/초점·읽기/복구를 보존한다. 브라우저 동시실행은최대2개, 실제native zoom은단독으로 실행한다.

현재 API 크레딧 소진으로 이번 구현에서 실제 모델 호출은 하지 않는다. 새 Prompt/자동 이어가기의 실제 모델 품질을 과거12과업으로 대신 검증했다고 쓰지 않는다. 서버/Prompt가 바뀌므로 이전 UI-only 모델 불변 예외를 재사용하지 않고 새로운 fixture/시연 범위와 실제 모델 미검증을 명확히 표시한다. 실제 전화·개인기록·기관/의료진·임상/법률·휴대폰/센터PC는 별도다.

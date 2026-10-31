# 진료 연결 여정·후속 할 일 계약

2026-10-31. 혼디는 의료진·기관의 판단에 필요한 행정 준비와 후속 실행을 연결한다. 일반 환자의 도내 전환 가능 여부를 결정하지 않는다. 현재 개인 기록·통화·예약·배차·의료진 확인은 합성 시연이며 실제 공개 데이터·LLM 연결과 구분한다.

## 소유권과 기준

기준 `b40b34b`. backend는 `app/care-journey.js`, domain/support/call-policy, Agent 도구·preview·검증·Prompt와 해당 단위 검사를 소유한다. UI는 conversation.js/css·DESIGN·design.json, QA는 별도 journey 브라우저 스크립트를 소유한다. root는 README/PRD/계약/하네스/패키지와 통합·원격 게시를 담당한다. 브랜치 base는 이 계약을 등록한 root 커밋으로 함께 고정한다.

## 공개 DTO

브라우저와 Node가 같은 순수 `getCareJourneySummary(state)`를 import한다. 기존 version1 상태에 새 optional 필드를 추가해도 이전 상태를 읽고 저장할 수 있어야 한다. 새 상태 내부 형식은 backend 소유이며 UI는 아래 요약만 소비한다. 아래 string 필드는 모두 UI에서 escape한다.

```js
{
 version:1,isSimulation:true,
 pathway:{status:'unconfirmed'|'demo_confirmed',outcome:'unconfirmed'|'local_transfer'|'shared_care'|'mainland_continues',label,detail,evidence:[]},
 pathways:[{id,label,detail,selected:boolean}], // 3개 결과. 기본 선택·추천 없음
 tasks:[{id,title,status:'todo'|'blocked'|'ready'|'recheck',owner,detail,evidence:[],requestDraft}],
 findings:[{id,target,label,detail,at,isSimulation:true}],
 schedule:{date,time,revision,taxiStatus,companionStatus,recheckReasons:[]},
 dataImpact:[{id,datasetId,sourceUrl,title,detail,candidateCount,questions:[]}],
 nextActions:[{id,title,detail,requestDraft}],
 activeScenario:null|{id,label,summary},
 boundary:{actualCallPlaced:false,reservationConfirmed:false,clinicalAcceptanceConfirmed:false,externalRecordsConnected:false}
}
// evidence: {documentId,label,excerpt,authoredAt:string|null,confirmedAt:string|null,
// confirmation:'unverified'|'demo_confirmed',sourceUrl:string|null,isSimulation:true}
```

`export const JOURNEY_SCENARIOS`는 `{id,label,description}` 3개 목록이다. id는 `missing_record`(자료 누락), `jeju_unavailable`(제주 요청 접수 거절), `time_changed`(진료 시각 변경)다. 새 예시의 state·events는 같은 reducer와 Agent 도구에서 만든다. 기존 aewol-parent-visit preview15이벤트는 그대로 지원한다. `/api/agent/preview`의 기존 `scenarioId`에 위 세 값을 추가하고 서버에서 allowlist로 검증한다. 임의 임상 결과/원문/전화 결과를 HTTP나 모델 인자로 주입하지 못한다.

## 기능 수락 기준

- 세 진료 결과는 의료진 확인이 없으면 미확인이다. 합성 확인에는 명시적 source/시점/합성 표시가 필요하다. 행정 접수 거절로 임상 판단을 만들어내지 않는다.
- 합성 의료진 안내의 요구 문서·일정을 보유 자료와 비교한다. 판독문 누락→발급 절차 문의→제주 제출 방식 확인의 의존 작업이 보인다. 원문 발췌·작성일·확인 여부를 보존하고 날짜 미상은 null로 둔다. 실제 검사 지시·진단·의뢰서 생성 금지.
- 병원 휠체어 대여/수령/반납, 차량에 앉은 채 탑승, 승하차·동행인, 지연 시 귀가/동행 재조정 질문을 연결한다. 합성 응답을 다음 문의와 할 일에 반영한다.
- 시각/일자/기관/출발지역/휠체어 조건 변경 시 기존 이동·동행 결과를 유효한 예약으로 유지하지 않는다. 기존 조건과 바뀐 조건·재확인 이유가 보인다.
- 허브859·327·254와 별도 공식2건을 지역·기관종류·지원조건에 연결한다. 출처·후보수·필터/질문 변경 이유를 보여주며 공개 자료를 현재 수용/차량/인력 확인으로 확대하지 않는다. 거절 기관 대신 후보를 제시하되 임상 적합성·예약을 확정하지 않는다.
- 새 `get_care_journey` 도구는 요약을 읽는다. `run_journey_demo`는 명시적 시연 요청에서만 허용하고 위3개 합성 시나리오를 실행한다. 일반 보호자 요청은 기존 update/contact/support 도구로 진행하며 변경 후 새 요약이 일치한다. 실제 전화 어댑터 거부는 유지한다.

## UI·검사 계약

기존 혼디 로고·제주 배경·floating 방문 요약·patient/contact dialog·짧은 화면·대기 중지·초안만 채우는 예시를 유지한다. 주 화면에 현재 진료 연결 상태와 다음 할 일을 간단히 보이고 상세는 native dialog에 둔다. 별도의 큰 홍보 카드나 수동 입력 단계를 만들지 않는다.

선택자: `#nav-care-journey`, `#care-journey-dialog`, `#close-care-journey`, `#care-journey-content`, `[data-journey-task]`, `[data-journey-pathway]`, `[data-journey-draft]`, `[data-journey-scenario]`. 문의 초안 버튼은 editable composer만 채우고 POST하지 않는다. 상황 미리보기 버튼은 명시적 합성 preview만 실행한다. 모달 focus/inert/Escape·대기중지/late응답·작성초안 보호를 기존 방식과 맞춘다.

단위 검사는 세 결과/세 상황, 증거 없는 결과 금지, 자료 의존성, 접수거절≠임상판단, 일정 변경 재확인, 지역·휠체어 후보/질문 변경, 기존 상태 호환·실발신 거부를 검증한다. 브라우저는 PC/mobile의 세 상황을 실제 keyless preview API로 확인하고 초안 비발송·포커스·상태/출처·넘침·기존 편의성을 확인한다. 공급자 fixture와 실제 유료 모델 검증은 구분한다.

## 전화 실패 복구·사람 인계 (추가 요구)

무응답은 허용한 범위 안에서만 재시도한다. AI 응대 거절은 자동 반복 발신을 멈추고 보호자에게, 본인확인은 환자에게 넘긴다. 서류 부족은 자료 작업에 연결하고 예약 불가는 사용자가 허용한 다른 날짜를 문의하며 임의 예약하지 않는다. 실패 이유·시도 내역·남은 일·담당자를 없애거나 성공으로 덮지 않는다.

순수 `app/call-recovery.js`와 동일 simulation dispatcher/reducer의 gate를 사용한다. `getCareJourneySummary`에 `handoffs:[]`를 추가한다. 각 항목은 `{id,target,reason,status,title,detail,attempts:[{number,at,outcome,isSimulation:true}],retryPolicy:{configured,maxAttempts,windowMinutes,startsAt,expiresAt,scheduled:false},owner,contact:{name,phone,sourceUrl},questions:[],remainingTasks:[],requestDraft,stopAutomatic,actualCallPlaced:false}`다. 번호 미확인은 null로 두며 등록 번호를 실제 연결 확인으로 표시하지 않는다.

기본 재시도 정책은 미설정이다. 새 `update_call_retry_policy(target,maxAttempts,windowMinutes)`는 사용자 메시지에서 명시적으로 허용한 시연 재시도 범위만 반영한다. maxAttempts는 최초 포함 총1~3회, windowMinutes는1~120분이다. 일정/나이의 숫자로 추정하지 않는다. 같은 정책 재적용·반복 tool 실행으로 시도 내역이나 허용 시작/종료 시각을 초기화하지 않는다. AI 거절·본인확인 중단을 정책 설정으로 해제하지 못한다. `scheduled:false`는 실제 자동 발신 예약이 없다는 뜻이다. 실제 환자의 위임·실발신은 계속 false다.

`CALL_RECOVERY_SCENARIOS`는 별도4개 목록이며 care-journey.js에서도 재export한다. id는 `call_no_answer`, `call_ai_declined`, `call_identity_required`, `call_documents_or_schedule`다. 기존3개 JOURNEY_SCENARIOS는 유지한다. preview API에 같은4개를 추가하고 `run_call_recovery_demo`는 명시적 시연 의도에서만 실행한다. 모델/HTTP가 시계·결과·기록 원문을 주입하지 못한다.

UI는 전화 준비 창의 간결한 실패/인계 영역에서 실제 handoff를 읽고 별도 접힌 합성 예시를 제공한다. `#call-recovery-examples`의 `[data-call-recovery-scenario]`, `#call-handoffs`의 `[data-call-handoff][data-status][data-owner]`를 사용하며 준비 초안 `[data-call-handoff-draft]`는 기존 공통 fillRequestDraft의 noPOST/기존초안 보호 규칙을 따른다. 실제 자동 재시도가 예약됐다고 표시하지 않는다. 단위 검사는 횟수/시간 초과 차단, 같은 정책 멱등·누적 보존, 거절/본인확인 중단 우회 방지, 서류/날짜 후속 작업을 검증한다. 브라우저는4개×PC/mobile의 실제 keyless preview와 인계·시도·담당·남은 일·미발신 경계를 확인한다.

현재 복구 상태는 대상별(기존 도외 병원·제주 병원·택시·동행) 한 수신처 범위입니다. 거절 뒤 다른 기관을 명시 선택하면 새 문의 초안을 만들 수 있지만 자동 문의는 인계 상태를 유지합니다. 이전 수신처의 실패를 새 기관의 거절로 표시하지 않습니다. 여러 기관별 전화 스레드·새 위임 범위 검증·실제 발신은 후속 구현입니다.

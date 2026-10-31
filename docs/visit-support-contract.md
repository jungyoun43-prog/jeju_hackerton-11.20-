# 방문 이동·동행 지원과 한눈에 보는 진료 준비

2026-10-31. 사용자는 병원 목록 한 종을 조회하는 수준의 데이터 활용이 얕다고 지적했고, 택시·동행 지원 기능을 요청했다. 이어 메인 화면이 허전하고 한눈에 들어오지 않는다고 지적했다. 기존 문의·자료·협진 준비와 실제 데이터 사용을 유지하면서 아래 범위를 구현한다. 실제 발신·배차·결제·동행인 고용은 연결하지 않았다.

## 서비스와 첫 화면

방문 날짜·제주 기관·자료·이동·동행을 같은 사례에서 준비한다. 사례 제목 높이를 줄이고, 이번 방문의 핵심 상태와 막힌 조건을 첫 화면에 모은다. PC 1440×900에서 방문일·병원/자료/택시/동행 상태·주 행동이 보인다. 모바일 390×844에서도 이번 방문과 다음 행동, 이동·동행 준비의 존재가 보인다. 큰 공백·홍보 문장·동일 카드의 반복으로 채우지 않는다. 실제 상태를 보여주는 준비 요약, 이동 흐름, 우선 작업 목록을 사용한다. 이미지 로고를 유지하고 의사·가족 일러스트는 다시 넣지 않는다. 현재 단일 방문의 이동·동행 확인과 반복 방문 횟수의 예산 가정을 혼동하지 않는다.

## 실제 데이터

- 병·의원 859 공개 표본20행→후보13곳: 기존 기능.
- 콜택시327의 연결 원출처 공공데이터포털15056321 최신 공개 CSV: 34행, 기준2026-03-19. 허브 자체의 2020년 미리보기45행과 구분한다. 지역·명칭·대표전화·기준일만 변환한다. 현재 빈차·도착시간·운임은 없다.
- 노인돌봄서비스시설254 공개표본19행: 지역·기관·주소·대표전화·구분, 기준2020-04-17. 병원 동행을 제공하는 기관으로 단정하지 않고 지역 돌봄 문의처로 표시한다.
- 공식 서비스 보완: 제주시니어클럽 아름동행의 병원동행·이동지원 소개와 제주 교통약자이동지원센터의 이용 안내. 허브 데이터와 별도 출처다. 자격·회원등록·운영범위·가능일·비용은 문의 항목이다. 교통약자센터의 ‘동행콜’은 병원 동행인이 아니다.

출발 지역과 지원 유형이 후보·문의 질문·준비 공백을 바꿔야 한다. 예: 애월 출발→애월콜 문의처, 보호자 동행 불가→병원동행 문의 작업, 휠체어 필요→차량 유형·이용자격 확인. 단순 기관 목록 추가로 끝내지 않는다. 지역 일치와 임상 적합성·실제 배차를 구분한다.

## 파일 소유권

| 작업 | 브랜치 | 수정 허용 |
| --- | --- | --- |
| visit-ui | feature/visit-dashboard | app/app.js, app/styles.css, app/index.html, app/icons.js, app/map.js, DESIGN.md, .impeccable/design.json |
| visit-workflow | feature/visit-support-workflow | app/visit-support.js, app/domain.js, tests/visit-support.test.mjs, tests/domain.test.mjs |
| root | main | app/support-data.js, app/data/visit-support-providers.json, scripts/support-data.mjs, tests/support-data.test.mjs, 공통 계약·문서·하네스·브라우저 검사·통합·배포 |

각 수정자는 전용 worktree에 커밋한다. root가 통합한다. 독립 조사는 읽기 전용이다.

## 지원 데이터 인터페이스 — root

`app/support-data.js` exports:

- `loadSupportRegistry(fetcher=globalThis.fetch)` → `/data/visit-support-providers.json`을 로드·검증한 registry.
- `getSupportCandidates(registry,{kind:'taxi'|'companion',area,wheelchair:false})` → `{...provider,matchLevel,matchLabel}[]`. 지역 일치 우선, 시·도 범위는 확대 문의 후보로 표시. 다른 시의 지역 전용 업체를 해당 지역 일치로 표시하지 않는다. 휠체어 시 공식 특수 이동 문의처를 우선하되 이용자격은 미확인으로 남긴다.

registry: `{schemaVersion:1,retrievedAt,datasets:[{id,name,hubUrl,sourceUrl,scope,asOf,rowCount}],providers:[provider]}`.

provider: `{id,kind:'taxi'|'companion',name,region,address,phone,serviceType:'call_taxi'|'care_contact'|'hospital_escort'|'accessible_transport',description,source:{datasetId,url,hubUrl,scope,asOf,retrievedAt}}`. 공식 보완 서비스의 datasetId는 빈 문자열이며 허브 데이터 수에 포함하지 않는다. serviceType으로 확인된 서비스 소개와 단순 돌봄 등록을 구분한다.

## 상태·action 인터페이스 — visit-workflow

`app/visit-support.js` exports:

- `createVisitSupport()` → 초기 지원 상태.
- `applyVisitSupportAction(state,action)` → 사례 전체의 immutable 새 상태. `SUPPORT_` action만 처리한다.
- `reconcileVisitSupport(previous,next)` → 병원·방문일·출발지역·지원조건 변경 시 관련 문의 응답을 `needs_recheck`로 돌려 오래된 응답 재사용을 막는다. 새 사례 전체를 반환한다.
- `getVisitSupportSummary(state)` → `{taxi,companion,unresolved:string[],nextActions:[{kind,title,reason}],preparedCount,totalNeeded}`. 각 taxi/companion은 `{status,label,providerName,source,questions:string[]}`. 단일 방문 준비의 상태이지 반복 방문 전체의 배정 수가 아니다.
- `buildSupportInquiry(state,kind)` → 질환·검사내용 없이 출발 지역·방문일·선택 기관·지원조건·미확인 항목을 담은 한국어 문의 초안 문자열.
- `buildVisitSupportReport(state)` → 시연·출처·응답·재확인 조건을 포함하는 문자열.

`state.visitSupport = {requirements:{transportNeeded:true,companionNeeded:true,wheelchair:false,appointmentTime:''},taxi:{provider:null,status:'not_selected',response:'',wheelchairConfirmed:false,eligibilityConfirmed:false},companion:{provider:null,status:'not_selected',response:''}}`.

actions:

```js
{type:'SUPPORT_UPDATE_REQUIREMENTS',values:{transportNeeded,companionNeeded,wheelchair,appointmentTime}}
{type:'SUPPORT_SELECT_PROVIDER',kind:'taxi'|'companion',provider}
{type:'SUPPORT_PREPARE_INQUIRY',kind}
{type:'SUPPORT_RECORD_RESPONSE',kind,outcome:'available'|'unavailable'|'unreachable',wheelchairConfirmed?:false,eligibilityConfirmed?:false}
```

status: `not_selected|selected|prepared|available_demo|unavailable_demo|unreachable_demo|needs_recheck`. 실제 예약 확정을 뜻하는 상태를 만들지 않는다. 시연 응답이 가능이어도 시점·휠체어·회원자격 등 빠진 조건을 unresolved에 남긴다. 문의 전 응답 기록은 거부한다. 지역과 연락처가 있다고 병원동행 제공·휠체어 탑승을 확정하지 않는다. 필요없음은 requirements로 판별하며 다른 지원의 문의 상태와 섞지 않는다.

domain.js는 createDemoCase에 초기 visitSupport를 넣고, applyAction에서 SUPPORT_ action을 새 reducer로 전달한다. 기존 action 적용 후 reconcile하며 buildReport에 지원 보고서를 추가한다. 기존 getTasks·getProgress·calculateBurden의 의미는 보존한다. 지원의 다음 행동은 별도 summary로 제공한다.

## UI 행동

app.js는 위 데이터·summary를 import한다. 일정·동행 영역에서 필요 여부·휠체어·예약시각을 입력하고, 후보를 선택해 문의 초안을 만들며 불통/불가/가능의 **합성 응답**을 기록한다. 초안 복사/저장과 공식 출처·대표번호 확인 경로를 제공한다. 실제 전화를 걸거나 배차·결제를 했다고 표시하지 않는다. 마감 없는 일반 폼은 modal로 가리지 않는다.

메인 요약은 같은 visitSupport 상태를 읽고, 선택/응답/조건 변경을 즉시 반영한다. 데이터 로딩·실패·후보 없음·오래된 시점·지역 확대의 설명을 구분한다. 현재 지원 준비는 방문1건, 기존 반복 방문 예산은 가정이라는 표시를 유지한다.

## 검증

동일 지역의 최신 콜택시, 다른 지역 미매칭, 범용 돌봄과 실제 동행서비스 구분, 휠체어 질문, 문의 전 응답 차단, 불통·불가 후 다른 후보, 병원/날짜/지원조건 변경 후 재확인, 개인정보 최소 문의 초안과 보고서 출처를 검사한다. 기존33개 브라우저 동선과 새 지원 동선을 PC·모바일에서 검증하고 독립 검토 후 AWS CI로 배포한다.

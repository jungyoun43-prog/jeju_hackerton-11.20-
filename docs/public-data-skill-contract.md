# 진료 준비용 제주 공공데이터 스킬 계약

2026-10-31. 보호자의 진료·이동·동행 조율에서 쓰는 내부 도구다. 범용 공공데이터 챗봇/별도 대시보드를 만들지 않는다. 이번 MVP는 기존 JSON/CSV 읽기 전용 저장소와 분류 카탈로그로 구현하며 새 관리형 DB·실시간 원자료 연결을 했다고 표시하지 않는다.

## 분리와 입력

- 카탈로그는 `research/datahub_catalog_screening_2026-10-31.csv`의 허브1,259개 목록과 `research/center_schema_index_2026-10-31.csv`의 센터70개 명세를 최소 메타데이터로 색인한다. 의료/돌봄/이동의 폴더·태그와 기타/미분류를 구분하고 업무 purpose에 맞는 소수 결과만 반환한다. 카탈로그 수≠원자료 접근/계산 가능한 자료 수다.
- 원자료 조회는 이미 정제한859(공개20행→정상13후보),327(연결최신파일34업체),254(공개19문의처)와 별도 공식2건을 등록 loader로 읽는다. 새 자료는 저장/이용조건/항목을 확인한 뒤 adapter를 추가한다. 목록의 metadata_updated를 원자료 기준일로 쓰지 않는다.
- `app/public-data-skill.js`(Node/browser 공유 순수 모듈)와 `app/data/public-data-catalog.json`, 재생성/조회 CLI를 데이터 담당이 소유한다. `agent/public-data-tools.mjs`와 별도 adapter검사는 도구 담당이 소유한다. root가 기존 Agent tool목록·Prompt·기존 준비도구에 연결한다.
- 집계/비율/중복 제외/후보선정은 코드가 수행한다. LLM은 도구 선택과 설명을 맡고 값·출처·분모·표본/결측·자료 시점·한계를 보존한다. 임의SQL/파일경로/URL·원자료 fetch를 모델 인자로 받지 않는다.
- coverage.collectedAt은 현재 저장snapshot을 취득한 날짜다. 859의 원자료 수집일2024-10-17과 행별 갱신 범위는 coverage.label에서 별도로 보존하며 취득일2026-10-31을 기준일로 사용하지 않는다.

## 공개 모듈 API

```js
export const PUBLIC_DATA_SOURCE_URLS; // 검증한 공식 source URL 목록
export function searchPublicDataCatalog({purpose,query,limit=5});
// purpose: hospital | taxi | companion | travel, query<=200(생략시빈문자열), limit1..8
export function analyzePublicData({analysis,areas,area,supportKind,wheelchair},context={});
// analysis: facility_compare | support_candidates | travel_time
// compare: areas 정확히2개; support/travel의area 생략시 context.area 사용; supportKind 생략시both
// context:{area,wheelchair,hospitalName} 최소 운영조건만 전달, 환자이름/진료기록 제외
export function getPreparationDataEvidence(context,purpose);
```

검색 결과: `{version:1,purpose,query,indexedMetadataCount,usableSnapshotIds,results:[{id,title,folder,tags,sourceSystem,sourceUrl,availability,availabilityReason,columns,coverage:{kind,label,asOf,collectedAt,rowCount,complete},usableFor,notUsableFor}],limitations,suggestedAnalysis}`. id는 `hub:859`·`center:7`처럼 출처별로 구분한다. metadata-only 자료의 원자료 기준일·행수는 미확인이면 null이다.

분석 결과: `{version:1,analysis,status:'ok'|'partial'|'unavailable',title,scopeLabel,inputs,datasetRefs,rows,metrics,candidates,limitations,missingData,preparationActions,actualCallPlaced:false,reservationConfirmed:false,clinicalAcceptanceConfirmed:false,caseMutation:false}`. datasetRefs는 검색 결과와 같은 출처·범위·시점 정보를 포함하는 최소 메타데이터다. rows/metrics/candidates는 분석별이므로 빈 배열도 허용한다. preparationActions는 `{kind,title,reason,requestDraft,tool:{name,input}}`이며 실제 실행이 아니다.

- facility_compare: 질문의 두 지역을 같은 **관측 가능한 주소/등록 기준**으로 집계한다. 의료와 돌봄을 별도 분모로 표시하고 중복/결측/폐업 제외·표본 범위를 설명한다. 주소에 근거한 위치와 서비스관할을 혼동하지 않는다. 비율은 명시한 snapshot 분모만 사용하며 제주 전체밀도/인구당/질적우열을 추정하지 않는다. 주소미상은0개가 아니다.
- support_candidates: 기존 공개 registry와 같은 id/지역·휠체어 조건으로 문의 후보·연락처·확인 질문을 반환한다. 돌봄 등록을 병원동행인력 확보로 표시하지 않는다. 실제 전화/배차는 기존 별도도구다.
- travel_time: 센터7/8/10 등 관련명세는 찾되 원자료가 없으므로 status unavailable·시간수치/평균/ETA 미제공. 필요한 원자료·항목/조건과 택시에 문의할 이동시간·출발/지연 질문을 준비한다. 추정 숫자를 만들지 않는다.

## Agent 계약

`PUBLIC_DATA_TOOLS` 2개 JSON Schema spec과 `executePublicDataTool({name,input,state})`를 export한다. 도구는 `search_public_data`/`analyze_public_data`이며 각각 위 입력을 사용하고 `readOnly:true`로 표시한다. 결과는 기존 `{state,data,events,pendingActions}` 형태, state를 절대 변경하지 않는다. 원문 query는 새 세션 필드/로그에 저장하지 않는다. 새출처 event는 catalog allowlist로만 생성한다. root가 기존15도구와 합치고 `prepare_inquiries`/병원조회에 getPreparationDataEvidence를 연결한다.

비교질문의 지역을 환자의 실제 출발지로 덮어쓰지 않는다. 결과를 예약/의학적 적합성으로 해석하지 않는다. 준비 요청이 있을 때만 검증한 후보/질문을 기존 도구에 이어준다. 일반 준비는 providerId를 생략해 기존 선호택시·지역·휠체어 규칙을 적용하고 사용자가 이번 요청에서 해당 문의처를 명시 선택했을 때만 후보id를 넘긴다. 제안은 사용자의 선택·동의가 아니다. 근거와 불확실성을 설명한다. 키 없는 기본 API503·기존 preview15이벤트+여정/복구7상황은 보존한다.

## UI와 검증

새 메뉴 대신 기존 대화 응답에서 비교표·목록·출처를 읽는다. 안전한Markdown table 지원은 별도UI담당이 message-format.js/conversation.css와 해당검사만 수정한다. 기존HTMLescape/HTTPS링크·헤딩/리스트·모바일·인물없는제주배경·혼디로고·초안/중지/모달을 보존한다.

단위검사: 카탈로그/원자료 구분, 관련topK/폴더검색, 두지역snapshot 집계·분모/중복/주소결측, 휠체어/지역후보변경, 시간대원자료없음/ETA미생성, 데이터질문에서case무변경·개인기록미사용, 분석→유효한문의준비id/질문 연결. API/provider fixture·실모델 검증과 서로 구분한다. CLI는 키/네트워크 없이 같은 계산을 재현한다. 현재 수집 CSV의 offline 재색인과 실API/raw갱신을 구분해 문서화한다.

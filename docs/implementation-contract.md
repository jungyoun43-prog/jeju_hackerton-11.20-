# MVP 공통 인터페이스 v1

오케스트레이터가 작업 전에 고정한 인터페이스. 변경이 필요하면 통합 담당자에게 알려 양쪽을 함께 수정한다.

## 파일 소유권

| 작업 | 소유 파일 |
| --- | --- |
| UI | `app/index.html`, `app/styles.css`, `app/app.js`, `app/icons.js`, `app/map.js` |
| Workflow | `app/domain.js`, `app/hospitals.js`, `tests/domain.test.mjs`, `tests/hospitals.test.mjs` |
| 문서 | `docs/prd.md`, `docs/user-manual.md`, `docs/submission-checklist.md`, `docs/implementation-results.md`, `docs/data-sources.md` |
| 통합 | 그 외 파일. README·서버·빌드·패키징·하네스·공유 자산 포함 |

## 프런트엔드 계약

브라우저 ES modules. `app/app.js`에서 `./domain.js`를 import한다. Leaflet의 JS·CSS는 `/vendor/leaflet/leaflet.js`, `/vendor/leaflet/leaflet.css`에서 제공한다. 생성 이미지의 최종 공개 경로는 `/assets/jeju-care-v2.png`다. 초안 `/assets/jeju-coast.png`는 보존·참조용이다.

`GET /api/config`는 `{ "mode": "simulation", "tileUrl": "https://tile.openstreetmap.org/{z}/{x}/{y}.png" }`를 반환한다. 지도는 Leaflet/OSM을 사용하고 키 없이 Google Maps 외부 위치/길찾기 링크를 제공한다. Google Maps Embed는 현재 미구현이다. 병원과 집의 초기 마커는 합성 지점임을 표시한다. 실제 환자 주소는 외부 전송하지 않는다.

## 도메인 exports

- `createDemoCase()` → 아래 상태의 새 인스턴스.
- `applyAction(state, action)` → 입력 상태를 변경하지 않는 새 상태. 허용되지 않은 작업은 한국어 메시지의 Error를 던진다.
- `getTasks(state)` → `{id, title, description, owner, action, target?}[]`. `action`은 `call`, `document`, `submit`, `wait`, `plan` 중 하나. 문서 target은 문서 ID, call target은 기관 ID.
- `getProgress(state)` → `{index, label, steps:[{id,label,status}], prepared, total}`. index는 0..4, status는 `done/current/pending`.
- `getSummary(state)` → 현재 단계와 다음 할 일을 설명하는 한국어 문자열. 진단·치료 판단을 생성하지 않는다.
- `calculateBurden(plan)` → `{estimatedSubtotal, unknownItems:string[], careGap, complete}`. 숫자는 사용자 입력 가정이며 실제 견적과 구분한다. 미확인은 `null`로 유지한다.
- `buildReport(state)` → 시연 표시·출처·진행·미확인 항목이 포함된 Markdown 문자열.
- `DOCUMENT_DEFINITIONS` → `{id,label,description,owner}[]`.

## 상태

```js
{
 version: 1,
 patient: {name, age, area, caregiver, existingHospital, localHospital, purpose, nextVisit},
 permissions: {inquiry: true, share: false},
 documents: [{id, label, status, source, content}],
 inquiries: {
   mainland: {status, response, requestedDocuments: [], transcript: [{speaker,text}], at},
   jeju: {status, response, requestedDocuments: [], transcript: [{speaker,text}], at}
 },
 packet: {status: 'draft', submittedAt: null},
 review: {status: 'not_requested', outcome: null, note: '', source: ''},
 plan: {visits:2, caregiverAvailable:1, localTransport:40000, offIslandTransport:null,
        lodging:null, medical:null, caregiverTransport:null},
 events: [{id,at,title,detail,kind,source}]
}
```

문서 ID는 `history/report/exam/referral`. 상태는 `ready/missing/not_performed`. 처음 history만 ready이고 report는 missing, exam은 not_performed다. referral은 해당 요구가 생기기 전에는 필수가 아니다. 두 기관은 명시적인 가상 기관명이다. inquiry 상태는 `not_contacted/confirmed/unreachable/not_participating`. packet 상태는 `draft/submitted`, review는 `not_requested/pending/needs_information/completed`다. 확인된 임상 회신을 가장하는 실데이터를 포함하지 않는다.

## action

```js
{type:'SET_PERMISSION',permission:'inquiry'|'share',value:boolean}
{type:'RECORD_CALL',target:'mainland'|'jeju',outcome:'documents'|'referral'|'unreachable'|'not_participating'}
{type:'ADD_DOCUMENT',id:'report',content:'합성 자료 내용',source:'시연용 판독문'}
{type:'REMOVE_DOCUMENT',id:'report'}
{type:'SUBMIT_PACKET'}
{type:'RECORD_REVIEW',outcome:'needs_information'|'local_followup'|'mainland_visit',note?:string}
{type:'UPDATE_PLAN',values:{visits,caregiverAvailable,localTransport,offIslandTransport,lodging,medical,caregiverTransport}}
{type:'UPDATE_PATIENT',values:{name,area,caregiver,nextVisit}}
```

SUBMIT_PACKET은 두 기관의 절차 확인·필수 자료·정보 공유 허용을 검사한다. 전송도 재현이며 실제 의료기관 전송이 아니다. 자료·문의 변경은 기존 검토 결과를 무효화한다. needs_information은 새 판독문을 요구하는 보완 루프로 돌아간다. 전화 실패·미참여는 운영 상태일 뿐 도외 진료의 임상 필요성을 뜻하지 않는다. 임상 회신 후에도 예약을 자동 확정하지 않는다.

## 데이터 어댑터

`app/hospitals.js`는 `normalizeHospitals(rows, metadata)`와 `filterHospitals(records,{department?,area?})`를 export한다. 허브 스키마의 사업장명·주소·진료과·행별 날짜를 정리하고 폐업 행을 후보에서 제외한다. 전화·좌표·협진 가능 여부는 만들어내지 않는다. 테스트 fixture는 합성이다. 실제 운영 데이터 접근·권리는 별도 확인 대상으로 남긴다.

# 사용자 피드백을 반영한 UI·데이터 개선 계약

작성일: 2026-10-31. 사용자는 현재 화면이 단순하고 핵심이 보이지 않는다며 README 기준의 재작업과 실제 서비스들의 디자인 참고를 요청했다. AWS 배포·CI/CD 목표도 유지한다.

## 첫 화면에서 전달할 것

**보호자를 대신해 병원 문의와 자료 보완을 연결하고, 제주 대면 진찰과 기존 도외 주치의 검토의 준비 상황을 설명한다.** 첫 화면에서 사용자·문제·현재 막힌 조건·다음 행동·받을 결과가 보이게 한다.

큰 풍경 배너와 균등한 카드 나열의 비중을 줄이고 현재 협진 요청 중심으로 재구성한다. 사람 중심 v2 이미지·제주 팔레트는 유지한다. 의미 없는 지표·추천 점수·기술 설명을 늘리지 않는다. 실제 LLM·전화·병원 전송은 여전히 미연동이며 시연 표시를 숨기지 않는다.

첫 viewport 수락 기준: 1440×900, 390×844 모두 서비스의 역할과 주 행동 버튼을 스크롤 없이 확인한다. Agent 작업·양쪽 기관·누락 자료의 관계가 보인다. 모바일에서 인물 장면은 유지하되 다음 할 일보다 큰 공간을 차지하지 않는다. 완료/미확인/의료진 검토를 구분한다.

## 디자인 참고

공식 Linear 제품/문서, Wellthy Care Concierge, One Medical/Maven 등의 공개 화면을 실제로 읽고 시각적으로 확인한다. 로그인 뒤 제품 화면을 본 것으로 주장하지 않는다. 작업 밀도·우선순위·가족 돌봄의 설명 방식만 참고하고 로고·사진·카피·화면을 복제하지 않는다. 참고 URL·확인한 화면·실제 반영 사항은 별도로 기록한다.

## 데이터 범위

허브 859의 공개 미리보기는 20행(폐업7·당시 행정상 정상13)이다. 원자료의 공개 웹·ZIP 재배포 허락은 미확인이다. raw 행을 소스·정적 자산에 복사하지 않는다. 데이터 이용약관의 출처표시·통계 활용 범위를 검토해 **집계·품질 분석 결과만** 기록하며, 이는 전체 운영 API 사용이나 실시간 병원 수용 확인과 다르다. 사용자가 권한을 가진 파일을 가져오면 브라우저 메모리에서 기관 후보를 필터하고 선택하는 기능을 구현한다. 원본과 인증키를 서버에 전송하지 않는다.

## 작업 소유권

| 작업 | 수정 가능 파일 |
| --- | --- |
| ui-refresh | `app/index.html`, `app/styles.css`, `app/app.js`, `app/icons.js`, `app/map.js`, `DESIGN.md` |
| data-profile | `app/datahub.js`, `app/data/datahub-profile.json`, `scripts/datahub-profile.mjs`, `tests/datahub-profile.test.mjs`, `app/domain.js`, `tests/domain.test.mjs`, `docs/data-sources.md` |
| 디자인 조사 | 읽기 전용. 참고 캡처는 /tmp에 저장, 결과·출처를 root에 전달 |
| 통합 | 그 외 파일·공통 계약·하네스·CI/CD·실제 배포·검증 |

## 데이터 UI 공통 인터페이스

`app/datahub.js` exports:

- `loadDataProfile(fetcher=globalThis.fetch)` → `Promise<profile>`; `/data/datahub-profile.json`의 집계 snapshot을 검증해 로드한다. 실패하면 Error로 알리고 UI에서 미연결 상태를 표시한다.
- `parseHospitalImport(text, filename, metadata={})` → `{records, profile, metadata}`. JSON rows 또는 CSV를 기존 `normalizeHospitals`로 정리한다. 잘못된 스키마/과도한 입력은 거부. 결과는 사용자 가져오기이며 허브 운영 API 검증 완료로 표시하지 않는다.
- `summarizeHospitalRecords(rows, metadata={})` → profile. 집계만 반환하며 기관명·주소 원문을 포함하지 않는다.

profile 최소 형태:

```js
{
 schemaVersion:1,
 dataset:{id:'859',name:'병·의원 정보',provider:'LOCALDATA',sourceUrl,previewUrl},
 scope:'public-preview-aggregates'|'user-import',
 fetchedAt, totalRows, activeRegistrationRows, closedRows, otherRows,
 departments:[{name,count}],
 completeness:{addressRows,departmentRows,missingDepartmentRows},
 time:{collectedAt:[...],earliestRowUpdate,latestRowUpdate},
 missingCapabilities:['전화번호','실시간 수용','예약 가능일','협진 참여','좌표'],
 rights:{rawRedistribution:'unverified',basis:'출처·통계 집계 범위와 미확인 조건 설명'},
 rawDataStored:false
}
```

records는 기존 `app/hospitals.js` 정규화 결과를 그대로 사용한다. UI 담당자가 실제 필드명을 확인하고 서로 메시지로 조율한다. 반환 metadata는 출처 URL·사용자 제공·자료 시점을 구분한다.

새 도메인 action:

`{type:'SELECT_LOCAL_HOSPITAL',hospital:<정규화된 record>}`. 선택한 기관명을 `patient.localHospital`에 반영하고 `selectedHospital`에 출처와 등록정보만 남긴다. 제주 문의를 문의 전으로 되돌리고 packet/review는 무효화한다. 기존 의료기록 내용을 삭제하거나 등록 진료과를 임상 적합성·협진 참여로 바꾸지 않는다. 이 변화는 사용자 선택이며 실제 예약이 아니다. 보고서에 선택 출처와 운영 미확인 상태를 남긴다.

## 기존 기능 보존

두 기관 문의의4분기, 출처 있는 자료·공유 gate·추가자료 loop·합성 회신·예상 소계와 null 비용·동행 공백·보고서·리셋을 유지한다. 기존 data-* 동작 hooks와 입력 id를 가능한 보존해 검사와 실제 기능을 함께 갱신한다. 문의 시연을 실제 발신이나 예약 완료로 표시하지 않는다.

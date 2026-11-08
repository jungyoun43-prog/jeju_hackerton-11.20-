# 합성 FHIR 건강기록 연결 · 2026-11-08

사용자는 건강정보 고속도로 연계 이후의 기능을 시연할 더미데이터를 만들고 연결하도록 요청했다. 앞서 합성 FHIR 기록으로 자료 정리·진료 준비를 먼저 구현하는 방향을 승인했다.

- 앱에 직접 작성한 FHIR R4 `Bundle(type=collection)` 하나를 포함한다. 기존 김정희·68세·가상 도외 병원 사례에 맞춘 Patient, Organization, Encounter, DocumentReference, DiagnosticReport, Observation, MedicationStatement의 7개 리소스다. 실제 환자·기관 기록이나 공공데이터셋이 아니다.
- 기존 `request_records(source=demo)`가 Bundle의 치료이력·판독문 내용을 읽어 기존 문서 reducer에 연결한다. 진찰 소견·의뢰서·정보 공유·실제 발신·진료 수락을 생성하지 않는다. `source=nhis`는 미연결 상태를 유지하며 합성 기록으로 자동 대체하지 않는다.
- 초기 치료이력 준비·판독문 미준비, 제주 진찰 시행 전·의뢰서 누락의 기존 의미를 유지한다. 예제에 판독문이 존재하는 것과 현재 대화에서 준비에 반영된 상태를 구분한다. 명시적 자료 미보유 정정은 기존 REMOVE_DOCUMENT를 사용한다.
- 기존 문서의 고정 합성 source/content 값과 DB 스키마를 유지한다. 서버·화면·모델은 같은 예제의 작성일·리소스 ID·합성 표시를 읽는다. 외부 FHIR 업로드, 임의 환자 선택, 새 원문 저장은 추가하지 않는다.
- 고정 합성 체온·과거 복약 항목은 사용자가 요청한 더미데이터다. 실제 측정·현재 복용·처방·용량·정상 여부·치료 판단을 추론하는 근거가 아니다. 모델이 새 수치나 약물을 만들어 보충하지 않는다.
- 건강기록 창에서 예제 출처·작성일·보유 상태·읽기 전용 원본을 확인한다. 창 열기·원본 펼치기는 모델·기록 API·인증·예약을 실행하지 않는다. 실제 건강정보 고속도로는 미연결, 최근 실제 불러오기는 없음으로 표시한다.
- FHIR R4 형식 예제이며 건강정보 고속도로/KR Core 프로파일 인증을 주장하지 않는다. 기준 원문은 HL7 R4 [Bundle](https://hl7.org/fhir/R4/bundle.html), [DiagnosticReport](https://hl7.org/fhir/R4/diagnosticreport.html), [MedicationStatement](https://hl7.org/fhir/R4/medicationstatement.html). 2026-11-08 VPS에서 Ego Lite를 건너뛰고 insane-search로 본문 확인했다.

검증: 실제 keyless preview에서 Bundle→문서 상태→화면/도구 결과의 연결, 미보유 정정, NHIS 미연결, 다른 준비 대상에 고정 기록을 붙이지 않는 경계, PC·모바일 기록 창을 확인한다. 추가 유료 모델 호출·개인 건강정보 조회·실제 전화는 수행하지 않는다.

작업은 `feature/fhir-demo-records` 전용 worktree에서 진행한다. 소유 범위는 고정 FHIR 데이터·공통 투영, 기존 문서/Agent/기록 화면 연결 지점과 직접 검증·문서다. 상용 기록 어댑터와 전체 화면 리디자인은 포함하지 않는다.

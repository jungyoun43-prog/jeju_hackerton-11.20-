# 전화·협진·휠체어 이동 준비 계약

2026-10-31. 사용자는 UI 평가에서 드러난 문제를 고치고, 전화 대행 시 환자 위임·최소정보·AI 고지·기록 처리 안내와 기관의 확인 결과를 구분하도록 요청했다. 이후 전화로 제주·기존 도외 병원의 협진 준비와 휠체어 이동 문의도 이어 달라고 했다. **사용자는 전화 서비스 계정이 없으므로 준비 흐름·시연부터 완성하는 범위를 선택했다.** 이 문서는 제품 요구사항이며 개별 서비스의 법적 적합성 판정이 아니다.

## 공유 모듈

`app/call-policy.js`는 Node·브라우저에서 함께 쓰는 순수 모듈이다. 파일·환경변수·개인 기록·외부 API를 읽지 않는다.

```js
export const CALL_TARGETS = ['mainland', 'jeju', 'taxi', 'companion'];
export function buildCallPlan(state, target) {
  return {
    version: 1,
    target, // 위 enum
    recipient: {
      name: '', role: '', phone: null, source: '', sourceUrl: null,
      contactVerified: false, // 실제 상대·연결 확인 아님
      serviceType: '', // hospital | call_taxi | accessible_transport | care_contact | hospital_escort
    },
    purpose: '',
    questions: [], // string[]
    minimumDisclosure: [], // {field, label, value:string}[]
    excludedInformation: [], // string[]
    openingScript: '', // 위임·기록처리 확인 후 사용할 예정 문구
    recordHandling: {
      recording: 'not_configured', transcription: 'not_configured',
      retention: 'not_configured', overseasTransfer: 'not_verified', notice: '',
    },
    preCallChecks: [], // {id,label,status:'missing'|'unverified'|'simulation',detail}[]
    simulation: {inquiryDelegated: false, status: '', label: '', detail: ''},
    nextActions: [], // string[]
    requestDraft: '', // UI 입력창에서 확인한 뒤 보내는 요청 초안
    realDelegationVerified: false, realAdapterConfigured: false,
    actualCallPlaced: false, reservationConfirmed: false,
    clinicalAcceptanceConfirmed: false,
  };
}
```

기관명·공개 문의번호·출처는 현재 검증된 상태만 사용한다. 병원 표본에 없는 대표번호를 만들지 않는다. 질문은 행정 접수·자료·일정·지원 조건으로 제한하며 의료적 수용·진단·검사/치료 필요성은 판단하지 않는다. 성인 자녀의 요청이나 기존 `permissions.inquiry`를 실환자 본인의 권한 검증으로 해석하지 않는다.

최소 전달값은 현재 날짜·행정지역·지정 기관·시각·휠체어/동행 필요뿐이다. 환자 실명·나이·진단·검사 본문·주민번호·실제 환자 연락처·상세 주소를 자동 포함하지 않는다. 민감정보 처리와 제3자 제공·국외 이전의 근거는 별도 확인 대상이다. 실발신 시 발신번호·대상·위임 범위·전달 항목·AI 고지·녹음/전사/보관/전송 정책이 확인돼야 하며, 미설정 내용을 이미 수행하는 것처럼 말하지 않는다.

## 협진과 이동

- 기존 도외 병원: 협진·회송 창구, 의료진 명의 의뢰 필요 여부, 접수 자료와 전달 방법을 문의한다.
- 제주 병원: 현지 진찰/검사 접수 절차와 도외 병원에 자료를 전달할 창구·참여 조건을 문의한다.
- 실제 진찰 소견·의뢰서 작성과 환자별 적합성·진료 수락은 의료진/기관이 담당한다. 합성 접수 안내의 `confirmed`를 예약·진료 수락으로 표시하지 않는다.
- 휠체어 이동: 교통약자센터 등 현재 조건에 맞는 문의처에서 이용자격·회원등록, 휠체어 탑승 방식/승하차 지원, 동행인 탑승, 희망 시각·수령 장소·차량 가능 여부를 확인한다. 나이·병명만으로 자격을 인정하거나 탑승·배차를 확정하지 않는다.
- 병원 동행: 담당 지역·시간·역할·비용·휠체어 지원 범위를 확인한다. 등록된 돌봄 문의처를 실제 병원동행 배정으로 표시하지 않는다.

현재 어댑터는 simulation만 허용한다. 실제 발신 어댑터를 거부하는 기존 guard를 유지하고, 11개 Agent 도구·preview15개 event 경계를 보존한다. 전화 도구가 공통 plan을 adapter에 전달하고 결과 data.callPlan으로 노출한다. get_case의 callPlans는 대상/기관/현재 상태/추가 확인만 담는 작은 요약으로 제한한다. 전체 계획은 UI와 전화 도구에서 필요할 때 계산한다. 새 동의나 계획을 DB 상태에 추가하지 않는다.

## UI

- 예시와 전화 계획의 ‘문의 준비’는 보이는 문구를 입력 초안으로만 채운다. 숨은 날짜/시각·자동 POST가 없어야 한다.
- ‘전화·협진 준비’ native dialog에서 4대상별 목적·수신처·질문·최소 전달·제외 항목·예정 시작문·기록 처리 미설정·확인 필요와 합성 결과를 읽는다. 고지용 계획과 실제 발신 성공을 구분한다.
- 일반 요청/preview 대기에는 중지 경로를 제공한다. 클라이언트 대기 중지와 서버/실제 발신 중단은 다르며, 완료하지 않은 중단을 확정 표시하지 않는다. 원문·원래 requestId/본문·설정 재시도 경계를 보존한다.
- 짧은 높이에서도 대화·입력·보내기·개인정보 고지에 접근할 수 있어야 한다. 중요한 안내와 상태를 읽기 쉽게 하고 기존 제주 배경·단일 floating 방문 요약·읽기 전용 환자 기록 창을 유지한다.

## 소유권

- call-protocol / feature/call-protocol: 공유 call-policy.js, agent/tools.mjs, caregiver-system prompt, call-policy/agent 단위 검사. domain.js의 기존 합성 통화 문구도 소유 범위에 추가해 실제 위임·기록 처리 완료처럼 읽히지 않게 정정한다.
- ui-hardening / fix/caregiver-ui-hardening: conversation.js/css, DESIGN.md, design.json.
- ui-call-qa / test/ui-call-hardening: conversation-browser-check.mjs의 기존 회귀와 초안·짧은 높이·중지/race·전화 계획 접근·휠체어 문의 검증.
- root: 문서·공식 자료 조사·하네스·통합 검증·배포. 사용자 응답 없이 실제 전화 서비스 계정·발신번호를 생성하거나 기관에 발신하지 않는다.

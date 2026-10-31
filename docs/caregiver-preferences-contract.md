# 보호자 기본 설정·왼쪽 작업 패널 계약

2026-10-31. 사용자는 실제 보호자 관점 평가에 이어 왼쪽에 선호 택시 등의 최소 설정과 더 뚜렷한 디자인·이미지를 요청했다. 설정 입력은 선택이며 대화로 일을 맡기는 기본 흐름을 유지한다.

## 공통 DTO

POST /api/agent 요청에 선택적인 preferences와 applyPreferences를 추가한다. 기존 클라이언트는 수정 없이 동작한다.

```js
{
 message,requestId,sessionId?,history?,
 preferences?:{taxiProviderId:'auto'|공개택시providerId,wheelchair:boolean,companionNeeded:boolean},
 applyPreferences?:boolean
}
```

app/care-preferences.js는 서버와 화면이 함께 쓰는 순수 JS다. backend 담당자가 소유한다.

- DEFAULT_CARE_PREFERENCES: {taxiProviderId:'auto',wheelchair:false,companionNeeded:true}
- normalizeCarePreferences(value,{strict=false}={}): 알려진 키·공개 택시 ID·boolean만 허용. strict:true는 잘못된 값 거부, UI 저장값 오류는 기본값으로 복구. 자유 텍스트·인증·환자정보를 받지 않는다.
- getTaxiPreferenceOptions(area): [{value:'auto',label:'지역에 맞게 찾기'}, ...현재 지역에 맞는 실제 공개 taxi 후보]. source/provider의 원래 ID를 보존한다.

UI는 이 기기의 설정만 localStorage에 보관하고, 일반 요청에 preferences를 전송한다. 첫 요청 또는 설정 변경 뒤 applyPreferences:true를 보내며 성공한 요청의 설정 스냅샷이 현재 설정과 같을 때만 false로 전환한다. 요청 중 변경된 설정은 다음 요청에 남긴다. 설정 변경 자체로 유료 API를 호출하지 않고 ‘다음 요청부터 반영’이라고 표시한다. 실패 재시도는 같은 본문·ID를 보존한다. 고정 preview에는 설정을 적용했다고 표시하지 않는다.

서버는 preferences를 독립 검증한다. applyPreferences는 현재 방문의 wheelchair·companionNeeded 기본값을 다시 반영하는 플래그이며 taxiProviderId를 켜고 끄는 플래그가 아니다. true 또는 새 세션에서는 기존 도메인 reducer로 두 boolean을 반영한다. 이번 메시지의 명시적인 요청은 기본 설정보다 우선하며 모델이 update_visit으로 수정할 수 있다. 문의 초안의 providerId가 명시되지 않으면 매 요청의 검증한 선호 택시를 우선 사용하되, 현재 지역·휠체어 조건에서 후보가 아니면 선택하지 않고 이유를 알린다. 등록·선호가 실제 배차·자격·예약을 뜻하지 않는다. preferences는 문의 허용·건강정보 공유 동의가 아니다.

선호 설정만 저장하며 대화·원문·실환자 기록·키를 브라우저 저장소에 넣지 않는다. 기존 문의가 조건 변경으로 무효화되면 같은 도메인 재확인 경계를 따른다. 초기화는 초안/대화가 있을 때 소실을 보호하고 음성은 인식 후 수정한 뒤 보내게 한다.

## 작업 소유권

- caregiver-sidebar / feature/caregiver-sidebar / base5ae1c48: app/conversation.js·css·index.html, app/message-format.js, DESIGN.md, .impeccable/design.json, tests/message-format.test.mjs
- caregiver-preferences-agent / feature/caregiver-preferences-agent / base5ae1c48: app/care-preferences.js, agent/service.mjs·tools.mjs·validation.mjs·openai-provider.mjs, prompts/caregiver-system.mjs, tests/agent.test.mjs·agent-config.test.mjs·openai-provider.test.mjs·care-preferences.test.mjs
- root: 새 생성 이미지와 manifest·데이터/사용 설명·패키지·브라우저 QA·통합·AWS/CI·하네스 기록

UI에는 로고·새 준비/설정·기본 이동 조건을 담은 왼쪽 영역과 실제 이미지가 있다. 모바일은 설정 서랍으로 바꾸고 대화 입력을 가리지 않는다. 이미지 예정 경로는 /assets/care-journey-v3.webp다. root가 생성·저장한다. 의사 사진·큰 자연 배너·허위 실기관 통화 이미지는 쓰지 않는다.

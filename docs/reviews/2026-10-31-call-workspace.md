# 전화·협진 준비 최종 독립 검토

2026-10-31 · 읽기 전용 검토 · 판정: **ship — 승인된 준비·합성 시연 범위**. 현재 소스와 아래 증거에서 마감을 막는 구체 blocker는 발견하지 못했다.

현재 root HEAD `9ce664f`의 통합 소스(`034cdb6`, `b3111b3`, `6e3076a` 포함), 미커밋 상태의 README·PRODUCT·전화 계약을 직접 읽었다. `app/`, `agent/`, `prompts/`, 서버·패키지 파일을 대상으로 직접 재계산한 runtimeFingerprint는 `bc2a045449a35240a4743661d452868a7da22ec0b06f282a1613927153fababf`이며 두 proof의 sourceHash와 같다. **해시 범위 정정:** `app/assets`의 이미지와 manifest도 이 fingerprint에 포함된다. 저장소 문서·브라우저 검사 스크립트·`.impeccable` 캡처는 대상에 포함되지 않는다.

- **기존 P1과 읽기 접근:** 예시의 보이는 문구와 `data-example`이 일치하고 `fillRequestDraft`는 초안만 채운다. 기존 초안 교체 취소도 보존한다. 390×500·360×500의 최초 화면/12줄 입력/긴 답변/CSS 계산 글자 크기 2배에 대해 proof의 모든 대상은 `reachable:true`, `hiddenScroll:false`, `selfClipped:false`다. 첫 fold 아래 배치와 실제 잘림을 구분했다. PC·모바일 최초 화면, text-200 전체 캡처와 새 `call-short-390-viewport.png`를 직접 열어 입력 마지막 줄·보내기·시연/개인정보 안내가 이어지는 것을 확인했다.
- **대기 중지와 복구:** 일반 요청·preview 모두 AbortController와 현재 요청/대화 버전 검사를 사용한다. 이전 성공·오류·finally는 새 요청 상태를 바꾸지 않는다. 원래 본문·requestId·세션·설정 snapshot을 재시도에 유지하고, 첫 응답 전 재시도의 추가 처리 가능성을 알린다. 중지 안내는 화면 대기 종료와 서버/실제 발신 중단을 구분한다. proof의 normal/preview 취소·늦은 성공/실패 검사는 fetch fixture 범위다.
- **전화 정책의 공통 경계:** `docs/call-workflow-contract.md` → `app/call-policy.js` → Agent 도구·Prompt·UI가 같은 계획을 쓴다. 4대상의 목적·수신처·최소 전달·제외 항목·AI 고지 예정문·위임 미검증·녹음/전사/보관 미설정·기관 응대 수락 확인이 구분된다. 실제 위임·어댑터·발신·예약·진료 수락의 5개 flag는 false이며 실제 발신 어댑터 거부 guard가 유지된다. 기존 도외/제주 병원의 행정 접수·의뢰/회송·자료 전달 질문과 휠체어 자격·회원등록·탑승/승하차·동행인·시각·차량 질문을 확인했다.
- **렌더와 회귀 증거:** 지정된 initial desktop/mobile, short text-200, contact-plan 1440/390의 5개 캡처와 추가 call overview 1440/390·wheelchair 390·short viewport의 4개 캡처를 직접 열었다. native dialog의 고정 제목/닫기와 스크롤 본문, 합성 결과·실제 전화 미연결·초안 버튼의 직접 보내기 안내를 확인했다. `orchestration/runs/conversation-browser.json`은 171/171, 개발용 `/workspace.html`의 `browser.json`은 47/47이며 둘 모두 errors=[]다. 검사는 재실행하지 않았다.

미검증 범위: 실제 스마트폰 키보드·브라우저 자체 글자 확대, 실제 마이크, 신규 복합 요청의 유료 모델 품질, 환자 위임·실기관 응대·발신/녹음/전사·예약/배차, 임상·법적 적합성, 배포 후 공개 revision. 추가 캡처의 상태는 backend 합성 도구와 브라우저 응답 fixture이며 실제 모델/전화 실행 증거가 아니다. Impeccable 지침과 직접 렌더 대조를 적용했지만 CLI/detector는 실행하지 않아 자동 통과를 주장하지 않는다. 키·`.env`·외부 네트워크를 열지 않았고 저장소 소스를 수정하지 않았다.

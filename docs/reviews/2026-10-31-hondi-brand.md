# 혼디 로고 적용 독립 검토

2026-10-31 · 읽기 전용. **브랜드+전화 준비 baseline 판정: ship, blocker 0건.** 이후 추가할 진료여정 기능의 검증으로 확대하지 않는다.

현재 미커밋 통합 소스를 읽고 최종 runtimeFingerprint를 직접 재계산했다: `cfbcb480893bdab26debe0281d2c9453ce5131b1632185b7d74913b1f96e3cc4`. 이 값은 `app/assets` 이미지·manifest를 포함하며 문서·브라우저 검사 스크립트·`.impeccable` 캡처는 포함하지 않는다. 이전 `/tmp/jeju-call-finish-review.md`의 이미지 제외 문장은 같은 기준으로 정정했다.

- **원본·내보내기:** `hondi-logo-source-v1.png`(1774×887), lockup(480×168), mark(128×128)를 직접 열었다. 귤 심볼과 소문자 `hondi`를 보존하며 한글 워드마크·다른 심볼이 섞이지 않는다. 원본 SHA256 `9664959a…efe21`, lockup `cadbc2e5…3b4d2`는 manifest 값과 실제 파일이 일치한다. PNG를 읽기 전용으로 해독한 alpha>16 범위도 원본 `[107,199,1696,707]`, 심볼 `[107,199,666,707]`로 manifest crop 좌표와 정확히 같다. 세 파일 모두 native alpha와 투명한 네 모서리를 확인했다.
- **출처 기록:** manifest에 지정 sourceAgentId `25dd8a21-7bd0-4eae-b573-e255a9c21a82`, 최종/부모 generation ID, 최종 정확 프롬프트와 부모 프롬프트, 모델 ID 미공개 범위, 원본 파일·해시, canvas 여백 정리·심볼 분리·축소와 export 크기가 있다. 신규 생성 없이 승인된 출력을 재사용했다는 README·THIRD_PARTY·DESIGN·editorial 계약 설명이 일치한다. 과거 대화 원문은 이 검토에서 직접 재조회하지 않았다.
- **제품 이름·고지:** 첫 화면/개발 workspace 제목·헤더·Agent 이름·도우미·보고서, System Prompt, 공통 AI 전화 예정 시작문이 ‘혼디’로 일치한다. AI 고지는 ‘혼디의 AI 전화 도우미’임을 밝히되 예정 문구로 유지하며 실제 위임·발신·예약·진료 수락의 false, 기록 처리 미설정과 기관 AI 응대 수락 확인 경계가 유지된다. 이전 로고는 자산 이력에 남고 현재 진입 화면에서 참조하지 않는다.
- **가독성과 접근 이름:** 최종 `conversation-initial-desktop.png`·`conversation-initial-mobile.png`와 개발 workspace `desktop.png`·`mobile.png`를 직접 열었다. 대화 첫 화면 PC132px·모바일120px lockup은 충분한 여백 안에서 `hondi`가 읽히고 설정 버튼·사례 제목과 겹치지 않는다. 로고 img alt는 비우고 링크의 ‘혼디 홈’/‘혼디, 진료 준비로’/‘혼디’가 이름을 제공한다. Agent 심볼도 alt가 비어 옆 ‘혼디’를 중복해서 읽지 않는다. favicon은 동일 심볼 mark다. 초기 검토에서 발견한 개발 workspace 중간 폭의 작은 lockup도 <=1199에서는134px lockup, <=980에서는picture의 동일 mark로 보완됐음을 소스에서 확인했다.
- **최종 회귀 증거:** `orchestration/runs/conversation-browser.json`(15:28:16Z)은171/171, `browser.json`은47/47이며 둘 모두 errors=[]·sourceHash가 위 최종 fingerprint와 일치한다. 일반/preview 취소·race·초안·짧은 화면·4대상 전화 계획의 fixtureCoverage도 유지된다. 추가 call-overview PC/mobile·wheelchair390·short390 viewport 캡처를 직접 열어 합성/실전화 미연결·위임 미검증·휠체어 질문·12줄 입력/보내기/고지 접근이 유지됨을 확인했다. 실제 모델·전화 호출 검사가 아니다.

범위 한계: 개발 workspace 중간 폭의 직접 렌더, 실기기 화면낭독기·키보드, 상표 중복/등록, 실제 위임·실전화·의학/법률 적합성, push/배포 후 공개 revision은 이 검토 대상이 아니다. Impeccable 지침과 직접 렌더 대조를 적용했으며 CLI/detector 자동 통과를 주장하지 않는다. 이 검토는 테스트·유료 모델·전화·외부 네트워크·키/환경 조회를 실행하거나 저장소·워크트리를 수정하지 않았다.

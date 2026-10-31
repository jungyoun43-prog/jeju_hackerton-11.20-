# 의료·가족돌봄 서비스 참고에 따른 화면 개선

2026-10-31. 사용자가 기존 디자인의 빈약함을 지적하며 왼쪽의 선호 택시 등 최소 설정·이미지를 요청했고, 이어 실제 의료 웹사이트들을 먼저 둘러보고 REA를 설치해 활용하도록 지정했다. 본 문서는 실제 공개 화면 관찰과 우리 서비스의 설계 선택을 구분한다. 브랜드 로고·사진·문구를 복제하지 않는다.

## 실제 확인한 참고

| 서비스·공식 URL | 관측 범위 | 반영할 구조 |
| --- | --- | --- |
| 굿닥 https://www.goodoc.co.kr/ | PC268px 탐색과 모바일 메뉴를 실제 조작. 공개 서비스 셸 | 왼쪽의 지속적인 위치·설정, 작은 화면의 접근 가능한 설정 서랍 |
| 똑닥 https://ddocdoc.com/ | 홈페이지·검색 페이지와 공개 앱 시연. 로그인 가족관리는 미실행 | 가족과 준비 대상의 맥락을 먼저 알림. 가상 사례와 내 기록을 구분 |
| 닥터나우 https://doctornow.co.kr/telemedicine/doctors | 공개 진료 목록의 왼쪽 탐색·얇은 정보 행 | 상태·사실·다음 행동을 간결한 행으로 표시. 관측된 모바일 가로 넘침은 따르지 않음 |
| Wellthy https://wellthy.com/care-concierge | 공개 소개·메시지/Care Circle 제품 이미지 | 맡긴 업무·현재 상태·다음 연락을 연결. 보호자 대신 진행하는 일을 구체적으로 설명 |
| Birdie https://www.birdie.care/care-management | 공개 DEMO 제품 스크린샷·역할별 인터페이스 소개 | 대상자별 왼쪽 맥락과 정렬된 상세. 기관 운영 메뉴를 보호자 화면에 전부 옮기지 않음 |
| Maven https://www.mavenclinic.com/ | PC·모바일 공개 홈페이지. 로그인 내부는 미확인 | 가족의 일상 사진과 선명한 행동 위계. 작업 화면에는 작은 환영 영역으로 적용 |

원문 수집에는 insane-search의 공식 API/engine 경로, 시각 검토에는 독립 Playwright 컨텍스트를 사용했다. One Medical과 Zocdoc 원문도 수집했으나 이번 설계 근거의 여섯 시각 검토에 합산하지 않는다. 로그인·예약·기관 발신을 하지 않았다. 세부 원시 캡처는 개발환경 /tmp/jeju-medical-reference-{a,b}/에 있고 외부 사진·전체 화면을 제품 자산으로 재배포하지 않는다.

## REA 실제 사용

사용자 지정 https://github.com/morluto/rea 의 reverse-engineer-anything 스킬을 commit23de10bb2849cdce8ddbe70504aa7cc57de75a98에서 설치했다. CLI rea-agents6.8.0(MIT)와 필요한 Node22.23.4는 앱 저장소 밖의 별도 도구 디렉터리에 설치했다. 스킬 설치 자체와 MCP 연결은 다르며 이번 세션은 CLI를 사용했다.

capture-browser-scenario로 굿닥 공개 페이지의 이동·main 확인·DOM·접근성·스크린샷을 실제 확보했다. Evidence ev_c278e33e6620f54b143d99cd0840cb50a59443d8d43bc3e2b4557cbd227ed67c, confidence observed, steps completed, completeness complete, browser.cleanup terminated-owned-process. CLI 종료코드는143이었으므로 이를 무조건 정상 프로세스 종료로 포장하지 않는다. One Medical의 별도 launch는20초 시작 제한으로 provider_timeout·cleanup_incomplete를 반환해 성공 관찰로 인용하지 않는다. 이 실패를 해당 웹사이트 자체의 장애라고 해석하지 않는다.

REA 관측과 독립 브라우저의 시각 판단은 구분한다. 공개 페이지에서 못 본 회원/가족 설정을 구현돼 있다고 주장하지 않으며, 선호 택시 기능은 사용자 요구에 따른 자체 설계다.

## 구현 방향

- PC 왼쪽230~244px: 로고·준비 대상의 체험 맥락·실제 동작하는 준비/설정 이동, 선호 택시·휠체어 차량·동행 필요 여부. 설정은 선택이고 다음 자연어 요청에 반영된다.
- 가운데: 짧은 환영 문장, 입력 바로 위 요청 예시, 명확한 입력과 처리 결과·필요한 다음 행동. 후속 사용자 요구에 따라 가족 사진과 caption은 제거한다.
- 오른쪽: 이번 방문의 날짜·기관·병원/자료/이동/동행 상태를 얇은 구분선과 행으로 정리한다. 후속 요청에 따라 전체 요약을 한 개의 흰 floating 패널로 묶고 PC에서는 sticky, 모바일은 대화 아래에서 펼친다. 새 답변은 처음부터 읽히고 내부 도구 기록은 접어 둔다.
- 모바일: 왼쪽은44px 이상 버튼으로 여는 서랍. 키보드·Escape·포커스 이동과 복귀를 제공한다. 입력 가까이에 가상 사례·실제 연락/예약 없음이 유지된다.
- 설정은 preferences/applyPreferences 공통 계약을 따른다. 기기의 공개 문의처ID와 boolean만 저장하며 대화·실환자정보·키를 localStorage에 넣지 않는다. 임의 비용·예약 확정 상태를 추가하지 않는다.
- 실제 모델 답변의 heading/list/strong을 안전하게 표시한다. HTML은 실행하지 않고 외부 링크는 검증한다. LOOP_LIMIT를 일일 quota로 표시하지 않는다.
- 색: 밝은 중성 표면과 현무암/짙은 녹색, 선명한 귤색 주요 행동. 충분한 여백 속에서 제목·현재 작업·설정의 대비를 분명히 한다. 한국어 본문은 자가 호스팅 Pretendard, 제목의 MaruBuri와 기존 PNG 로고는 유지한다.
- 배경은 GPT Image로 독자 생성한 제주 바다·현무암 장면이다. 인물은 없으며 대화·입력·방문 패널의 글자는 흰 표면 위에 둔다. 사진의 의미를 실제 환자·기관·진료 기능의 증거로 쓰지 않는다. 이전 인물 사진의 원본과 정확 prompt는 변경 이력으로 보존한다.
- 환자 정보·건강 기록은 사용자가 추가 요청한 별도 읽기 창이다. 같은 caseState의 기록·출처를 확인하고, 건강정보 고속도로는 실제 미연결과 최근 수신 없음으로 표시한다. 특정 플랫폼에서 가져온 실제 개인 기록을 본 것처럼 만들지 않는다.

구체 API·저장 범위는 caregiver-preferences-contract.md, 실제 구현·화면·모델·배포 검증은 implementation-results.md와 하네스 증거에 기록한다.

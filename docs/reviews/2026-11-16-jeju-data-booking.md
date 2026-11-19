# 제주 데이터의 예약 준비 화면 연결 검증

기준일: 2026-11-16 KST. [계약](../jeju-data-booking-contract.md)과 [공식 출처 확인](../../research/jeju-data-booking-2026-11-16.md)을 따른다. 기존 공개 snapshot의 활용을 화면에 확장했으며 새로운 실시간 원자료/API를 확보한 것은 아니다.

## 변경

- 제주 기본 진입을 등록 병원 탐색으로 변경: 공개 20행에서 폐업7행을 제외한 13개 기관의 주소·등록 과목을 필터에 사용한다. 실기관을 고른 뒤 월간 희망 날짜/기간·시간대를 정리한다. 실제 의료진·빈자리·확정 회신을 붙이지 않는다.
- 제주·서울 양쪽 이동 화면에 지역·휠체어 조건별 문의처 선택을 추가했다. 택시34·돌봄19·제주시 보건35의 기존 정제 자료와 별도 공식 안내2건을 사용한다. 차량·돌봄·보건을 각각 선택하고 ID·연락처·일치 근거·원출처·자료 기준일을 준비표에 남긴다.
- 가상 의료진·시간표 체험은 명시적 별도 모드로 보존했다. 두 모드의 선택은 유지하며 이동 체크를 재확인한다. 공개 문의의 이동 시각 대조가 가상 진료 시각을 가져오지 않게 했다. 공개 희망 일정과 이동 시각 입력의 최대 월도 일치시켰다.
- 지역 변경은 이전 문의처 선택을 해제하되 휠체어 조회 조건은 유지한다. 사례의 주소·지원 필요·동의·실제 상태는 변경하지 않는다.
- 공개자료 재색인 검사에서 LF와 CRLF만 다른 파일을 내용 불일치로 처리하던 문제를 수정했다. 생성 JSON의 구조와 줄바꿈 정규화 후 전체 내용이 동일함을 먼저 확인했고, 원자료·카탈로그 내용은 변경하지 않았다.
- README의 앞선 지역 화면 수정 중 잘려 있던 후속 절을 사전 캡처와 변경하지 않은 Git 본문으로 복구했다. 원래 실행·API·자료·검증 설명을 보존한 상태에서 새 흐름과 매뉴얼·데이터 명세·제출 추적표를 갱신했다.

## 실행 결과

최종 runtime SHA-256: `21c90bd2807b27776f391cbc92956606a8a8068848d94214ebdb30e191ec2d6f`. `dist/deployment.json`과 네 브라우저 보고서가 이 지문을 사용한다.

| 검사 | 결과 |
| --- | --- |
| Next 정적 production build | 통과 |
| 제주 데이터·병원·지원·보건·Agent 도구·예약 관련 단위 검사 11파일 | 98/98 |
| 제주 공개자료 브라우저 검사 | 91/91 |
| 제주·서울 시작/이어보기/가상 예약 회귀 | 95/95 |
| 기존 서울 예약·의뢰서·날짜·항공·차량 회귀 | 190/190 |
| 기존 대화·복구·초안·자료·접근성 회귀 | 250/250 |

브라우저 합계626개 조건. 제주/지역/예약 시나리오는 외부 실행·모델 POST 0, 실행 오류0이다. 대화 검사는 기존 keyless·합성 preview 경계 안에서 실행했다. 전체 저장소 단위 suite를 통과했다고 주장하지 않는다.

제주·지역 화면은 1440×900, 390×844, 900×600, 320×500에서 넘침·초점·진입·후속 동작을 검사했다. 단일/기간 선택, 준비표 저장, 지역/휠체어 변경, 자료 범위 밖 빈 결과, 서울과 독립 초안 보존을 포함한다. PC 목록과 모바일 달력·문의 화면 원본 캡처를 직접 확인했다. 작은/낮은 창은 작업 영역 안에서 스크롤하며 실기기 검증은 아니다.

Ego Lite에서 실제 공개 페이지 본문을 확인하고, 로컬의 제주우리병원 → 11월25일 희망 → 애월콜 선택 → Markdown 준비표 다운로드를 실행했다. 파일에 실기관·문의처·기준일·원출처·예약 미확정이 남는 것을 확인했다. 마지막 지역 선택 화면은 이어보기 상태로 사용자에게 남겼다. Ego의 네이티브 캡처와 자동 검사의 지정 viewport 캡처는 구분한다.

## 재현과 증거

관련 단위 검사: `node --test tests/jeju-appointment-data.test.mjs tests/appointment-regions.test.mjs tests/appointment-demo.test.mjs tests/appointment-date-first.test.mjs tests/appointment-travel.test.mjs tests/hospitals.test.mjs tests/support-data.test.mjs tests/public-health-data.test.mjs tests/public-data-tools.test.mjs tests/public-data-skill.test.mjs tests/public-data-agent.test.mjs`.

`npm run build` 후 로컬 서버를 실행하고 `BASE_URL`을 지정한다. 브라우저 검사는 별도 Playwright/Chromium이 필요하며 `PLAYWRIGHT_MODULE`, `CHROMIUM_PATH`를 사용할 수 있다. `node scripts/jeju-data-browser-check.mjs`, `node scripts/appointment-regions-browser-check.mjs`, `node scripts/appointment-browser-check.mjs`, `node scripts/conversation-browser-check.mjs`를 실행한다.

실행 증거는 `output/jeju-data-qa/verification.json`, `unit-tests.txt`, `browser-report.json`, `ego-saved-public-plan.md`, 화면 PNG와 공식 본문 TXT다. 기존 회귀 보고서는 `output/region-booking-qa/report.json`, `output/appointment-react-qa/summary.json`, `orchestration/runs/conversation-browser.json`이다. 초기 검사 중 오타가 있던 selector·잘못된 서버 기본 포트와 소스 수정 시점의 지문 차이는 수정/환경 지정 후 최종 동일 지문으로 재실행했다.

실시간 빈자리·의료진·기관 운영·배차·동행 제공 여부·실제 발신/결제·본인인증/위임·임상 적합성·실시간 교통/항공·모델 품질·AWS 공개 배포·대회 제출·심사 점수는 이 결과의 범위 밖이다. 병원2024·돌봄2020 자료의 오래된 시점과 제주시 보건자료의 지역 범위를 유지한다.

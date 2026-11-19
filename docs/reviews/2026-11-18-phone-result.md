# 결과창·AI 발신 코드 검증 · 2026-11-18

사용자는 조율 완료 뒤 독립된 결과창, 더 크고 느린 전환, 피클처럼 AI가 먼저 전화를 걸고 상대와 대화하는 기능을 요청했다. 실제 전화는 하지 않는 범위다. Impeccable의 animate·clarify·distill과 animate의 모달 동작 지침을 참고했다. 사용자가 원한 느린 전환을 적용하되 키보드·움직임 줄이기·빠른 재조작을 보존했다.

## 변경

- 마지막 유효 회신 뒤 shadcn/Radix 결과창 자동 열기, 제목 초점·탭 가두기·Escape·닫기 후 초점 복귀.
- 병원·가는 편 차량·동행의 완료/사람 인계 구분, 큰 감귤 표시, 일정과 출발 전 준비, 결과표 저장. 저장 버튼은 초록색 주 행동이다.
- 지역·입력 방식은 1.15초, 일반 단계는 0.85초 작업면 전환. 결과창 0.85초, 감귤 도착 1.2초. 사용자 행동은 즉시 실행하고 효과만 이어진다.
- 별도 운영자용 Twilio outbound + OpenAI Realtime 코드와 기본 dry-run CLI. 화면의 가상 회신을 실발신으로 바꾸지 않았다. 외부 통화가 끝났다는 사실만으로 예약 완료를 만들지 않는다.

## 범위

Ego lite 작업 공간 4의 기존 제품 페이지에서 실제 입력→조건 확인→조율→결과창을 조작했다. 공식 문서도 같은 공간의 보조 페이지로 읽었다. Playwright는 키를 비운 별도 로컬 서버 4189에서 기능·뷰포트 fixture를 반복하는 보조 검사다. 노트북 1280×720, 큰 화면 1920×1080, 휴대폰 390×844·320×600을 확인한다. 320×600은 본문 스크롤을 허용하며 결과창의 닫기·저장 버튼은 남긴다.

Ego의 현재 실제 페이지는 CSS 2038×1043, 브라우저 zoom 1.25에서 확인했다. 뷰포트 에뮬레이션을 여러 실기기의 검증으로 확대하지 않는다. Ego 기본 screenshot의 캡처 영역이 CSS viewport보다 작게 나오는 경우 DOM 경계와 CDP 원본 캡처를 구분한다.

전화 테스트는 합성 전화번호·가짜 fetch/WebSocket·가짜 시계와 로컬 listener만 사용한다. Twilio/OpenAI 계정 연결·실제 통화·한국 발신 조건·실제 예약 성립·공개 TLS 프록시는 검증하지 않았다. 설정 boolean은 환자 동의 검증이나 법률 검토를 자동 수행하지 않는다. 통신사와 AI 공급자 비용을 실측한 금액 상한이라고 주장하지 않는다.

## 공식 자료

2026-11-18 Ego lite로 본문 확인:

- [피클 대행 도움말](https://pickle.com/help/tasks/delegate): 웹에서 처리할 수 없는 병원 접수 등의 대행 전화와 결과 알림 흐름. 비공개 API·엔진은 사용하지 않았다.
- [Twilio Calls](https://www.twilio.com/docs/voice/api/call-resource), [Media Streams](https://www.twilio.com/docs/voice/media-streams), [메시지 형식](https://www.twilio.com/docs/voice/media-streams/websocket-messages), [Stream TwiML](https://www.twilio.com/docs/voice/twiml/stream), [요청 검증](https://www.twilio.com/docs/usage/security).
- [OpenAI Realtime 대화](https://developers.openai.com/api/docs/guides/realtime-conversations), [Realtime API 타입](https://developers.openai.com/api/reference/resources/realtime/), [공식 Node SDK 오디오 형식](https://github.com/openai/openai-node/blob/master/src/resources/realtime/realtime.ts).

근거 본문과 캡처는 `output/phone-result-qa/`에 보존한다. 최종 검증 수치와 소스 지문은 아래에 기록한다.

## 최종 결과

- 관련 단위 검사 **105/105 통과**. 전화 어댑터 34개·운영자 CLI 3개를 포함한다. 로그: `output/phone-result-qa/unit-targeted.log`.
- 결과창·모션 브라우저 검사 **35/35 통과**. 네 크기에서 자동 열림·화면 내 행동·제목 초점·탭 가두기·닫기/다시 열기·결과 저장·실패 인계를 확인했다. 외부 예약/모델 POST 0, 브라우저 예외 0. `output/phone-result-qa/browser/report.json`.
- 기존 반응형·모션 회귀 **43/43 통과**. 1280~3840 너비와 좁은 화면, 빠른 재조작·키보드·탭 숨김·움직임 줄이기 확인. `output/fluid-motion-qa/report.json`.
- Next 정적 빌드 성공. 빌드·두 브라우저 fixture·Ego 페이지의 지문 일치: `261660645ccc1b182a75bc7f1616e22040eab0c0ea9de6f848f804399dcf9013`.
- Ego 원본 최종 캡처 `output/phone-result-qa/ego-result-final.png`를 직접 확인했다. CSS 2038×1043에서 결과창 하단 903px, 저장 버튼 배경 rgb(40,87,63), 제목 초점을 확인했다. 사용자가 볼 수 있도록 결과창을 열어 둔 제품 탭만 유지했다.
- 전체 `npm test`는 **601개 중 587 통과·14 실패**다. 이번 관련 검사와 별도로 Windows 환경의 `python3` 실행 부재, symlink 생성 EPERM, Unix `/dev/stdin`·shebang fixture에 걸린 패키징/배포 검사가 남았다. 실패를 건너뛰거나 운영체제 권한·파일 연결을 변경하지 않았다. `output/phone-result-qa/unit-final.log`.
- 검증 중 낡은 ‘문의 내용 확인/접수 확인’ 단계명 기대값을 최신 ‘요청 확인 → AI 예약·결과’로 갱신하고, 다음 버튼도 같은 단계명으로 맞췄다.

기본 dry-run 실행은 `prepared`, `actualCallPlaced:false`, `reservationConfirmed:false`였다. 전화 서비스 설정·실발신·실모델 음성·실제 예약·외부 배포는 수행하지 않았다. 새 어댑터 통합 커밋은 `fef9ae0`이며 UI와 나머지 로컬 수정은 작업 디렉터리에 유지했다.

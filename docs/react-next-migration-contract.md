# React · Next.js 전환 범위

2026-11-16. 사용자 요청에 따라 예약·의뢰서·월별 달력·항공/왕복 교통을 React와 shadcn/ui로 구현하고 기본 프런트엔드 진입을 Next.js로 전환한다. 기존 프레임워크 유지 규칙보다 이번 요청을 우선한다.

## 실제 전환

- `web/app` App Router, Next.js 16.4.6, React/React DOM 19.3.1. `output: export`로 정적 화면을 빌드한다.
- shadcn CLI 4.23.0의 `new-york` registry에서 Button, Badge, Alert, Input, Checkbox, Select, Calendar, Accordion 원본을 생성했다. Tailwind 4의 utilities/theme만 사용하고 전체 preflight는 기존 화면에 적용하지 않는다.
- `web/components/appointment-*`가 예약 화면·탐색·달력·교통 입력을 렌더링한다. 조건·시간표·교통 검증은 기존 순수 reducer 모듈에서 계산한다. Radix Select/Checkbox/Accordion과 React DayPicker의 키보드 동작을 사용한다.
- 디자인은 흰 작업면 `#fff`, 본문 `#21372a`, 초록 선택 `#315c43`, 민트 `#edf4ee`, 주황 주 행동 `#d5622b`, 경계 `#d7e1d9`와 기존 Pretendard·hondi 로고를 사용한다. 인물 이미지는 추가하지 않는다. 대기기간·일정 상태가 달력에서 먼저 읽히도록 구성한다.

## 보존한 경계

- 기존 대화·음성·진행·취소·이어하기 컨트롤러는 `app/conversation.js`의 `mount`로 연결한다. Next client effect에서 한 번 로드하고 중복 실행을 막는다. 대화의 DOM은 기존 컨트롤러가, 예약의 두 하위 root는 React가 소유한다. React가 소유한 하위 DOM을 `innerHTML`로 다시 쓰지 않는다.
- 기존 `app/index.html`의 직접 모듈 진입은 이전 화면 호환 경로다. 기본 `npm run dev/build/start/preview`는 Next 개발 또는 Next 정적 export를 사용한다. 전체 대화 화면의 JSX 재작성은 이번 전환에 포함하지 않는다.
- 기존 `/api/agent` handler, 모델·budget·lease·receipt·resume·DB 정책은 그대로다. Next route handler나 Server Action으로 중복 구현하지 않는다. 키 없는 브라우저·fixture 검사만 수행하며 유료 모델을 호출하지 않는다.
- 예약·교통은 탭 메모리에서만 유지한다. localStorage/sessionStorage에 새 건강·예약·이동 정보를 저장하지 않고 원래 caseState 문서를 생성하거나 예약 확정 값을 수정하지 않는다.

## 실행·빌드

- `npm ci --ignore-scripts` 후 `npm run dev`: `prepare-web`이 공개 자산만 생성하고 기존 Node 서버가 API를 처리한 뒤 Next 개발 handler에 UI 요청을 전달한다. 기본 포트 4173.
- `npm run build`: Next webpack 정적 export와 기존 공개 데이터·Leaflet 빌드를 합쳐 `dist`를 만든다. `npm run start` 또는 `npm run preview`가 같은 Node API와 함께 제공한다.
- `web/public`, `web/out`, `web/.next`는 생성물이다. 공개 자산 생성은 고정 경로·심볼릭 링크를 검사하고 `.env`를 제외한다. 제출 패키지는 `web` 소스와 최종 `dist`를 포함하고 생성 캐시/중복 public/out을 제외한다.
- API가 필요한 대화 체험은 단순 정적 호스팅만으로 동작하지 않는다. 현재 AWS API 분리를 유지하며 이 변경을 배포한 것으로 보고하지 않는다.
- runtime fingerprint에 `web`과 새 개발·빌드 스크립트를 포함한다. 화면·버전 검증은 `docs/reviews/2026-11-16-react-next-appointment.md`를 따른다.

## 공식 기술 참고

ego lite 원문 확인, 2026-11-15~16.

- https://react.dev/learn/add-react-to-an-existing-project — 기존 페이지 일부에 React를 도입하는 구조.
- https://nextjs.org/docs/app/guides/static-exports — 정적 export 지원과 서버 기능 제약. POST API를 export에 넣지 않는다.
- https://ui.shadcn.com/docs/installation/next — Next의 Tailwind/alias 설정과 CLI 컴포넌트 설치.

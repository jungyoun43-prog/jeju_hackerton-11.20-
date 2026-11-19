# 예약 현황과 일관된 장면 전환

확인일: 2026-11-18. 대상은 로컬 Next.js 정적 UI와 Node 서버이며 공개 AWS 배포는 변경하지 않았다.

## 바뀐 동선

- 조율 결과창 하단: **처음으로 돌아가기 / 내 예약 현황**. 결과표 저장은 상단 보조 행동으로 옮겼다.
- 상단 예약 현황: 제주·내륙의 현재 초안과 유효한 시연 회신을 함께 읽는다. 결과 재열기·다운로드·준비 이어가기를 제공한다.
- 홈 왕복은 초안을 보존한다. 새로고침은 기존처럼 탭 상태를 초기화한다. 새 저장소·예약 이력·외부 실행은 추가하지 않았다.
- 공개 병원 이름은 희망 대상으로, 가상 병원·차량·동행 창구의 회신은 시연 결과로 구별한다. 실제 예약 확정·기관 회신으로 승격하지 않는다.

## 움직임

Impeccable의 animate/craft-floor, Animate, Make Interfaces Feel Better의 애니메이션 원칙을 적용했다. Ego Lite로 [Carbon Motion](https://carbondesignsystem.com/guidelines/motion/overview/)의 원문에서 일관된 움직임·중요한 순간의 표현적 모션을 확인했다. 참고 자료는 외부 자산이나 코드를 복제하지 않고 전환의 역할을 정하는 데 사용했다.

- 선택 화면의 내용 높이만 가리던 색면을 없앴다. 실제 `.conversation-layout` 전체가 900ms 동안 기울었다 펴지고 감귤이 점선 곡선을 따라 넘어간다. 뒤로 가기는 반대 방향이다.
- 화면·초점·업무 상태는 즉시 갱신하고 장식만 이어진다. 부모 작업면의 실제 DOM을 움직이므로 전환 중 다음 버튼도 클릭할 수 있다.
- 한 번에 하나의 효과만 유지한다. 연속 선택·키보드 입력·창 크기 변경·탭 숨김·움직임 줄이기 변경 시 정리한다. 처음 화면을 열 때는 재생하지 않는다.
- [MDN startViewTransition](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition) 원문도 확인했다. 초기 시험에서 멈춰 둔 스냅샷 전환이 실제 요소의 클릭을 막는 현상을 재현하여 최종 구현에는 사용하지 않았다. 최종 화면은 기존 Web Animations API만 사용하며 새 의존성을 추가하지 않았다.

## 검증

최종 UI fingerprint: `081b236c0c3e68199543571e672bbbfcc3c0f296bdce79b64e97ade5c2417a78`.

- `npm run build`: 통과.
- 관련 상태·입력·단계·현황 단위 검사: **43/43** 통과. 마지막 UI 수정은 이 상태 모듈들을 바꾸지 않았다.
- `scripts/reservations-browser-check.mjs`: **56/56**, 브라우저 예외 0, POST 0. 1280×720, 1920×1080, 390×844, 320×600에서 완료창·홈 왕복·결과 보존·두 지역·재열기·저장을 확인했다. 전환 중 조작·연속 선택·키보드·움직임 줄이기·크기 변경도 검사했다.
- `scripts/care-result-motion-browser-check.mjs`: **35/35**, 브라우저 예외 0, POST 0. 제목 초점·탭 가두기·Escape·재열기·차량 인계·하단 행동의 화면 내 위치를 확인했다.
- `scripts/care-motion-browser-check.mjs`: **43/43**, 브라우저 예외 0, POST 0. 320px~3840px의 8개 창 크기에서 기존 지역·방식 선택 비율과 넘침, 새로운 작업면·감귤 효과를 확인했다. 위 세 브라우저 보고서는 같은 최종 fingerprint다.
- Ego Lite의 현재 실제 PC 창(CSS 2038×1043, 브라우저 배율 125%)에서 제주 선택→텍스트 요청→조율 완료→처음으로→예약 현황을 직접 사용했다. 완료 3행·제목 초점·효과 정리를 확인하고 현황 화면을 열어 두었다.

최종 캡처는 `output/reservations-qa/ego-scene-final.png`, `ego-result-final.png`, `ego-overview-final.png`와 `output/reservations-qa/browser/`에 있다. 모바일은 브라우저 viewport 검증이며 실제 휴대폰 검증은 아니다. 320×600 결과창은 본문 스크롤을 허용하고 하단 목적지 버튼은 계속 보인다. 모션의 선호도까지 검사 통과로 판정하지 않는다.

실제 전화·유료 모델·실예약·배차·결제는 수행하지 않았다. 기존 `.env`와 전화 운영자 어댑터는 변경하지 않았다.

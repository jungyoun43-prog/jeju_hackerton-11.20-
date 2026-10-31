# 모델·외부 서비스·오픈소스·자산 명세

확인일: 2026-10-31. 실제 사용과 선택·계획 상태를 구분한다.

| 항목 | 버전·조건 | 실제 사용 범위 |
| --- | --- | --- |
| Node.js | 개발 확인 v22.23.2. Node22 이상 | 로컬 정적 서버·빌드·하네스·검사. GPU 미사용 |
| Leaflet | 1.9.4 · BSD-2-Clause | 지도 UI. `package-lock.json` 고정. 빌드에 원 라이선스 포함 |
| OpenStreetMap | 지도 데이터 ODbL, 표준 타일 정책 별도 | 실제 지도 배경. 기본 타일은 외부 인터넷 의존. 출처 표시·Referer 유지·브라우저 캐시 준수. 대량 수집·오프라인 타일 ZIP 미제공 |
| Google Maps URLs | 공식 URL 링크, API key 불필요 | 사용자가 누르는 외부 지도/길찾기 링크. 소요시간·경로 계산 결과를 앱에서 조회한 것은 아님 |
| Google Maps Embed API | 향후 검토 대상 | 현재 미구현. 키 설정으로 활성화되는 기능이 아님. 현재는 OSM 지도와 Google Maps URLs만 제공 |
| GPT Image 계열 | ChatGPT 내장 Imagegen. 정확한 모델 ID는 도구에서 미공개 | 개발 중 제주 배너 생성. 환자 기록 분석에는 사용하지 않음. 프롬프트: `app/assets/manifest.json` |
| Codex | 이 세션에 제공된 코딩 에이전트 | 기획 정리·소스 작성·서브에이전트 병렬 개발·검사. 서비스 런타임 모델이 아님 |
| 서비스 런타임 LLM | 미선정·미연동 | 현재 상태 머신은 결정적 시뮬레이터. 실제 자율 모델이라고 제출하지 않음 |
| 전화·EMR·의료진 회신 | 미연동 | 합성 응답과 사용자 역할 입력으로 재현. 실제 발신·전송·예약 없음 |
| insane-search | 로컬 설치 도구 | 공개 원문·공식 개발 문서 조사. 출처·확인 범위 기록 |
| Impeccable | revision `b7a89176e4e87422b40f98adabceb051dbb5448b` · Apache-2.0 | 디자인 지침 참고. 자동 context는 실행 권한 오류로 미실행; 문서 직접 확인 |
| Awesome Design Skills / Refined | revision `f631a09b4fcc0166f2e2c1a8c81906ef680c57e8`, 스킬 표기 MIT | 토큰·간격·가독성·상태·접근성 기준 참고. 화면/템플릿 복사 아님 |
| Playwright | 이 개발 환경에서 1.64.1 확인 · Apache-2.0 | 브라우저 QA 도구. 서비스 실행 의존성에 포함하지 않음. 선택 설치 후 재현 가능 |

화면의 아이콘은 일관된 SVG로 작성한다. 기본 글꼴은 운영체제 글꼴이며 외부 폰트 호출은 없다. 합성 사례와 가상 기관 좌표를 쓰며 제주데이터허브 원자료를 배포 가능한 것으로 간주하지 않는다.

공식 원문은 insane-search로 본문을 확인했다: [Leaflet 빠른 시작](https://leafletjs.com/examples/quick-start/), [OSM 표준 타일 이용정책](https://operations.osmfoundation.org/policies/tiles/), [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). Google Embed 키 요구는 [Google 공식 설정](https://developers.google.com/maps/documentation/embed/get-api-key)도 함께 참조한다.

디자인 지침: [Impeccable 원본](https://github.com/pbakaus/impeccable), [Awesome Design Skills의 Refined](https://github.com/bergside/awesome-design-skills/blob/f631a09b4fcc0166f2e2c1a8c81906ef680c57e8/skills/refined/SKILL.md). 타일 정책을 충족하지 못하는 운영 규모에서는 이용조건이 맞는 공급자 또는 자체 타일로 교체해야 한다.

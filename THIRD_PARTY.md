# 모델·외부 서비스·오픈소스·자산 명세

확인일: 2026-10-31. 실제 사용과 선택·계획 상태를 구분한다.

| 항목 | 버전·조건 | 실제 사용 범위 |
| --- | --- | --- |
| Node.js | 개발 확인 v22.23.2. Node22 이상 | 로컬 정적 서버·빌드·하네스·검사. GPU 미사용 |
| Leaflet | 1.9.4 · BSD-2-Clause | 지도 UI. `package-lock.json` 고정. 빌드에 원 라이선스 포함 |
| 마루 부리 SemiBold | NAVER 공식 배포 · SIL Open Font License 1.1 | 제목용 자가 호스팅 `app/assets/MaruBuri-SemiBold.woff2`. 공식 TTF의 글리프·이름을 유지하고 fontTools 4.60.1·Brotli로 WOFF2 재포장. 저작권·OFL 원문은 `app/assets/MaruBuri-LICENSE.txt` |
| OpenStreetMap | 지도 데이터 ODbL, 표준 타일 정책 별도 | 실제 지도 배경. 기본 타일은 외부 인터넷 의존. 출처 표시·Referer 유지·브라우저 캐시 준수. 대량 수집·오프라인 타일 ZIP 미제공 |
| Google Maps URLs | 공식 URL 링크, API key 불필요 | 사용자가 누르는 외부 지도/길찾기 링크. 소요시간·경로 계산 결과를 앱에서 조회한 것은 아님 |
| Google Maps Embed API | 향후 검토 대상 | 현재 미구현. 키 설정으로 활성화되는 기능이 아님. 현재는 OSM 지도와 Google Maps URLs만 제공 |
| 제주데이터허브 / LOCALDATA | 병·의원 정보 · ID 859 공개 미리보기, 2026-10-31 조회 | 20행 집계·품질 분석과 폐업 제외 13개 기관의 최소 등록 사실 조회·선택. 전체 운영 API·실시간 수용 정보 미사용. 출처·시점과 재취득 코드 포함 |
| GPT Image 계열 | ChatGPT 내장 Imagegen. 정확한 모델 ID는 도구에서 미공개 | 투명 PNG 이미지 로고와 이전 디자인의 제주 일러스트 생성. 인물 일러스트는 사용자 피드백으로 화면에서 제거함. 환자 기록 분석에는 사용하지 않음. 정확 프롬프트: `app/assets/manifest.json` |
| Codex | 이 세션에 제공된 코딩 에이전트 | 기획 정리·소스 작성·서브에이전트 병렬 개발·검사. 서비스 런타임 모델이 아님 |
| 서비스 런타임 LLM | 미선정·미연동 | 현재 상태 머신은 결정적 시뮬레이터. 실제 자율 모델이라고 제출하지 않음 |
| 전화·EMR·의료진 회신 | 미연동 | 합성 응답과 사용자 역할 입력으로 재현. 실제 발신·전송·예약 없음 |
| insane-search | 로컬 설치 도구 | 공개 원문·공식 개발 문서 조사. 출처·확인 범위 기록 |
| Impeccable | revision `b7a89176e4e87422b40f98adabceb051dbb5448b` · Apache-2.0 | 디자인 지침 참고. 자동 context는 실행 권한 오류로 미실행; 문서 직접 확인 |
| Awesome Design Skills / Refined | revision `f631a09b4fcc0166f2e2c1a8c81906ef680c57e8`, 스킬 표기 MIT | 토큰·간격·가독성·상태·접근성 기준 참고. 화면/템플릿 복사 아님 |
| Playwright | 이 개발 환경에서 1.64.1 확인 · Apache-2.0 | 브라우저 QA 도구. 서비스 실행 의존성에 포함하지 않음. 선택 설치 후 재현 가능 |
| AWS CLI | 2.39.3 확인 | 로컬 콘솔 임시 인증·CloudFormation·S3·CloudFront 배포. 설치·인증 캐시는 제출 소스 밖에 유지 |
| Amazon S3·CloudFront·IAM OIDC·CloudFormation | AWS 외부 서비스 | 공개 MVP 호스팅·최소 권한 임시 CI 배포. 실제 의료기관 연결을 제공하지 않음. 사용량별 비용·인터넷 의존 |
| GitHub Actions | checkout7.0.1, setup-node7.1.0, upload-artifact7.0.2, download-artifact8.0.2, aws-credentials6.3.0 | 공식 태그 refs를 insane-search로 확인한 40자리 SHA로 고정. 정확한 값은 `.github/workflows/`에 기록 |
| cfn-lint·cfn-guard | 1.59.0 / 3.2.1 | 격리된 개발 도구. 템플릿 schema와 프로젝트 다섯 규칙 검사. 서비스 실행 의존성이나 전면 규정 준수 인증이 아님 |
| AWS CloudFormation·IAM 스킬 | 로컬 AWS Agent Toolkit 지침 | 리소스 의도·제약·검증·OIDC 역할 범위 참고. 템플릿에 `aws-cloudformation@3` marker 기록 |

화면의 기능 아이콘은 일관된 SVG, 브랜드 로고는 생성 PNG 이미지로 구분한다. 글꼴과 최종 토큰은 [디자인 기준](DESIGN.md)을 따른다. 공개 기관 최소 사실·집계와 합성 의료 사례를 구분하고, 지도 마커는 가상 좌표로 표시한다. 데이터 원문 전체·타일·논문 전문은 포함하지 않는다.

공식 원문은 insane-search로 본문을 확인했다: [Leaflet 빠른 시작](https://leafletjs.com/examples/quick-start/), [OSM 표준 타일 이용정책](https://operations.osmfoundation.org/policies/tiles/), [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). Google Embed 키 요구는 [Google 공식 설정](https://developers.google.com/maps/documentation/embed/get-api-key)도 함께 참조한다.

마루 부리 출처: [NAVER 한글한글 아름답게](https://hangeul.naver.com/font), [공식 배포 ZIP](https://hangeul.naver.com/hangeul_static/webfont/zips/maruburi.zip), [글꼴 라이선스 안내](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko). 공식 배포물의 라이선스를 포함하며 런타임 외부 폰트 호출 없이 사용한다. 확인일 2026-10-31.

디자인 지침: [Impeccable 원본](https://github.com/pbakaus/impeccable), [Awesome Design Skills의 Refined](https://github.com/bergside/awesome-design-skills/blob/f631a09b4fcc0166f2e2c1a8c81906ef680c57e8/skills/refined/SKILL.md). 타일 정책을 충족하지 못하는 운영 규모에서는 이용조건이 맞는 공급자 또는 자체 타일로 교체해야 한다.

공개 디자인 참고: [Linear Projects](https://linear.app/docs/projects)의 작업·상태·담당 배치, [Wellthy Care Concierge](https://wellthy.com/care-concierge)의 가족 돌봄 실무 설명, [Maven](https://www.mavenclinic.com/)의 관계 이미지·행동 배치를 실제 공개 화면에서 확인했다. 로그인 뒤 제품 화면을 확인하거나 해당 로고·사진·문구를 복제한 것은 아니다. 확인일 2026-10-31.

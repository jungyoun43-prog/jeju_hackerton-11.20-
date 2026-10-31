# 모델·외부 서비스·오픈소스·자산 명세

확인일: 2026-10-31. 실제 사용과 선택·계획 상태를 구분한다.

| 항목 | 버전·조건 | 실제 사용 범위 |
| --- | --- | --- |
| Node.js | 개발 확인 v22.23.2. Node22 이상 | 로컬 웹·대화 API 서버, Lambda Node22 번들·빌드·하네스·검사. GPU 미사용 |
| AWS SDK for JavaScript v3 · Bedrock Runtime | `@aws-sdk/client-bedrock-runtime`3.1161.0 · Apache-2.0 | 보존한 Converse 어댑터. 현재 런타임은 OpenAI이며 Bedrock 미활성 |
| AWS SDK for JavaScript v3 · Secret/상태 | `@aws-sdk/client-secrets-manager`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb` 각각3.1161.0 · Apache-2.0 | 실행 역할로 exact Secret 조회·DynamoDB 세션/조건부 예산 처리. 라이선스 원문 agent/licenses/aws-sdk-LICENSE.txt |
| esbuild | 0.28.2 · MIT | Node22 ESM Lambda 번들 생성. `output/agent-lambda.zip`은 정적 사이트 파일과 분리 |
| Python 3 | 표준 zipfile·subprocess | ZIP 생성·키 전송용 메모리 OS pipe. AWS SDK/boto3·Python 모델 미사용 |
| 브라우저 음성 인식 | `SpeechRecognition` / `webkitSpeechRecognition`, `ko-KR` | 지원 브라우저에서 음성을 텍스트로 전환·요청 전송. 별도 STT 계정 미설정. 브라우저 정책·네트워크 의존 가능, 실제 마이크 품질 미검증 |
| Leaflet | 1.9.4 · BSD-2-Clause | 지도 UI. `package-lock.json` 고정. 빌드에 원 라이선스 포함 |
| 마루 부리 SemiBold | NAVER 공식 배포 · SIL Open Font License 1.1 | 제목용 자가 호스팅 `app/assets/MaruBuri-SemiBold.woff2`. 공식 TTF의 글리프·이름을 유지하고 fontTools 4.60.1·Brotli로 WOFF2 재포장. 저작권·OFL 원문은 `app/assets/MaruBuri-LICENSE.txt` |
| Pretendard Variable | 1.3.9 · SIL Open Font License 1.1 | 공식 npm pretendard 배포물의 Variable WOFF2·license를 자체 호스팅. 본문·설정·대화 가독성. 파일 app/assets/PretendardVariable.woff2·Pretendard-LICENSE.txt |
| OpenStreetMap | 지도 데이터 ODbL, 표준 타일 정책 별도 | 개발용 수동 화면의 지도 배경. 기본 타일은 외부 인터넷 의존. 출처 표시·Referer 유지·브라우저 캐시 준수. 대량 수집·오프라인 타일 ZIP 미제공 |
| Google Maps URLs | 공식 URL 링크, API key 불필요 | 사용자가 누르는 외부 지도/길찾기 링크. 소요시간·경로 계산 결과를 앱에서 조회한 것은 아님 |
| Google Maps Embed API | 향후 검토 대상 | 현재 미구현. 키 설정으로 활성화되는 기능이 아님. 현재는 OSM 지도와 Google Maps URLs만 제공 |
| 제주데이터허브 / LOCALDATA | 병·의원 정보 · ID 859 공개 미리보기, 2026-10-31 조회 | 20행 집계·품질 분석과 폐업 제외 13개 기관의 최소 등록 사실 조회·선택. 전체 운영 API·실시간 수용 정보 미사용. 출처·시점과 재취득 코드 포함 |
| 제주데이터허브 327 → 공공데이터포털15056321 | [콜택시업체현황](https://jejudatahub.net/data/view/data/327)의 [연결 공식 파일](https://www.data.go.kr/data/15056321/fileData.do), 기준 2026-03-19 | 익명 공개 다운로드34업체의 지역·명칭·전화·기준일 최소 변환. 원출처의 이용허락범위 제한없음 표기 확인. 허브2020 미리보기 45행과 구분, 가입대수·빈차·운임 미사용 |
| 제주데이터허브 254 | [노인돌봄서비스시설현황](https://jejudatahub.net/data/view/data/254), 기준 2020-04-17 공개 19행 | 지역·기관·대표번호·주소·등록구분으로 문의 후보 구성. 현재 병원동행 제공 여부·대상·배정 가능은 미확인 |
| 공식 이동·동행 서비스 소개 | [제주시니어클럽 아름동행](https://www.jjcsc.co.kr/Business/Market), [교통약자 이동지원센터](https://www.jejuhappycall.com/?mcode=guide01), 확인2026-10-31 | 전자는 병원동행·이동지원 소개, 후자는 차량 이용대상·회원등록 안내. 각각 기관 대표문의이며 실시간 배정 API 아님. 허브 데이터셋 수에 포함하지 않음 |
| GPT Image 계열 | ChatGPT 내장 Imagegen. 상세 모델 ID 미공개 | PNG 로고·제주 바다/현무암 작업면 배경. 새 배경은 원본 PNG 보존·같은1672×941 WebP 형식 변환. 이전 인물·의사 이미지는 화면에서 제거하고 이력만 보존. 정확 prompt는 app/assets/manifest.json |
| 건강정보 고속도로 | 한국보건의료정보원 공식 서비스·API·이용신청 공개 안내, 확인2026-10-31 | 환자 기록 창의 공식 안내 링크와 연계 범위 조사. 실제 개인 기록·인증·동의·의료정보 API 미연결. 일반 LLM 설정과 구분 |
| Codex | 이 세션에 제공된 코딩 에이전트 | 기획 정리·소스 작성·서브에이전트 병렬 개발·검사. 서비스 런타임 모델이 아님 |
| 서비스 런타임 LLM | OpenAI `gpt-6.1-sol` 기본, `gpt-6.1-terra` 선택 | Native fetch Responses API. Sol 로컬5.5초·공개AWS5.2초의 단일 도구 스모크200. Terra·일반 품질 미검증 |
| Amazon Bedrock 접근 확인 | 2026-10-31, 서울 리전·APAC Nova profile 목록 조회와 합성 Converse 요청 | 실제 요청은 계정 Error 002로 실패. 사용 가능·한국어 tool-use 검증 완료로 기록하지 않고 추가 시도 중단. 후보 APAC profile은 6개 리전 범위를 갖지만 기본 handler에서 미활성 |
| Agent prompt | `prompts/caregiver-system.mjs` | 허용 도구·의료진 역할·합성 경계·출처 조건을 담은 자체 프롬프트. 실제 모델 품질 검증과 구분 |
| 전화·배차·동행 배정·결제·EMR·의료진 회신 | 미연동 | 문의 초안과 합성 응답으로 준비·변경 흐름 재현. 실제 발신·예약·결제·전송 없음 |
| insane-search | 로컬 설치 도구 | 공개 원문·공식 개발 문서 조사. 출처·확인 범위 기록 |
| REA / reverse-engineer-anything | morluto/rea commit23de10bb2849cdce8ddbe70504aa7cc57de75a98, CLI rea-agents6.8.0 · MIT | 개발용 의료 웹사이트 브라우저 Evidence 조사. 앱 실행·Lambda 의존성에 포함하지 않음. 도구의 Node22.23.4는 프로젝트 밖 전용 도구 환경에 설치. 정상/실패 관측은 docs/medical-reference-design.md |
| Impeccable | revision `b7a89176e4e87422b40f98adabceb051dbb5448b` · Apache-2.0 | 디자인 지침 참고. 자동 context는 실행 권한 오류로 미실행; 문서 직접 확인 |
| Awesome Design Skills / Refined | revision `f631a09b4fcc0166f2e2c1a8c81906ef680c57e8`, 스킬 표기 MIT | 토큰·간격·가독성·상태·접근성 기준 참고. 화면/템플릿 복사 아님 |
| Playwright | 이 개발 환경에서 1.64.1 확인 · Apache-2.0 | 브라우저 QA 도구. 서비스 실행 의존성에 포함하지 않음. 선택 설치 후 재현 가능 |
| AWS CLI | 2.39.3 확인 | 로컬 콘솔 임시 인증·CloudFormation·S3·CloudFront 배포. 설치·인증 캐시는 제출 소스 밖에 유지 |
| Amazon S3·CloudFront·Lambda·IAM OIDC·CloudFormation | AWS 외부 서비스 | 비공개 S3 정적 앱과 선택 Lambda API. Lambda URL은 AWS_IAM·CloudFront OAC, backend ZIP은 직접 게시. 새 revision 공개 검증은 결과 기록 기준. 사용량별 비용·인터넷 의존 |
| DynamoDB | AWS 합성 세션·UTC 전역80요청, 로컬은 메모리 | 조건부 lease/save/budget·TTL1시간. 원문·이력·답변·reasoning 저장 없음 |
| Secrets Manager | 서울 전용 Secret, exact ARN GetSecretValue | 키값은 서버만 조회. 소스·CI·브라우저·Lambda 환경변수에 평문 키 없음. 키 교체 후 warm runtime 갱신 필요 |
| GitHub Actions | checkout7.0.1, setup-node7.1.0, upload-artifact7.0.2, download-artifact8.0.2, aws-credentials6.3.0 | 공식 태그 refs를 insane-search로 확인한 40자리 SHA로 고정. 정확한 값은 `.github/workflows/`에 기록 |
| cfn-lint·cfn-guard | 1.59.0 / 3.2.1 | 격리된 개발 도구. 템플릿 schema와 프로젝트 다섯 규칙 검사. 서비스 실행 의존성이나 전면 규정 준수 인증이 아님 |
| AWS CloudFormation·IAM 스킬 | 로컬 AWS Agent Toolkit 지침 | 리소스 의도·제약·검증·OIDC 역할 범위 참고. 템플릿에 `aws-cloudformation@3` marker 기록 |

고정 예시는 `agent/preview.mjs`에서 공개 snapshot·자체 도메인 reducer를 실행하며 자유 입력을 해석하지 않는다. SDK·빌드 도구의 라이선스는 설치된 배포물에서 확인했다. 라이브러리가 포함되었다는 사실을 모델·외부 서비스 연동 완료로 표시하지 않는다.

화면의 기능 아이콘은 일관된 SVG, 브랜드 로고는 생성 PNG 이미지로 구분한다. 글꼴과 최종 토큰은 [디자인 기준](DESIGN.md)을 따른다. 공개 기관 최소 사실·집계와 합성 의료 사례를 구분하고, 지도 마커는 가상 좌표로 표시한다. 데이터 원문 전체·타일·논문 전문은 포함하지 않는다.

공식 원문은 insane-search로 본문을 확인했다: [Leaflet 빠른 시작](https://leafletjs.com/examples/quick-start/), [OSM 표준 타일 이용정책](https://operations.osmfoundation.org/policies/tiles/), [Google Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). Google Embed 키 요구는 [Google 공식 설정](https://developers.google.com/maps/documentation/embed/get-api-key)도 함께 참조한다.

마루 부리 출처: [NAVER 한글한글 아름답게](https://hangeul.naver.com/font), [공식 배포 ZIP](https://hangeul.naver.com/hangeul_static/webfont/zips/maruburi.zip), [글꼴 라이선스 안내](https://help.naver.com/service/30016/contents/18088?osType=PC&lang=ko). 공식 배포물의 라이선스를 포함하며 런타임 외부 폰트 호출 없이 사용한다. 확인일 2026-10-31.

디자인 지침: [Impeccable 원본](https://github.com/pbakaus/impeccable), [Awesome Design Skills의 Refined](https://github.com/bergside/awesome-design-skills/blob/f631a09b4fcc0166f2e2c1a8c81906ef680c57e8/skills/refined/SKILL.md). 타일 정책을 충족하지 못하는 운영 규모에서는 이용조건이 맞는 공급자 또는 자체 타일로 교체해야 한다.

공개 디자인 참고: [Linear Projects](https://linear.app/docs/projects)의 작업·상태·담당 배치, [Wellthy Care Concierge](https://wellthy.com/care-concierge)의 가족 돌봄 실무 설명, [Maven](https://www.mavenclinic.com/)의 관계 이미지·행동 배치를 실제 공개 화면에서 확인했다. 로그인 뒤 제품 화면을 확인하거나 해당 로고·사진·문구를 복제한 것은 아니다. 확인일 2026-10-31.

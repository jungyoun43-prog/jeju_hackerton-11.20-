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
| Pretendard Variable | 1.3.9 · SIL Open Font License 1.1 | 공식 npm pretendard1.3.9의 unicode-range 분할 CSS·WOFF2 92개를 app/assets/pretendard/에 자체 호스팅. font 바이너리/범위는 원본이며 CSS family 별칭만 Pretendard로 적용. 기존 Pretendard-LICENSE.txt 보존. 버전·원패키지/개별 파일 해시와 변환은 manifest.json, 재현은 scripts/prepare-fonts.py. 전체 파일은 제거하고 MaruBuri는 dialog가 필요할 때 로드 |
| OpenStreetMap | 지도 데이터 ODbL, 표준 타일 정책 별도 | 개발용 수동 화면의 지도 배경. 기본 타일은 외부 인터넷 의존. 출처 표시·Referer 유지·브라우저 캐시 준수. 대량 수집·오프라인 타일 ZIP 미제공 |
| Google Maps URLs | 공식 URL 링크, API key 불필요 | 사용자가 누르는 외부 지도/길찾기 링크. 소요시간·경로 계산 결과를 앱에서 조회한 것은 아님 |
| Google Maps Embed API | 향후 검토 대상 | 현재 미구현. 키 설정으로 활성화되는 기능이 아님. 현재는 OSM 지도와 Google Maps URLs만 제공 |
| 제주데이터허브 / LOCALDATA | 병·의원 정보 · ID 859 공개 미리보기, 2026-10-31 조회 | 20행 집계·품질 분석과 폐업 제외 13개 기관의 최소 등록 사실 조회·선택. 전체 운영 API·실시간 수용 정보 미사용. 출처·시점과 재취득 코드 포함 |
| 제주데이터허브 327 → 공공데이터포털15056321 | [콜택시업체현황](https://jejudatahub.net/data/view/data/327)의 [연결 공식 파일](https://www.data.go.kr/data/15056321/fileData.do), 기준 2026-03-19 | 익명 공개 다운로드34업체의 지역·명칭·전화·기준일 최소 변환. 원출처의 이용허락범위 제한없음 표기 확인. 허브2020 미리보기 45행과 구분, 가입대수·빈차·운임 미사용 |
| 제주데이터허브 254 | [노인돌봄서비스시설현황](https://jejudatahub.net/data/view/data/254), 기준 2020-04-17 공개 19행 | 지역·기관·대표번호·주소·등록구분으로 문의 후보 구성. 현재 병원동행 제공 여부·대상·배정 가능은 미확인 |
| 제주데이터허브1304 → 공공데이터포털15056141 | [제주시 보건지소등현황](https://www.data.go.kr/data/15056141/fileData.do), 기준2026-03-23 · 수집2026-11-01 | 공식 파일35행의 기관종류·명칭·주소·관할구역·전화 최소 사실. 이용허락범위 제한없음 표기 확인. 원CSV 전체 미포함, 인코딩·SHA·변환·출처를 snapshot/재취득 코드에 기록. 현재 수용·예약·차량 자격과 구분 |
| 공식 이동·동행 서비스 소개 | [제주시니어클럽 아름동행](https://www.jjcsc.co.kr/Business/Market), [교통약자 이동지원센터](https://www.jejuhappycall.com/?mcode=guide01), 확인2026-10-31 | 전자는 병원동행·이동지원 소개, 후자는 차량 이용대상·회원등록 안내. 각각 기관 대표문의이며 실시간 배정 API 아님. 허브 데이터셋 수에 포함하지 않음 |
| GPT Image 계열 | ChatGPT 내장 Imagegen. 상세 모델 ID 미공개 | PNG 로고·제주 바다/현무암 작업면 배경. 새 배경은 원본 PNG 보존·같은1672×941 WebP 형식 변환. 이전 인물·의사 이미지는 화면에서 제거하고 이력만 보존. 정확 prompt는 app/assets/manifest.json |
| 건강정보 고속도로 | 한국보건의료정보원 공식 서비스·API·이용신청 공개 안내, 확인2026-10-31 | 환자 기록 창의 공식 안내 링크와 연계 범위 조사. 실제 개인 기록·인증·동의·의료정보 API 미연결. 일반 LLM 설정과 구분 |
| Codex | 이 세션에 제공된 코딩 에이전트 | 기획 정리·소스 작성·서브에이전트 병렬 개발·검사. 서비스 런타임 모델이 아님 |
| 서비스 런타임 LLM | OpenAI `gpt-6.1-sol` 기본, `gpt-6.1-terra` 선택 | Native fetch Responses API. 이전 Sol 단일 스모크와 최신12개 고정 합성 과업을 분리해 구현결과3.19절에 기록. Terra·일반화 품질 미검증 |
| Amazon Bedrock 접근 확인 | 2026-10-31, 서울 리전·APAC Nova profile 목록 조회와 합성 Converse 요청 | 실제 요청은 계정 Error 002로 실패. 사용 가능·한국어 tool-use 검증 완료로 기록하지 않고 추가 시도 중단. 후보 APAC profile은 6개 리전 범위를 갖지만 기본 handler에서 미활성 |
| Agent prompt | `prompts/caregiver-system.mjs` | 허용 도구·의료진 역할·합성 경계·출처 조건을 담은 자체 프롬프트. 실제 모델 품질 검증과 구분 |
| 전화·배차·동행 배정·결제·EMR·의료진 회신 | 미연동 | 문의 초안과 합성 응답으로 준비·변경 흐름 재현. 실제 발신·예약·결제·전송 없음 |
| 공통 전화·협진·휠체어 계획 | 자체 `app/call-policy.js`·Agent Prompt·도구·UI | 사용자 원칙을 수신처·질문·최소 전달·AI 고지 예정문·기록 처리 미설정·실발신 전 확인·합성 결과로 구현. 전화 사업자/API·발신번호 신규 계약 없음, 새로운 실제 녹음·전사·개인정보 저장 없음 |
| 전화 대행 참고 자료 | 피클 공식 도움말·약관 제4조와 국가법령정보센터 일부 조문, 확인2026-10-31 | [조사 기록](research/ai_phone_policy_2026-10-31.md)의 읽은 원문·초기 HTML·404·렌더 범위를 구분. 타 서비스의 존재를 우리 구현의 법적 적합성으로 해석하지 않음 |
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

## 혼디 로고 교체 (2026-10-31)

사용자가 지정한 에이전트 대화에서 생성·선택한 귤 심볼 + 소문자 `hondi` PNG를 재사용했습니다. 새 생성 호출은 하지 않았습니다. 원본은 `app/assets/hondi-logo-source-v1.png`, 웹용 투명 PNG와 심볼은 `hondi-logo-v1.png`·`hondi-mark-v1.png`입니다. 원본 해시·정확 프롬프트·부모 시안·생성 도구·여백/축소 범위는 `app/assets/manifest.json`에 기록합니다. 이전 로고는 이력으로 보존하며 상표 등록·중복 검토를 완료했다고 주장하지 않습니다.

## 진료 연결 여정

`app/care-journey.js`와 새 여정 도구·preview는 자체 구현이며 새 통신/예약/의무기록 업체 의존성을 추가하지 않습니다. 기존 공개 snapshot3종과 공식 보완2건의 범위·이용조건을 그대로 적용합니다. 동형 요약은 JSON import attributes를 사용하므로 Node22와 해당 문법을 지원하는 브라우저가 필요하며 실제 검증 브라우저는 Chromium입니다. 비교 서비스의 소스·코드·상표·이미지를 제품 자산으로 복사하지 않았고 공식 기능 설명만 [비교 조사](research/care_journey_positioning_2026-10-31.md)에 기록했습니다.

## 방문 준비 복구와 피클 공개 사례 참고 (2026-11-01)

피클의 공개 도움말·약관·공식 GitHub에서 확인한 역할과 미확인 범위는 [조사 기록](research/pickle-reference-2026-11-01.md)에 남겼다. 공개 대행 요청·조건 확인·작업 상태·결과/사람 인계의 원칙만 참고했다. 피클의 API·전화 엔진·enclave 라이브러리·tau2-bench 코드를 복사하거나 의존성으로 추가하지 않았다. 별도 신규 통신/기록 업체 연동은 없다.

복구는 기존 메모리/DynamoDB 저장소와 자체 코드다. 토큰 해시·요청 지문·고정 receipt 메타데이터를 추가하며 대화/답변/reasoning 원문을 새로 보관하지 않는다. 탭 확대의 선택 QA는 격리 Chrome 확장과 Xvfb를 쓰며 사용자 브라우저를 변경하지 않는다. PDF 재생성에는 기존 Playwright/Chromium과 Poppler의 pdfinfo가 필요하지만 서비스·Lambda 의존성에는 포함하지 않는다. 기획서의 Pretendard·기존 혼디 로고는 원래 고지를 따른다.

## React · Next.js · shadcn (2026-11-16)

예약·진료과 검색·달력·왕복 교통을 실제 React 컴포넌트로 구현했다. Next.js 16.4.6, React/React DOM 19.3.1, Tailwind/@tailwindcss/postcss 4.3.5, Radix UI 1.8.1, React DayPicker 10.0.2, date-fns 4.4.0, cmdk 1.1.1, cn 0.5.2는 설치 패키지 메타데이터에서 MIT를 확인했다. Lucide React 1.73.0은 ISC다. class-variance-authority·clsx·tailwind-merge를 포함한 정확한 설치 버전과 전이 의존성은 package-lock.json에 고정한다.

shadcn CLI 4.23.0으로 공식 new-york registry의 컴포넌트 소스 11개를 `web/components/ui`에 생성했다. 혼디의 크기·색·44px 조작·16px 입력에 맞게 상위 화면에서 조합한다. [Next 설치 안내](https://ui.shadcn.com/docs/installation/next)를 참고했으며 외부 의료기관의 화면·로고·의료진 사진을 복사하지 않았다. 원래 로고·이미지·Pretendard 원본과 라이선스를 보존한다.

의료·교통과 진료과 명칭의 공식 참고 URL 및 조회 제약은 [근거 기록](research/seoul-referral-and-travel-2026-11-16.md)에 남겼다. 가상 병원 2곳·진료과 27개·의료진 55명과 시간표는 자체 합성 자료다. 실제 예약·항공·교통 API 의존성은 추가하지 않았다.

## 제주 서체·색면·실시간 음성 (2026-11-17)

[제주특별자치도 제주고딕](https://www.jeju.go.kr/jeju/symbol/font/infor.htm)의 공식 수동 설치 ZIP에서 원본 TTF를 사용했다. 제목과 지역 선택에만 자체 호스팅하며 출처 고지는 화면·`app/assets/JejuGothic-LICENSE.txt`·자산 명세에 남긴다. 웹·모바일 사용 안내와 글꼴 자체 판매 금지 조건을 보존하며 자유 재배포 권리 전체를 추정하지 않는다.

Headspace와 Linear의 공식 공개 홈페이지에서 색면·주 행동 대비·정렬을 참고했다. 기존 혼디 로고와 제주 배경 이미지를 재사용하고 외부 회사 자산은 가져오지 않았다. 새 실시간 음성은 브라우저 표준 WebRTC와 서버 `fetch`로 OpenAI Realtime API를 사용하며 ElevenLabs·새 음성 SDK 의존성은 추가하지 않았다. 사용 모델·호출 제한·원음 처리·공식 문서와 조회 범위는 [현재 계약](docs/compact-entry-voice-contract.md)에 기록한다.

## 운영자용 AI 전화 코드 (2026-11-18)

`ws` 8.23.0 (MIT)을 Node WebSocket 연결에 추가했다. Twilio Calls REST·Media Streams와 OpenAI Realtime 공식 프로토콜을 사용한다. Twilio SDK·ElevenLabs·피클 API는 연결하지 않았다. 피클은 공개 도움말의 대행 전화·결과 알림 흐름만 참고했다. 실제 외부 발신 없이 fake transport와 로컬 테스트로 검사했으며 공급자 계정·통신 비용·발신번호·한국 통화 지원·공개 프록시 조건은 실제 운영 전 별도 확인한다. 공식 자료와 사용 범위는 [전화 어댑터 계약](docs/outbound-phone-adapter.md)에 기록한다.

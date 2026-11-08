# Agent API 연결과 운영

로컬은 `.env`의 `OPENAI_API_KEY`로 실행하고 AWS는 Secrets Manager에서 키를 읽습니다. 기본 `gpt-6.1-sol`, 선택 `gpt-6.1-terra`만 사용하며 자동 대체하지 않습니다. 2026-10-31 로컬5.5초·공개 AWS5.2초의 Sol→get_case→응답을 각각 확인했습니다. Terra·모델 전반 품질은 별도입니다. 복합 과업의 최신 실제 평가와 수정 전후는 [검증 기록](../docs/implementation-results.md)을 따릅니다. 전화·공단 기록·의료진 회신은 합성 시연입니다.

## 경로와 실행

- `GET /api/agent/capabilities`: capability 객체. llm:true는 어댑터 설정이며 요청 성공을 보장하지 않습니다. AWS의 첫 조회는 Secret을 준비하지만 모델 추론·세션/예산 DB는 호출하지 않습니다. 준비 실패 시 llm:false를 반환합니다.
- `POST /api/agent`: `{message,requestId,sessionId?,visitToken?,history?,preferences?,applyPreferences?,guidedPreparation?}`. OpenAI Responses API와 검증된 도구를 실행합니다. 로컬 키가 없으면 MODEL_NOT_CONNECTED/503, AWS 키/저장소 준비 실패는 CLOUD_RUNTIME_UNAVAILABLE/503입니다.
- `POST /api/agent/resume`: `{visitToken}`으로 미만료 방문의 확인된 상태·남은 일·복구 메타데이터만 읽습니다. 모델·Secret·budget·lease·새 세션·TTL 연장을 실행하지 않습니다.
- `POST /api/agent/preview`: `{scenarioId:'aewol-parent-visit',requestId}`. 별도 고정 예시이며 모델·Secret·세션 DB를 호출하지 않습니다.

로컬은 `.env.example`을 복사한 뒤 키를 채우고 `npm run dev`를 실행합니다. 기존 .env를 덮어쓰지 않습니다. `npm start`·`npm run preview`도 .env를 읽습니다. `OPENAI_MODEL=gpt-6.1-terra`는 Terra만 선택합니다. 키 없는 검사는 `OPENAI_API_KEY= PORT=4180 node scripts/server.mjs`로 실행합니다.

## 모델과 도구

`createRuntimeAgent({env,store})`가 provider를 구성하고 `createAgentService`에 주입합니다. Native fetch로 공식 HTTPS Responses endpoint만 사용하며 redirect·자동 재시도·모델 대체를 하지 않습니다. reasoning/encrypted 항목은 같은 요청의 도구 결과와 재전달하고 HTTP·로그·세션에 저장하지 않습니다. store:false는 공급자의 모든 보관 정책을 해제하는 설정이 아닙니다.

도구 인자는 allowlist 스키마로 검증합니다. 상태는 공공 snapshot·고정 합성 템플릿·도메인 reducer로만 변경합니다. 실명·상세주소·임의 의료기록·출처 URL을 도구 인자로 받지 않고 진찰 소견·임상 결론을 작성하지 않습니다. 공단 연계의 승인된 어댑터가 없어 조회 완료를 표시하지 않습니다. Bedrock 어댑터는 보존하되 선택하지 않습니다.

`request_records(source=demo)`는 앱의 고정 합성 FHIR R4 Bundle에서 치료 이력·판독문을 읽습니다. `get_case`와 도구 결과의 `healthRecords`는 같은 작성일·리소스 ID·합성 외래/체온/과거 복약 예제와 현재 문서 준비 여부를 제공합니다. 다른 준비 대상에는 기록을 붙이지 않으며, `source=nhis`는 미연결을 반환하고 자동 합성 대체하지 않습니다. 임의 FHIR 입력·새 원문 저장·실제 개인기록 전송은 추가하지 않았습니다. [연결 계약](../docs/fhir-demo-contract.md)을 따릅니다.

## 진료 준비용 공공데이터 스킬

등록 도구는18개이며 그중 `search_public_data`·`analyze_public_data`는 읽기 전용입니다. 전자는 업무 목적(hospital/taxi/companion/travel)과200자 이내 검색어로 최대8개 메타데이터를 반환합니다. 후자는 두 지역의 관측 등록 현황, 지역·휠체어 조건의 문의 후보, 이동시간 원자료 접근 범위를 고정 함수로 계산합니다. 임의SQL·파일경로·URL·원자료 fetch를 모델 인자로 받지 않습니다.

`app/data/public-data-catalog.json`은 기존 감사CSV의 허브1,259건·센터70건을 분류한 목록입니다. 별도 공식안내2건과 실제 보유4종 snapshot을 구별합니다. 카탈로그 갱신일은 원자료 기준일이 아닙니다. `app/public-data-skill.js`가 자료별 출처·기준일·수집일·관측 분모·폐업/중복 제외·주소 결측·조회 한계를 반환하고, `agent/public-data-tools.mjs`가 스키마·공식HTTPS출처를 검증합니다. 새 관리형 DB·운영 API·개인 기록 연결은 없습니다. 공공보건1304의2026-03-23 기준35행은 공식 연결파일에서 최소 사실을 정제해 추가했습니다. `public_health_contacts`는 제주시의 등록 관할/소재지·연락처·질문을 읽기 전용으로 반환하며 서귀포·지역 미상은 기관 수null로 둡니다. 병원·택시·동행을 자동 선택하지 않습니다.

병원은 공개20행→정상13행의 표본, 돌봄은2020년19개 등록 문의처입니다. 관측0행을 지역 시설 부재로 설명하지 않습니다. 읍면동·시를 섞으면 각 주소 해상도의 분모를 따로 보존합니다. 센터7/8/10은 명세만 있어 `travel_time`은 unavailable·수치 없음으로 반환합니다. LLM은 이 값을 설명하고 문의 질문으로 이어가며 ETA나 전체 분포를 만들지 않습니다.

분석에는 출발지역·휠체어 여부·방문기관명만 context로 넘기고 환자 이름·진료기록은 넘기지 않습니다. 읽기 도구는 caseState와 새 저장 필드를 바꾸지 않으며 query를 새 로그/세션 필드에 저장하지 않습니다. 사용자의 원래 메시지가 모델에 전달되는 기존 대화 경로와는 구분합니다. 다른 지역·지원조건을 탐색한 결과에는 현재 사례의 문의 실행 제안을 붙이지 않습니다. 현재 조건과 맞으면 검증한 providerId의 `prepare_inquiries` 제안을 반환하며 실제 초안 작성은 기존 도구가 별도로 수행합니다. 제안만으로 문의처를 명시 선택한 것으로 보지 않습니다. 일반 준비는 providerId를 생략해 선호택시·지역·휠체어 규칙을 적용하고 사용자가 그 문의처를 이번 요청에서 선택한 경우에만 ID를 넘깁니다. `search_hospital_contacts`·`prepare_inquiries` 결과에도 사용한 데이터 근거를 붙입니다.

같은 CLI 계산은 키·네트워크 없이 `npm run data:query -- ...`로 재현합니다. `npm run data:catalog -- --check`는 저장 감사CSV와의 대조이며 API/raw 갱신이 아닙니다. [계약](../docs/public-data-skill-contract.md)·[데이터 명세](../docs/data-sources.md)와 실제 검증 기록을 따릅니다.

## 보관과 한도

로컬은 메모리, AWS는 `createDynamoSessionStore`입니다. AWS 저장 필드는 opaque sessionId·requestIds·고정 receipt(요청 ID/본문 해시/상태/시각)·턴 수·정규화된 합성 상태·TTL 및 처리 중 lease입니다. 원문·이력·모델 답변·reasoning·키는 저장하지 않습니다. 강한 읽기와65초 lease 소유권 조건으로 동시 저장을 보호하고, 애플리케이션에서도1시간 TTL 만료를 검사합니다. DynamoDB의 실제 삭제는 TTL 정책에 따라 지연될 수 있습니다.

기본 OpenAI 한도는 low reasoning·호출당 출력4,096토큰(추론 포함)·호출40초·처리 전체45초·최대8라운드/16도구·세션20턴입니다. 요청24KiB·message4,000자·최근이력8개/각2,000자이며 UI 입력은1,600자입니다. cloud 준비8초와 정리2.5초는 별도이고 브라우저는65초까지 기다립니다. Lambda·CloudFront origin은60초입니다.

AWS는 UTC 하루80개 대화 요청을 모델 호출 전에 조건부 원자 갱신으로 차감합니다. 한 요청 내부 Responses 호출은 최대8회이며 API 호출80회나 금액 한도를 뜻하지 않습니다. 실패한 요청도 차감하고 DB 오류 시 모델을 실행하지 않습니다. AWS store 상한은1~80이고 로컬 메모리 한도는 인스턴스별입니다.

새 브라우저는 첫 요청 전에32byte 방문 토큰을 만들고 같은 방문에서 유지합니다. 서버는 도메인을 구분한 해시로 같은 세션을 원자적으로 생성하고, receipt 저장 뒤에만 budget·모델·도구를 실행합니다. 같은 ID·다른 본문은409, 완료된 중복 요청은 저장 상태 재표시, 처리중/중단된 요청은 재실행·재차감 없이 확인/인계 상태입니다. DDB client의 SDK 자동 재시도는1회로 제한해 비멱등 budget ADD가 SDK 내부에서 반복되지 않게 합니다. Secret 조회의 재시도와 구분합니다.

이 보장은 활성 방문의1시간 TTL 범위이며, 토큰 없는 레거시 API의 sessionId 없는 첫 요청은 기존 한계가 남습니다. receipt가 없는 이전v1 완료 요청은 과거 본문 지문을 소급 비교하지 못하므로 기존 저장 상태를 반환합니다. 불명확한 실패를 자동 재실행하지 않으며, 전역80턴 한도와 합성 외부 작업 범위를 유지합니다.

## 방문 준비 이어하기

capabilities의 `visitRecovery`는 `token` 또는 `unavailable`입니다. 브라우저는 sessionStorage에 opaque token 하나만 저장하고 대화·초안·환자정보·sessionId는 새로 저장하지 않습니다. 같은 탭의 새로고침 복구이며 계정 로그인·복수 가족 공유가 아닙니다. localStorage의 기존 이동 선호3항목은 그대로입니다.

`POST /api/agent/resume`은 토큰으로 기존 세션만 읽어 `{sessionId,caseState,pendingActions,recovery:{savedAt,expiresAt,request}}`를 반환합니다. savedAt은 마지막 완료 상태의 ISO시각 또는null, expiresAt은epoch초입니다. request는null 또는 `{requestId,status:'running'|'completed'|'interrupted'}`입니다. 과거 모델 답변은 저장·복원하지 않습니다. 유효하지 않은 입력400, 없는/만료 상태404 SESSION_EXPIRED, 저장소 실패503을 구분합니다. 조회만으로 만료를 연장하거나 세션을 만들지 않습니다.

화면은 정적 안내와 확인된 준비를 복원합니다. 새 대화·새 요청·preview를 시작한 뒤 늦은 복구가 초안/상태를 덮지 않게 보호합니다. preview는 성공적으로 모드가 바뀔 때만 복구 참조를 정리하고 실패/취소에서는 원래 방문을 유지합니다. 새 대화는 현재 탭의 참조를 정리할 뿐 서버 실행 취소·즉시 삭제가 아닙니다. 실제 외부 작업의 중단·철회·권한 처리는 별도입니다.

## 보호자 기본 설정과 복합 요청

선택 설정은 `{taxiProviderId:'auto'|공개택시ID,wheelchair:boolean,companionNeeded:boolean}`만 허용합니다. 임의 연락처·실명·기록·권한 항목을 받지 않습니다. 새 세션 또는 applyPreferences:true에서 두 boolean을 기존 준비 상태에 반영합니다. false이면 대화에서 수정한 이동 조건을 유지합니다. 선호 택시 ID는 매 요청의 초안 선택 fallback이며, 준비 첫 턴이 자료 안내뿐이어도 다음 택시 요청에 사용할 수 있습니다. 명시한 도구 providerId가 우선하고 휠체어 지원·현재 지역 후보 경계를 지킵니다. 실제 배차·이용자격을 확인한 것은 아닙니다.

기기 설정만 브라우저 localStorage에 저장하고 API/모델에 검증한 값만 보냅니다. 설정 변경 자체는 모델을 호출하지 않습니다. 요청 중 설정을 바꾸면 그 변경은 다음 요청에 남기며, 실패 재시도는 원래 본문을 그대로 씁니다. 서버 DB에 preferences 원문이나 새로운 권한을 저장하지 않습니다. 상세는 [설정 계약](../docs/caregiver-preferences-contract.md)을 따릅니다.

모델 호출은 최대8회 중 마지막1회를 tool_choice:none 요약에 남깁니다. 함수 정의와 요청별 reasoning context는 유지합니다. 독립 도구는 묶어 실행할 수 있고 실제 도구16개/작업45초 제한은 유지합니다. 호출 횟수·도구 예산에 다가가면 완료한 준비와 아직 실행하지 않은 일을 구분해 요약하고 저장합니다. 정상적인 여러 단계가 마지막 답변 기회를 잃어 전부 롤백되던 경로를 수정한 것이며, 모든 요청이 한 번에 끝남을 보장하지 않습니다. 작업 deadline에 lease 해제 최대2.5초가 별도로 더해질 수 있습니다.

## 전화·협진·휠체어 이동 계획

`app/call-policy.js`의 `buildCallPlan(state,target)`을 화면·도구·시연 어댑터가 함께 사용합니다. 대상은 mainland/jeju/taxi/companion이며 수신처·문의 목적·질문·최소 전달·제외 항목·AI 시작 예정문·녹음/전사/보관/국외 이전 미설정·실발신 전 확인·합성 결과·다음 행동을 구분합니다. get_case.callPlans는 작은 요약이고 전화/문의 준비 도구 data.callPlan은 전체 계획입니다. 계획이나 실환자 동의 필드를 DB에 새로 저장하지 않습니다.

양기관 협진 문의는 행정 접수·의뢰/회송·자료 전달 절차와 의료진 작성 기록을 준비하며, 의료적 적합성·진료 수락·예약은 확인하지 않습니다. 휠체어 이동은 자격·회원등록·탑승/승하차 지원·동행인·시각·차량 가능 질문을 포함합니다. available_demo와 실제 자격/휠체어 탑승/배차 확인을 구분합니다.

사용자는 전화 사업자 계정이 없어 준비·시연을 먼저 선택했습니다. 실제 발신 어댑터를 거부하는 guard와 realDelegationVerified/realAdapterConfigured/actualCallPlaced/reservationConfirmed/clinicalAcceptanceConfirmed:false를 유지합니다. 합성 문의 허용은 실제 환자의 위임·민감정보 제공 동의가 아닙니다. 실제 녹음·전사·보관 정책 없이 ‘기록합니다’라고 말하지 않으며 구체 운영 전 처리 근거·수수료/국외 이전 검토가 필요합니다. [공통 계약](../docs/call-workflow-contract.md)을 따릅니다.

클라이언트의 응답 대기 중지는 AbortController로 해당 화면의 기다림만 끝냅니다. 서버 실행·발신 중단 API가 아니며 완료된 중단으로 표시하지 않습니다. 원래 requestId/본문·설정 스냅샷을 재사용하되 새 visitToken 흐름에서는 최초 응답 전에도 같은 요청의 재실행을 막고 마지막 확인 상태를 복구합니다. 토큰 없는 레거시 요청은 sessionId 없는 재시도의 기존 한계가 남습니다.

## AWS 키와 배포

Lambda는 전용 `OPENAI_SECRET_ARN`·`SESSION_TABLE_NAME`을 함께 요구하며 평문 키만으로 메모리 경로를 사용할 수 없습니다. exact ARN·계정·서울 리전과 한 필드 JSON을 확인하고 성공한 runtime을 warm cache에 둡니다. Secret·SDK 오류 원문은 공개하지 않습니다.

`scripts/aws-agent-key.mjs --apply`는 현재 계정·stack·소유 태그·활성 Secret을 확인하고 로컬 키를 메모리 파이프로만 전달합니다. CLI 인자·임시 비밀파일·자식 환경·GitHub·Lambda 환경변수·프런트·빌드·제출 ZIP에 키를 넣지 않습니다. AWS CLI와 Python3가 필요합니다. 키를 교체하면 코드 재게시 등으로 warm cache도 갱신합니다. 자세한 명령·롤백은 [배포 매뉴얼](../docs/deployment.md)을 따릅니다.

`APP_REVISION=<SHA> npm run build:agent`는 Node22·esbuild·Python3로 별도 `output/agent-lambda.zip`을 만듭니다. ZIP은 index.mjs·deployment.json, handler는 index.handler입니다. revision은 capabilities/x-app-revision과 일치합니다. SDK·공공 JSON·prompt를 번들하며 .env는 포함하지 않습니다.

## 진료 연결 여정 도구·고정 상황

`get_care_journey`는 현재 사례의 근거·할 일·일정 의존성·데이터 적용 이유를 읽습니다. `run_journey_demo`는 명시적 합성 시연 요청만 허용하며 `missing_record`, `jeju_unavailable`, `time_changed` 중 서버에 정의된 상황을 실행합니다. 모델이 임의 의료진 결과·의무기록 원문·전화 결과를 주입하지 못합니다. 기존 고정 preview의 scenarioId에 같은 세 값을 추가하며 `aewol-parent-visit`와15이벤트는 유지합니다.

현재 결과/전화/의료진 안내는 합성입니다. 세 진료 경로에 필요한 실제 의료진·기관의 확인이나 예약·배차로 표시하지 않습니다. 조건 변경은 기존 이동·동행 결과의 재확인을 유발합니다. 원문 의료기록/모델 reasoning을 저장하는 새 경로는 만들지 않으며 기존 version1 상태를 읽는 호환성을 유지합니다. 상세는 `docs/care-journey-contract.md`를 따릅니다.

## 전화가 막혔을 때의 인계

실패 이유·시도 내역·남은 일·담당자를 보존합니다. 무응답은 사용자가 명시한 시연 횟수/시간 안에서만 재시도하며 기본은 정책 미설정입니다. 최초 포함 최대1~3회·1~120분을 지원하고 같은 정책을 반복 적용해도 시도/시간 범위를 초기화하지 않습니다. AI 응대 거절은 자동 반복을 멈추고 보호자에게 번호·문의 내용을, 본인확인은 환자 본인이 해야 할 단계를 넘깁니다. 서류 부족은 발급/제출 작업으로, 예약 불가는 허용한 다른 날짜의 문의로 이어집니다.

별도 무응답·AI 거절·본인확인·서류/일정 막힘 예시는 합성입니다. 재시도 정책이나 다음 가능 시각은 실제 발신 예약이 아니고 현재 실발신은 없습니다. 실제 위임·민감정보·전화/예약 확인 경계를 유지합니다.

현재 복구 상태는 대상별(기존 도외 병원·제주 병원·택시·동행) 한 수신처 범위입니다. 한 번이라도 문의를 시연한 뒤 다른 기관을 명시 선택하면 새 문의 초안을 만들 수 있지만 자동 문의는 인계 상태를 유지합니다. 이전 수신처의 실패를 새 기관의 거절로 표시하지 않습니다. 여러 기관별 전화 스레드·새 위임 범위 검증·실제 발신은 후속 구현입니다.

정책 설정은 같은 절에 해당 대상·정확한 횟수·기간·명시적 긍정 요청이 있어야 합니다. 예: “택시에 15분 안에 최초 포함 최대 2회 재시도를 허용해줘.” 부정문·인용/태그·다른 대상의 허용·예약 시각의 숫자를 권한으로 사용하지 않습니다. 모호하면 설정하지 않습니다. 기관 변경은 이전 성공/실패에 관계없이 새 대행 범위 확인으로 넘기며 이전 연락처에 새 실패를 귀속하지 않습니다.

## 준비 현황의 진행 상태

일반 POST의 선택progressToken은 UI가 생성하는256bit URL-safe43자다. capabilities의 progress가poll일때만 UI가 별도 POST `/api/agent/progress`에 `{progressToken}`을 보내며, 최대26번·2.5초 이상 간격·동시1개로 읽는다. 이 경로는 모델·budget·세션 생성/lease를 실행하지 않는다. 유효한 미등록/만료 토큰은200 unavailable이고 잘못된입력은400이다. preview는 진행poll을 쓰지 않는다.

실제tool시작·관측결과·답변완료/실패에서 고정enum DTO를 생성한다. 원문·인자·결과·환자정보·번호·URL·reasoning·토큰원문은 진행 기록에 없다. 로컬은메모리, AWS는기존DynamoDB의별도 `progress#sha256(token)` 키·120초TTL을 사용하고 기존session v1/lease/80요청 한도를 유지한다. cloud진행읽기는Secrets Manager/모델준비와 분리한다. 짧은timeout·단일writer·제한된기록예산을 적용해 진행 실패가 실제 모델/저장 응답을 막지 않게 한다. 일시적I/O실패뒤다음실제전이의최신snapshot부터재개하며, 내부128bit writer소유표식과조건부기록으로초기ack유실과다른요청의같은토큰사용을구분한다. 소유표식은외부진행DTO/모델/세션/로그에보내지않고TTL을연장하지않는다.

진행 DTO와 고정 도구 목록은 `app/preparation-stages.js`에서 한 번 정의하며 브라우저 수신·화면·서버 저장/조회가 같은 엄격 검증을 사용한다. 서버의 `normalizeProgressSnapshot`은 기존 오류 경계를 유지한다.

화면은100dvh 작업 공간의 중앙 채팅·하단 공통 입력과 오른쪽 자료·병원·이동·방문 계획 네 상태다. 좁거나 낮은 창은 같은 대화/준비 패널을 전환한다. 제목 아이콘·핵심 요약 뒤 상세를 펼치며 중앙 대화와 전체 준비 영역에서 읽고 카드별 세로 스크롤은 만들지 않는다. 전체 답변은 중앙 한 곳에만 표시한다. 진행 DTO는 최종 caseState가 아니다. 화면은 마지막 확인된 사실과 실제 실행 관측을 구분하고, 원래 응답을 받은 뒤 사례를 갱신한다. 중지·완료·새대화·재시도에서 늦은 진행도 무시하며 중지는 서버중단이 아니다. 요청id/원문/이력/설정은 재시도에 보존하고 비업무메타데이터인progressToken은 HTTP시도마다 새로 만든다. 이 토큰을 모델/세션/로그/URL/최종응답에 넣지 않는다. [고정 DTO와 범위](../docs/preparation-board-contract.md)를 따른다.

## 현재 할 일과 안전한 이어가기

`getPreparationWorkflow(caseState)`의 현재 작업·단계 상태·안전한 다음 행동을 UI와 도구가 공유합니다. `guidedPreparation`은 선택적 boolean입니다. absent/false는 기존 지문과 실행을 보존하고 true는 별도 본문 지문으로 비교합니다. 신규 UI는 true를 포함한 원래 본문으로 재확인합니다.

true인 명시적 방문 준비 요청에서 모델이 일찍 종료하면 동일45초/16도구 안에서 남은 공개자료 기반 택시·동행 문의 초안을 최대2개 dispatcher로 이어 준비할 수 있습니다. 실제 도구 수·진행·이벤트와 수행 사실을 응답에 반영합니다. 조회만 한 요청·명시적 제한·빠진 필수 조건·기존 실패/인계/재확인을 존중하며 전화/기록/동의/예약 도구로 확대하지 않습니다. resume/진행 조회/단계 탐색은 읽기 전용입니다. 새 DB 상태·endpoint·모델·provider를 추가하지 않습니다. 요청이 날짜·시각·출발지역·병원·지원조건 변경을 언급했는데 해당 도구의 갱신을 확인하지 못하면 예전 조건의 자동 초안을 보류합니다. 보수적인 조건 탐지라 같은 날짜를 다시 말해도 갱신이 없으면 보류할 수 있으며 자연어 전반을 이해하는 별도 파서는 아닙니다. 건강기록 미연결·의료진 확인 필요는 남기되 독립된 지원 초안을 막지 않습니다.

현재 크레딧 소진으로 새 Prompt·자동 이어가기의 실모델 평가는 보류했습니다. fixture/provider 및 keyless HTTP 검증과 과거 실모델12과업을 구분하며 이전 UI-only 불변 예외를 재사용하지 않습니다. [계약](../docs/guided-visit-contract.md)과 [최신 검증](../docs/implementation-results.md)을 따릅니다.

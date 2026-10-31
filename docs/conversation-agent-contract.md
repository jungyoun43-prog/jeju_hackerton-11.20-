# 대화로 진행하는 보호자 Agent 전환 계약

2026-10-31. 사용자는 보호자가 텍스트·음성으로 요청하면 기록 연계·병원 AI 전화·택시·동행 준비가 이어져야 하며, 직접 클릭하고 폼을 채우는 화면은 줄여야 한다고 설명했다. 기존 상태 엔진과 데이터는 Agent의 도구로 재사용한다. 현재 수동 작업 화면은 개발 검증용으로 보존하고 서비스 첫 화면을 대화로 바꾼다.

## 제품 동작

보호자 요청 → 기존 사례 확인 → 부족한 핵심 정보만 질문 → 공공데이터 검색 → 문의·자료·이동·동행 준비 도구 실행 → 처리 기록·다음 행동 설명. 사용자가 같은 정보를 다른 화면에 재입력하지 않는다. 날짜/지역/기관이 바뀌면 이전 문의 응답을 재확인한다. 진료 판단은 의료진의 역할이다.

후속 요청으로 사용자는 키만 넣으면 실행되는 OpenAI 템플릿과 Sol/Terra를 지정했다. 루트 .env의 OPENAI_API_KEY로 기본 gpt-6.1-sol 또는 선택 gpt-6.1-terra를 Responses API에 연결한다. 실제 키·계정은 검증하지 않으며 공급자가 없으면 일반 대화 요청은 `MODEL_NOT_CONNECTED`/503을 반환한다. 고정 예시는 별도 `POST /api/agent/preview`에만 두며 `scenarioId:'aewol-parent-visit'`과 requestId를 받는다. 자유 입력을 키워드로 처리한 뒤 실제 모델 응답처럼 표시하지 않는다. preview 응답은 아래 DTO에 `isPreview:true`, `previewMessages:[{role:'user'|'assistant',text:string}]`를 더한다. 마지막 assistant.text는 reply와 같다. 모델의 tool args는 검증하고 알려진 도구·출처·지원 상태만 사용한다. 기관 등록 정보에서 환자 적합성을 추론하거나 의료진 기록을 모델이 작성하지 않는다.

본인 인증·동의·허용 사업자 연계가 필요한 공단 기록을 공개 API로 가져올 수 있다고 가정하지 않는다. 이번 버전의 개인 진료기록과 통화는 **합성 사례·시연 어댑터**이며 실제 연결 상태와 구분한다. 실제 통화·예약·배차·결제·의료기록 조회 완료를 거짓 표시하지 않는다. 실제 사업자 키·인증·의료기관 계약이 필요한 어댑터는 미설정 상태를 반환한다.

## API — 모든 작업자가 고정

same-origin `POST /api/agent`, `GET /api/agent/capabilities`.

요청 JSON:

```js
{message:string,sessionId?:string,history?:[{role:'user'|'assistant',text:string}],requestId:string}
```

응답 JSON:

```js
{
 sessionId:string,reply:string,caseState:object,
 events:[{id:string,tool:string,label:string,status:'completed'|'needs_input'|'not_connected'|'error',detail:string,isSimulation:boolean,source?:string}],
 pendingActions:[{id:string,kind:string,label:string,reason:string}],
 capabilities:{llm:boolean,model:string,phone:'simulation'|'not_connected'|'connected',healthRecords:'demo'|'not_connected'|'connected',voiceInput:'browser'},
 requestId:string,needsInput:boolean
}
```

오류는 `{error:{code,message},requestId}`와 적절한 HTTP 상태를 반환한다. 사용자에게 SDK 에러·ARN·인증값·stack을 노출하지 않는다. 입력은 길이·형식을 제한한다. 프런트가 body의 SHA256을 `x-amz-content-sha256`으로 보내 Lambda OAC 경로와 호환한다. API 응답은 no-store다. 한 요청에서 무제한 루프·토큰·재시도를 허용하지 않는다.

Lambda는 `agent/handler.mjs`의 `handler(event)`를 사용한다. 로컬 서버는 같은 모듈의 `handleAgentRequest({method,path,body,headers})`를 호출한다. 반환형은 `{statusCode,headers,body:<JSON 문자열>}`이다. body 입력은 파싱된 객체 또는 UTF-8 JSON 문자열을 허용한다. 내부 테스트는 모델·session store 주입으로 실제 유료 호출과 구분한다.

## 서버·데이터·모델

기존 app/domain.js·visit-support.js·support-data.js와 정적 snapshot을 재사용한다. Agent의 tool dispatcher가 validated action을 실행한다. 모델이 프런트 caseState를 임의로 신뢰하지 않는다. session store는 초기 합성 사례와 정규화된 준비 상태만 보관하고 입력 원문·실환자 기록·대화 전문을 로그/DB에 저장하지 않는다. 이력은 브라우저 메모리에만 둔다.

AWS 런타임은 모델과 영속 저장을 기본 비활성화한다. Bedrock 실제 호출은 계정 Error 002로 차단됐으며 사용자 요청에 따라 추가 시도 없이 연결을 보류했다. 모델 목록 조회는 사용 가능 증거가 아니다. OpenAI 어댑터는 키가 있을 때 구성하고 자동 대체 없이 지정 모델만 사용한다. 로컬 .env는 AWS에 자동 게시하지 않는다. 이번 데모에 실제 공단 기록을 전송하지 않는다. 모델 API 키를 frontend에 넣지 않는다. 공급자 주입 테스트에서 세션/턴·도구 루프·maxTokens 상한을 검증한다. session store도 주입 인터페이스만 두며 DynamoDB 저장 어댑터는 구현·활성화하지 않는다.

## UI

첫 화면에 요청 입력·음성 시작·대화·Agent의 처리 기록·사례 요약이 있다. 택시업체 선택, 응답 분기 선택, 자료 상태 체크박스를 보호자가 순서대로 클릭하지 않는다. 진행 요약은 읽기 중심이고 Agent 응답과 같은 caseState에서 갱신한다. 세부 이력·출처·시연 표시를 필요할 때 볼 수 있다. 마이크가 지원되지 않으면 텍스트로 계속할 수 있고 음성이 실제 전화 발신이라는 인상을 주지 않는다. 브라우저 권한을 우회하지 않는다. 로고는 기존 PNG를 유지하고 의사 이미지를 다시 넣지 않는다.

기존 수동 앱은 `app/workspace.html`에서 개발용으로 실행하며 루트 진입점은 대화 UI다. 수동 앱의 도메인 테스트·브라우저 시나리오는 보존한다. 새 대화 UI는 별도 파일과 검증을 사용한다.

## 파일 소유권

| 작업 | 브랜치·기준 | 수정 가능 파일 |
| --- | --- | --- |
| conversation-agent | feature/conversation-agent · 8ab0db8 | agent/**, prompts/**, tests/agent*.test.mjs, scripts/build-agent.mjs |
| conversation-ui | feature/conversation-ui · 8ab0db8 | app/index.html, app/workspace.html, app/conversation.js, app/conversation.css, DESIGN.md, .impeccable/design.json |
| agent-api | deploy/agent-api · 8ab0db8 | infra/aws-agent-api.yaml, infra/aws-static-site.yaml, scripts/aws-agent-bootstrap.mjs, scripts/aws-agent-publish.mjs, tests/agent-infra.test.mjs, .github/workflows/deploy-aws.yml, .github/workflows/ci.yml |
| root | main | 패키지/잠금 파일·로컬 서버·공통 계약·자료조사·명세·기타 검사·통합·배포 |

작업자는 전용 worktree와 브랜치에 커밋한다. 새로운 라이브러리는 root에 알려 root가 package 파일을 갱신한다. 공유 interface 변경은 root에게 먼저 알린다. root만 실제 AWS/GitHub 변경을 적용한다.

## 검증

고정 예시에서 실제 공공 snapshot 도구와 준비 상태 변경을 확인하고, 일반 입력의 연결 미설정 안내·입력 복원, 주입한 공급자의 tool loop·부족 정보 질문·날짜 변경 재확인·인자/출처 검증·오류·타임아웃·budget·중복 요청을 확인한다. 주입 테스트는 실제 모델 품질 검증과 다르다. 음성 API mock 검사는 실제 마이크 인식 검증과 구분한다. 실제 AWS 배포·동일 SHA·PC/모바일 대화 화면을 확인한다. 템플릿 검사는 실제 LLM 추론을 뜻하지 않으며 실제 계정 호출·병원 발신·개인 기록 연계는 별도 후속 검증으로 명시한다. 광범위 데이터 감사 결과는 별도 연구 자료로 보존하며 모두 구현하지 않는다.

## OpenAI 키 입력형 후속 범위

2026-10-31. 기본 Sol·선택 Terra는 별도 ID이며 공식 원문은 research/openai_api_setup_2026-10-31.md에 기록했다. strict:false와 기존 dispatcher 검증을 함께 사용한다. request-scoped provider context로 reasoning/encrypted 항목을 다음 도구 결과와 replay하고, 이를 HTTP·세션·로그에 저장하지 않는다. Native fetch를 고정 공식 endpoint에만 보내며 redirect·자동 재시도·모델 fallback을 하지 않는다. 루트는 .env/config/handler/service/문서/통합을 담당하고 feature/openai-provider(기준36a354b)는 agent/openai-provider.mjs·tests/openai-provider.test.mjs만 수정한다. 실제 키를 읽거나 유료 API를 호출하지 않고 fixture로 검증한다.

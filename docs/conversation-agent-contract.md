# 대화로 진행하는 보호자 Agent 전환 계약

2026-10-31. 사용자는 보호자가 텍스트·음성으로 요청하면 기록 연계·병원 AI 전화·택시·동행 준비가 이어져야 하며, 직접 클릭하고 폼을 채우는 화면은 줄여야 한다고 설명했다. 기존 상태 엔진과 데이터는 Agent의 도구로 재사용한다. 현재 수동 작업 화면은 개발 검증용으로 보존하고 서비스 첫 화면을 대화로 바꾼다.

## 제품 동작

보호자 요청 → 기존 사례 확인 → 부족한 핵심 정보만 질문 → 공공데이터 검색 → 문의·자료·이동·동행 준비 도구 실행 → 처리 기록·다음 행동 설명. 사용자가 같은 정보를 다른 화면에 재입력하지 않는다. 날짜/지역/기관이 바뀌면 이전 문의 응답을 재확인한다. 진료 판단은 의료진의 역할이다.

실제 LLM의 도구 호출 루프를 구현한다. 키워드 분기·미리 정한 답변만을 실제 모델 Agent로 표시하지 않는다. 실패·연결 미설정은 명시한다. 모델의 tool args는 검증하고 알려진 도구·출처·지원 상태만 사용한다. 기관 등록 정보에서 환자 적합성을 추론하거나 의료진 기록을 모델이 작성하지 않는다.

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

Lambda는 `agent/handler.mjs`의 `handler(event)`를 사용한다. 로컬 서버는 같은 모듈의 `handleAgentRequest({method,path,body,headers})`를 호출한다. body는 파싱된 객체 또는 UTF-8 JSON 문자열을 허용한다. 내부 테스트는 모델·session store 주입으로 실제 유료 호출과 구분한다.

## 서버·데이터·모델

기존 app/domain.js·visit-support.js·support-data.js와 정적 snapshot을 재사용한다. Agent의 tool dispatcher가 validated action을 실행한다. 모델이 프런트 caseState를 임의로 신뢰하지 않는다. session store는 초기 합성 사례와 정규화된 준비 상태만 보관하고 입력 원문·실환자 기록·대화 전문을 로그/DB에 저장하지 않는다. 이력은 브라우저 메모리에만 둔다.

AWS 런타임은 실제 사용 가능한 Bedrock 모델을 조회·한국어/도구 호출 검증 후 선택한다. inference profile의 지역 범위를 기록한다. 이번 데모에 실제 공단 기록을 전송하지 않는다. 모델 API는 IAM role을 사용하고 frontend에 키를 넣지 않는다. 공개 데모의 호출 수·세션/턴·도구 루프·maxTokens에 상한을 둔다. DynamoDB는 필요 시 정규화된 합성 사례 상태와 날짜별 사용량만 저장하며 TTL을 설정한다.

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

한국어 자연어 입력→실제 모델 응답→실제 데이터 도구 호출과 상태 변경, 부족 정보 질문, 날짜 변경 재확인, tool 인자/권한/출처 검증, 공단·전화 미설정/시연 표시, 개인정보 최소화, 모델 오류·타임아웃·budget초과·중복 요청을 확인한다. 음성 API mock 검사는 실제 마이크 인식 검증과 구분한다. 실제 AWS 배포·동일 SHA·PC/모바일 대화 화면을 확인한다. 광범위 데이터 감사 결과는 별도 연구 자료로 보존하며 모두 구현하지 않는다.

# OpenAI 연결 템플릿의 공식 근거

확인일: 2026-10-31. OpenAI Docs 지침에 따라 공식 문서를 검색하고 insane-search로 아래 네 원문을 읽었다. 원문을 검토했으며 검색 요약만으로 모델 ID를 확정하지 않았다.

- [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol): API ID `gpt-6.1-sol`. 도구 호출은 Responses API를 사용한다.
- [GPT-6.1 Terra](https://developers.openai.com/api/docs/models/gpt-6.1-terra): 별도 API ID `gpt-6.1-terra`. 두 모델 모두 함수 호출을 지원한다.
- [Function calling](https://developers.openai.com/api/docs/guides/function-calling): 함수 정의·function_call·function_call_output의 call_id 연결, 도구 결과와 reasoning 항목 재전달을 확인했다. 기존 선택적 도구 인자를 유지하도록 strict:false와 자체 dispatcher 검증을 사용한다.
- [Responses 전환 안내](https://developers.openai.com/api/docs/guides/migrate-to-responses): 수동 input/output replay와 store:false, reasoning/encrypted 항목 보존, Responses의 함수 정의 형식을 확인했다.

기본은 Sol이며 환경변수로 Terra를 선택하고 동시 호출·자동 모델 대체를 하지 않는다. 템플릿·mock fetch·도구 루프는 검증하되 실제 키 조회·유료 API·계정 권한·모델 품질을 확인했다고 주장하지 않는다. 로컬 .env는 제출·빌드에 포함하지 않는다.

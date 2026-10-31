# 이동 기본 설정·Agent 독립 검토

대상: root `e601d25cf38ee9c3e296c52f1e32b440b7b16eda` — 2026-10-31 UTC.

결론: **검토 범위에서 새로 도입된 material blocker를 확인하지 못했다.** 처음 제기한 `applyPreferences:false`의 택시 선택 변경은 통합 담당자가 확인한 의도된 분리 계약이므로 blocker에서 제외했다. 아래의 플래그 의미와 시간 한도 표현은 UI·문서에서 정확히 유지해야 한다.

프로젝트 `.env`, 실제 키·인증정보를 읽지 않았고 네트워크, AWS, 유료 API를 사용하지 않았다. 저장소 소스·테스트·UI를 수정하지 않았다. OpenAI Docs 스킬 지침은 읽었으나 이 작업의 네트워크 금지 범위에 따라 외부 문서/API 검증은 하지 않았다. 현재 API의 계정 지원·실제 응답 품질을 검증한 결과가 아니다.

## 검증 근거

선택한 5개 test 파일의 **75개 unit/stub 검사가 통과**했다.

```text
OPENAI_API_KEY= node --import 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("NETWORK_DISABLED_FOR_REVIEW")}' --test --test-skip-pattern='Node env-file 부팅' --test-reporter=spec tests/care-preferences.test.mjs tests/agent.test.mjs tests/agent-config.test.mjs tests/openai-provider.test.mjs tests/dynamodb-store.test.mjs
exit 0 · selected tests 75 · pass 75 · fail 0
```

네트워크 차단 guard를 사용했다. env-file 부팅 검사는 localhost fetch까지 필요하므로 제외했다. 첫 실행의 negative name-pattern은 해당 검사를 제외하지 못해 guard가 `NETWORK_DISABLED_FOR_REVIEW`로 막았으며, 그 1건은 제품 실패가 아니다. 생성된 것은 해당 기존 테스트가 만든 임시 fixture 파일뿐이고 실제/root `.env`를 사용하지 않았다. skip 옵션으로 교정한 위 실행은 정상 통과했다.

기존 테스트 외에 stdin에서 다음을 독립 확인했다. DDB는 `tests/dynamodb-store.test.mjs`의 원자적 조건식 fake client를 재사용했고 실제 SDK 네트워크 client를 생성하지 않았다.

| 항목 | 관측 결과 |
|---|---|
| 선호 6 + 적합한 명시 provider 14 | 실제 초안 provider `taxi327-14` — 명시 provider 우선 |
| 방문 조건을 휠체어 필요·동행 불필요로 변경 후 반대 기본값 + false | DDB 저장·복원 뒤에도 `wheelchair:true`, `companionNeeded:false` 유지 |
| 휠체어 조건에서 일반 선호 택시 | `jeju-accessible-transport` 문의 경로 우선, 이용자격·차량 확정은 없음 |
| 같은 session/requestId, 다른 preferences·본문 재전송 | 추가 provider 호출 0, 기존 상태 그대로, budget 총 3턴 |
| DDB 상태 필드 | `pk,sessionId,state,turns,requestIds,expiresAt`만 보존; preferences·private context·입력 marker 없음 |
| 권한 | 위 과정 전후 `inquiry:true,share:false` 유지. 별도 기존 테스트에서는 inquiry:false도 false 유지 |
| dailyTurns 직접 config=1000 | store가 실제로 받은 한도는 80 |

## 경계별 판정

- **입력 허용 목록:** `app/care-preferences.js:9–18`은 공개 taxi-kind ID 또는 auto와 boolean 2개, 정확한 키 3개만 허용한다. `agent/validation.mjs:20,33–39`가 요청 경계에서 strict 정규화하고 임의 권한/필드/ID/자료를 모델 호출 전에 거절한다. 실제 문의처 ID 선택이며 provider 객체·URL·진단·자유 텍스트를 저장하는 경로가 아니다.
- **지역/휠체어:** `agent/tools.mjs:170–196`이 현재 사례의 지역 후보 안에서 명시 provider → 선호 → 현재 → 기본 순으로 고르고, 휠체어이면 accessible 문의 경로를 우선한다. 지역 밖 선호는 대체 이유를 반환한다. 현재 조건을 기준으로 다시 검증하므로 기기 기본값이 오래됐다는 이유로 현재 휠체어 상태가 사라지지 않는다.
- **동의:** `agent/service.mjs:73–75`는 지원 요구 boolean만 reducer에 전달한다. `permissions`를 수정하지 않는다. 지원·병원 시연 문의는 기존 권한 검사(`tools.mjs:150,205`)를 유지한다. 기본 설정을 전화 위임이나 자료 공유 동의로 취급하지 않는다.
- **DDB/구형 client/재시도:** 새 preferences는 request-scoped이며 저장 DTO를 넓히지 않는다. 기존 preferences 없는 요청은 정상이고 새 필드도 optional이다. 중복 검사가 preference 적용·budget·모델보다 먼저 실행된다(`service.mjs:61–74`). DDB 고정 사례 검증과 lease/원자적 UTC budget은 유지된다(`dynamodb-store.mjs:64–119,154–170,225–252`).
- **마지막 요약:** 실제 runtime 경로는 `maxRounds:8,maxTools:16`이다(`config.mjs:34`). 마지막 호출 또는 도구 한도 다음 호출에서 `toolChoice:none`을 강제하며 추가 도구 호출은 거절한다(`service.mjs:77–99`). 미실행 도구에는 error 결과와 확인 필요 이벤트만 남긴다. 최종 텍스트가 유효하면 이미 실행한 state만 저장한다. 8개 순차 준비 계획 fixture에서는 **7개 도구 + 8번째 모델 요약**이며 예정된 8번째 도구는 실행하지 않았다(`tests/agent-config.test.mjs:78–119`). 실행하지 않은 작업을 고정 성공 문장으로 만들어 HTTP200을 주는 fallback은 없다.
- **reasoning:** `openai-provider.mjs:172–191`은 같은 도구 정의를 유지한 채 `tool_choice:none`으로 전환한다. encrypted reasoning·원래 call_id·tool 결과 replay를 보존하며 request-scoped WeakMap handle만 사용한다. 실제 HTTP/세션에는 context가 들어가지 않는다. 새 턴에 과거 provider context가 자동 재사용되지 않는 회귀도 통과했다.
- **상한:** 서비스의 설정은 45,000ms·일일80보다 큰 값으로 올릴 수 없고 DDB 역시 80 초과 limit을 거절한다. 전역80은 HTTP 대화 turn이고 내부 Responses 최대8회와 구분된다. 동시에 100개 요청을 보낸 fake 두-store 시험에서80개만 소비하는 기존 회귀가 통과했다.

## 의도 확인으로 해소한 가설

### H1 — applyPreferences:false인데 선호 택시가 바뀌는가?

**재현은 됐지만 의도된 계약으로 해소.** 첫 세션이 `taxi327-6`일 때 다음 요청에 preferences의 taxi ID=14와 applyPreferences:false를 보내고 기본 provider로 초안을 다시 준비하면 14가 선택된다. 이때 `preferencesApplied:false`, `apply_care_preferences` 이벤트는 없다.

코드는 `service.mjs:71–75`에서 **휠체어·동행 필요 재적용만** 플래그로 제어하며, `tools.mjs:176–180`은 **매 요청 선호 택시를 providerId 생략 시 fallback으로** 사용한다. 통합 담당자는 원문 preferences를 DDB에 저장하지 않으므로 여러 턴에 걸친 기본 택시 선택을 위해 이 분리가 필요하다고 확인했다.

따라서 false를 ‘선호 택시까지 전부 미적용’으로 표시하면 UI 계약이 어긋난다. 새 세션은 applyPreferences:false여도 전달된 휠체어/동행 기본값을 적용한다(`tests/agent.test.mjs:251`). UI는 방문의 현재 이동 조건과 기기의 기본값, 매 요청 택시 fallback의 의미를 구분해야 한다.

### H2 — 45초가 HTTP 전체 응답의 엄격한 상한인가?

**기존 구현의 표현 한계 확인. 신규 regression 아님.** 작업 controller는 45초지만 `service.mjs:127–134`의 finally가 lease release를 별도 최대2.5초 기다린다. 축소한 20ms 작업 deadline과 영원히 대기하는 release stub에서 HTTP504까지 **2523ms**가 걸렸다. 따라서 정확한 표현은 ‘모델·저장 작업 deadline45초, 정리에 최대2.5초 추가’이다. HTTP 총45초라고 단정하면 현재 구현과 다르다.

최종 요약 역시 시간 초과·공급자 오류·불완전 응답까지 포함해 항상 성공 저장되는 보장은 아니다. 그런 오류에서는 안전하게 실패하며 이전 저장 상태를 유지한다. 이번 변경이 보장하는 것은 호출/도구 한도 도달 전에 요약 기회를 예약하는 경계이다.

## UI 통합 때 깨질 수 있는 기존 검사·경계

이 항목은 현재 backend blocker가 아니며 UI/QA를 수정하지 않았다.

1. `scripts/conversation-browser-check.mjs:60`은 select·checkbox가 전혀 없고 특정 이미지 class도 없다고 검사한다. 새 선택 설정·이미지의 존재 자체를 금지하는 구검사이며, ‘설정이 대화의 필수 단계인가’를 확인하는 검사로 재정의할 필요가 있다.
2. `conversation-browser-check.mjs:87`의 visible `.tool-record` 대기와 `app/conversation.js:126`의 기본 open을 가정한다. 새 기본 접힘 처리 기록은 summary를 펼친 뒤 내용/출처를 검사해야 한다. DOM count만으로 가독성을 판정하면 안 된다.
3. `conversation-browser-check.mjs:83,109–110`은 새 대화 버튼을 누르면 바로 초기화된다고 가정한다. 확인 dialog가 생기면 승인/취소 경로를 각각 거쳐야 한다. DOM 한 번 클릭만으로 reset을 기대하지 않는다.
4. `conversation-browser-check.mjs:59`는 폰트 이름 MaruBuri를 고정한다. 새 폰트 방향과 실제 등록/로드 확인을 일치시켜야 한다.
5. preview API는 `scenarioId,requestId`만 받는다(`validation.mjs:41–45`). 일반 요청에 preferences를 붙이는 공통 처리로 preview body까지 넓히면 거절된다.
6. 기존 재시도는 저장된 request body 전체를 재사용한다(`conversation.js:239,261,362`). preferences와 applyPreferences도 최초 payload/hash에 고정하고, 실패 뒤 설정을 바꿔도 ‘같은 요청 다시 확인’의 본문·ID를 바꾸면 안 된다.
7. UI는 매 정상 요청에 현재 3개 preference 값을 보내야 한다. true는 기존 방문의 휠체어·동행 필요를 재적용할 때 사용하고, false는 대화에서 바꾼 현재 이동 조건을 지켜야 한다. 부분 preference payload는 strict 검증에서 거절된다.
8. 지역을 바꿔 기존 선호 ID가 현재 옵션 목록에서 사라져도 해당 ID는 전체 공개 목록의 유효한 값일 수 있다. selector가 임의로 첫 항목으로 바뀌었다고 표시하지 말고 서버의 지역 대체 이유와 실제 선택된 문의처를 구분해야 한다.

## 한계·정리

실제 Sol 응답, 계정 접근, 45초 실제 외부 API 경과, AWS DDB 동작·배포는 실행하지 않았다. stub 모델의 답변 내용으로 일반 모델 품질이나 임상 정확성을 보장하지 않는다. 첫 검사의 임시 child는 기존 테스트 finally에서 종료/임시 파일 삭제를 수행했으며, 추가 서버·브라우저·네트워크 세션은 남기지 않았다. 이후 검사는 모두 in-process fixture만 사용했다. 독립 보고서 외 저장소 변경은 없다.

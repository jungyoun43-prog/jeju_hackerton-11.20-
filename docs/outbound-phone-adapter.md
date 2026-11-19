# 비활성 기본값의 운영자 전화 어댑터

작성·공식 문서 확인: 2026-11-18.

이 구현은 Twilio가 상대 번호로 먼저 발신하고, 양방향 Media Streams와 OpenAI Realtime을 연결하는 **운영자 전용 서버 코드**다. 일반 혼디 앱·브라우저·모델 도구에 발신 API를 추가하지 않는다. 기본 `start(request)`는 외부 전송 없는 dry-run이다. 이번 구현·검증에서는 실제 네트워크, 키, 전화 계정, 발신, 유료 API를 사용하지 않았다.

피클처럼 전화로 조건을 묻고 일정을 조율하는 형태를 구현했지만 피클의 API·코드·비공개 기능을 사용하지 않는다. 실제 통신사 계정·기관 응대·한국 전화번호 발신 가능 여부·요금·법적 적합성·AWS 배포는 검증하지 않았다.

## 파일과 의존성

| 파일 | 역할 |
| --- | --- |
| `agent/phone-policy.mjs` | 운영자 요청·위임·번호·처리정책·시간·비용 검사, AI 지침, 결과 스키마 |
| `agent/phone-twilio.mjs` | Calls REST 생성/종료, inline TwiML, 고정 URL 기반 서명 검증 |
| `agent/phone-bridge.mjs` | PCMU 음성 전달, 재생 mark, 끼어들기, AI 수락·결과 tool |
| `agent/phone-adapter.mjs` | 요청 수명·취소·콜백·Stream 결합·늦은 생성·종료 처리 |
| `agent/phone-ledger.mjs` | 로컬 원자적 grant 잠금, UTC 하루 최대 3회, 동시 1회 |
| `agent/phone-operator-server.mjs` | callback/WS 수신 전용 listener. 자체 listen·발신 route 없음 |
| `tests/phone-adapter.test.mjs` | fake fetch/socket/clock 및 임시 ledger 단위 검증 |

Node.js 22 이상을 전제로 한다. 운영용 WebSocket 연결과 listener를 위해 루트에 `ws` 8.23.0을 추가했다. Twilio SDK 없이 공식 HMAC-SHA1 규칙을 구현하고 공식 예제 서명으로 검증했다. 지원하는 콜백 본문은 `application/x-www-form-urlencoded`이며 JSON 서명 변형을 지원한다고 주장하지 않는다.

## 운영자 CLI와 listener

`scripts/phone-operator.mjs`의 동작:

| 인자 | 동작 |
| --- | --- |
| 없음 / `--dry-run` | `env:{}`로 합성 요청을 준비한다. 키가 설정되어 있어도 외부 전송하지 않는다. |
| `--listen` | callback/WS 수신만 시작한다. 발신 요청 route가 없다. |
| `--live --request <로컬 manifest 경로>` | 운영자가 검증한 manifest와 모든 live guard가 맞을 때 1회 시도한다. 이번 작업에서는 실행하지 않았다. |

listener는 기본 loopback `127.0.0.1:4190`에 연결하는 별도 프로세스이며 공개 HTTPS/WSS 주소·TLS·역방향 프록시는 운영자가 따로 구성한다. 일반 `scripts/server.mjs`나 제품 화면의 시연 버튼은 이 listener를 호출하지 않는다. CLI에서 프로세스 종료 신호를 `dispose()`에 연결한다. 라이브 요청 파일은 환자 원문을 보관할 용도로 쓰지 않으며 별도 접근 통제를 적용해야 한다.

`npm run phone:preview`를 실행해 `actualCallPlaced:false`인 준비 결과를 확인했다. CLI는 `.env`를 자동으로 읽지 않는다. live를 실행할 때는 운영자가 별도 프로세스 환경을 제공해야 하며 이번 작업에서는 실행하지 않았다. 로그에는 상태·고정 결과 enum만 출력하고 상세 결과는 factory의 `onReceipt` 또는 runner의 반환 `receipt`에서 읽는다. 종료 여부가 불명확하면 callback listener가 남아 있을 수 있으므로 운영자가 공급자에서 상태를 확인해야 하며 자동 재발신하지 않는다.

허용하는 수신 경로는 `POST /phone/status/<무작위 token>`과 WebSocket `/phone/media`뿐이다. 요청 Host·Forwarded 헤더로 공개 URL을 추측하지 않는다. `PHONE_PUBLIC_ORIGIN`의 정확한 HTTPS origin과 고정 경로를 서명 검증에 사용한다. Media Stream의 연결 URL은 같은 origin의 `wss:` 형태다. **실제 Twilio WS handshake와 프록시의 HTTPS/WSS canonical URL 대응은 아직 실연동 검증하지 않았다.** 공개 주소의 경로·포트·리다이렉트 변경을 자동 보정하지 않는다.

## 활성화 설정

두 guard가 모두 일치해야 live가 가능하다. 아래는 설정 이름·요구값 설명이며 실행한 설정이 아니다.

| 환경변수 | 요구값 |
| --- | --- |
| `PHONE_OUTBOUND_ENABLED` | 정확히 `true` |
| `PHONE_OUTBOUND_LIVE_ACK` | 정확히 `I_UNDERSTAND_THIS_PLACES_REAL_CALLS` |
| `PHONE_ALLOWED_NUMBERS` | 운영자가 확인한 E.164 수신 번호의 쉼표 목록 |
| `PHONE_PUBLIC_ORIGIN` | 경로·query·userinfo 없는 공개 HTTPS origin |
| `TWILIO_ACCOUNT_SID` | 서버의 Twilio 계정 SID |
| `TWILIO_AUTH_TOKEN` | 서버의 현재 primary Auth Token |
| `TWILIO_FROM_NUMBER` | 검증된 E.164 발신 번호 |
| `OPENAI_API_KEY` | 서버의 Realtime 접근 키 |
| `PHONE_PORT` | 통합 CLI의 loopback 포트. 기본 4190 |

어댑터는 `.env`나 자격증명 파일을 읽지 않는다. 운영자가 제공한 `env` 또는 프로세스 환경만 사용한다. 키·모델명·원문 공급자 오류·번호·Stream token·CallSid는 반환 receipt에 넣지 않는다. 콜백 token은 공급자에게 전달되는 URL/Stream parameter이므로 프록시 access log에서도 반드시 경로를 마스킹하거나 해당 route의 로그를 끈다. 어댑터 자체는 로그를 남기지 않는다.

## API

```js
import {createPhoneAdapter} from '../agent/phone-adapter.mjs';
const adapter = createPhoneAdapter({env: {}});
const receipt = await adapter.start(request); // 기본 dry-run. 발신하지 않는다.
await adapter.dispose();
```

`createPhoneAdapter({env, fetchImpl, connectRealtime, ledger, now, setTimer, clearTimer, makeToken, onReceipt})`

- `fetchImpl`은 테스트 또는 운영용 fetch다. adapter는 Calls 생성 요청을 재시도하지 않는다.
- `connectRealtime({apiKey})`는 `on/removeListener/send/close/readyState/bufferedAmount`를 제공하는 ws 호환 객체의 Promise다. 기본 connector는 live guard 뒤에만 `ws`를 동적으로 읽고 OpenAI에 연결한다.
- `ledger` 생략 시 `.runtime/outbound-phone`의 파일 ledger를 사용한다. 사용자 지정 ledger는 `persistent:true`, 원자적 `reserve({grantKey})`, `release({grantKey,terminalConfirmed})` 계약이 필요하다. 단순 메모리 ledger를 운영용으로 제공하지 않는다.
- `onReceipt`는 민감 원문 없는 상태/결과 스냅샷을 받는다. 콜백 예외가 통화 정리를 방해하지 않는다.

| 메서드 | 반환·의미 |
| --- | --- |
| `start(request, {mode='dry-run', signal})` | 준비 또는 1회 live 발신 시도 receipt. 실패는 안전한 `PhoneAdapterError`만 던진다. |
| `getReceipt(requestId)` | 메모리의 현재 상태. 모르는 ID면 null. 조회는 실행하지 않는다. |
| `end(requestId)` | 생성 취소·음성 소켓 종료·알려진 CallSid hangup. 같은 종료는 중복 발신하지 않는다. |
| `handleStatusCallback({url,headers,body})` | 정확한 외부 HTTPS URL과 원래 form 문자열, lower-case signature header. 인증 후 `{ok:true}`. |
| `acceptMediaSocket({socket,url,headers})` | WS handshake의 고정 HTTPS canonical URL을 검증하고 start 이벤트를 기다린다. 인정 여부 boolean. |
| `dispose()` | 새 요청 차단, 수신 대기 소켓 종료, 모든 알려진 통화 hangup. Promise를 await한다. |

`createPhoneOperatorServer({adapter,publicOrigin,WebSocketServerImpl})`는 `{server,dispose}`를 반환한다. 구성만으로 listen하거나 발신하지 않는다. host는 `server.listen()`을 명시적으로 호출하고 외부 TLS와 종료 신호를 맡는다.

## 요청 계약

manifest는 **인증된 운영자 입력 전용**이다. 아래 boolean은 실제 위임을 인증하는 기술이 아니라 운영자가 별도로 확인한 근거에 대한 명시적 확인값이다. 브라우저 요청이나 LLM 출력으로 생성·승인하면 안 된다. 가상 사례의 `permissions.inquiry` 또는 기존 `realDelegationVerified:false`를 이 값으로 바꾸지 않는다.

| 필드 | 조건 |
| --- | --- |
| `requestId` | 8~100자의 영문·숫자·`_`·`-` 식별자. 환자 정보 금지 |
| `purpose` | `hospital`, `taxi`, `companion` 중 하나 |
| `recipient` | `{phone,label,verified:true,verificationRef}`. 번호는 allowlist와 정확히 같아야 한다. |
| `caller` | `{phone,verified:true,verificationRef}`. 번호는 서버 발신 번호와 일치해야 한다. |
| `authorization` | 아래 필수 계약 참조 |
| `processing` | 아래 필수 계약 참조 |
| `schedule` | `{date,earliestTime,latestTime,timeZone:'Asia/Seoul',service}`. 유효한 날짜와 24시간제 시각, 최대 100자 서비스 설명 |
| `limits` | 아래 필수 계약 참조 |

`authorization`:

```js
{
  grantId: 'operator_one_use_grant', // 8~100자. 같은 grant는 재시작 후에도 재발신 불가
  verified: true,
  actor: 'patient', // 또는 authorized_representative
  revoked: false,
  recipientPhone: '<검증된 E.164 수신 번호>',
  purpose: 'hospital',
  maxAttempts: 1,
  scopes: ['call', 'minimum_disclosure', 'negotiate'], // book은 별도 예약 요청 권한이 있을 때만
  validFrom: '<ISO 시각>',
  validUntil: '<통화 최대 종료 시각보다 뒤인 ISO 시각>'
}
```

`processing`은 `verified:true`, `policyRef`, `recording:'off'`, `transcription:'ephemeral'`, `applicationRetention:'none'`, `providerRetentionVerified:true`, `crossBorderVerified:true`, `minimumDisclosureVerified:true`, `refusalAction:'handoff'`, 운영자가 검증한 `notice` 최대 900자를 요구한다. providerRetentionVerified는 공급자가 보관하지 않는다는 뜻이 아니다. 실제 Twilio/OpenAI의 처리·보관·국외 이전 조건을 운영자가 확인하고 notice에 반영했다는 계약이다. 이번 작업에서는 확인 완료로 간주하지 않는다.

`limits`:

```js
{
  maxDurationSeconds: 180, // 10~180
  ringSeconds: 15,        // 5~30. 공급자 문서상 ringing buffer가 추가될 수 있음
  windowStart: '<ISO 시각>',
  windowEnd: '<통화 최대 종료 시각보다 뒤인 ISO 시각>',
  cost: {
    currency: 'USD',      // 또는 KRW
    maxTotal: 2,
    perMinuteUpperBound: 0.5,
    fixedUpperBound: 0.2,
    verified: true,
    quoteRef: '<운영자가 확인한 합산 요율 근거>',
    validUntil: '<통화 최대 종료 시각보다 뒤인 ISO 시각>'
  }
}
```

위 금액은 스키마를 보여주는 합성 예시이며 실제 요율이 아니다. `ceil(maxDurationSeconds / 60) × perMinuteUpperBound + fixedUpperBound <= maxTotal`을 검사한다. 운영자는 통신·AI·세금·연결·추가 비용을 포함하는 보수적 상한을 별도로 검증해야 한다. 실시간 과금 조회나 공급자 계정의 금액 한도를 구현한 것은 아니므로 이 검사를 실제 청구액 보장으로 표시하지 않는다.

dry-run에는 `requestId/purpose/recipient.phone/recipient.label/schedule/limits`만 필요하고 위임·처리정책·키를 확인하지 않는다. 임의의 추가 request 필드는 모델이나 전송 요청에 복사하지 않는다. 모델에 전달하는 문의 조건은 위 schedule의 제한된 필드뿐이다.

## 통화·결과 경계

1. grant를 먼저 1회 사용 처리하고 동시 1회/UTC 일일 3회 제한을 확보한다. `POST Calls.json`에는 To/From, `TimeLimit`, 짧은 `Timeout`, `Record=false`, inline `<Connect><Stream>`과 뒤의 `<Hangup/>`, 상태 콜백을 넣는다. 재발신 retry는 없다.
2. Twilio 서명, 고정 accountSid, callSid, 일회성 token, streamSid, `audio/x-mulaw`/8000 Hz/mono/inbound를 확인한 뒤에만 OpenAI 소켓을 연다. REST 응답보다 Stream이 먼저 와도 동일 callSid로 결합한다. token을 다른 소켓에서 재사용할 수 없다.
3. Realtime은 GA `session.update`, `type:'realtime'`, `gpt-realtime-2.1`, `marin`, 입출력 `{type:'audio/pcmu'}`, 최대 출력 768 토큰을 사용한다. 처음에는 AI·처리 안내 수락 tool만 제공하고, 수락 이후에만 문의 조건과 결과 tool을 연다. 이는 모델 지침과 tool 경계이며 실제 상대의 이해·수락 품질을 임상·법률적으로 검증한 것이 아니다.
4. `input_audio_buffer.append`와 `response.output_audio.delta`의 μ-law base64를 변환 없이 전달한다. transcript 원문은 저장하거나 로그로 출력하지 않는다. 소켓 대기 버퍼도 짧게 제한한다.
5. 끼어들면 Twilio `clear`와 OpenAI `response.cancel`/`conversation.item.truncate`를 보낸다. truncate 길이는 Twilio가 재생 완료 mark로 확인한 바이트 수 ÷ 8 ms다. **현재 부분 재생 중인 chunk는 알 수 없으므로 보수적인 하한이며 밀리초 단위 실재생 측정이 아니다.** clear 뒤 돌려받는 미재생 mark와 이전 응답의 늦은 audio는 무시한다.
6. cancel/done 경합 중 해당 cancel event_id에 연결된 `response_cancel_not_active`만 무시한다. 수락 tool 뒤 후속 response.create는 현재 response.done을 기다린다. 일반 provider error는 계속 종료한다.
7. 본인확인·AI 거절·결제·목적 밖 요청은 `handoff` 후 종료한다. `report_call_result`는 허용 날짜·시각, 별도 book 권한, 참조번호를 검사한다. 일반 연결·completed callback은 결과를 만들지 않는다.

receipt의 `mode:'simulation', source:'outbound_phone_dry_run'`은 실행 없는 준비다. live 경로는 `mode:'real', source:'twilio_outbound_adapter'`지만 `actualCallPlaced`가 `null`이면 생성 결과 불명확, `true`면 공급자 CallSid 또는 인증된 이벤트로 발신 생성이 관측된 상태다. 이는 상대가 응답했다는 뜻이 아니다. **`reservationConfirmed`와 `clinicalAcceptanceConfirmed`는 항상 false다.**

별도 결과의 `source:'realtime_counterparty_report'`, `outcome:'reported_booked'`는 모델이 통화 상대의 예약 답변을 전달한 것이며 `requiresOperatorVerification:true`를 함께 둔다. 독립적으로 검증된 기관 영수증이 아니다. `available/unavailable/needs_followup/handoff`와 구별하고 시연의 가상 예약 receipt에 합치지 않는다.

## 종료·유실·보관

- 서버 최대 타이머는 요청 시작부터 최대 180초에 음성 소켓을 닫고 hangup한다. Twilio의 `TimeLimit`도 설정해 로컬 프로세스가 없어져도 공급자 시간 제한을 남긴다.
- 서버 종료, 소켓 실패, Stream 중단, Realtime 설정 실패, 범위를 벗어난 결과도 동일한 종료 경로를 쓴다. TwiML은 Stream이 끝나면 `<Hangup/>`으로 이어진다.
- 생성 타임아웃은 자동 재시도하지 않는다. abort를 무시하고 늦게 CallSid가 도착해도 hangup한다. hangup 응답 불명확/실패는 `terminationConfirmed:false`와 잠금을 유지한다.
- hangup의 HTTP 200만으로 종료를 확정하지 않는다. 동일 CallSid·accountSid와 terminal 상태의 응답 또는 인증된 terminal callback이 필요하다.
- REST 생성 완료 전 terminal callback이 와도 ledger를 조기에 해제하지 않는다. 서로 다른 CallSid는 정리를 시도하고 운영자 확인 전 잠금을 유지한다.
- ledger 파일에는 grant 해시·UTC 날짜·시도 횟수·고정 상태만 기록한다. 원래 grant/전화번호/키/환자 원문/대화/audio/모델 추론을 저장하지 않는다. 결과 receipt도 탭 DB나 앱 상태로 자동 저장하지 않는다.
- 알 수 없는 통화의 active 잠금은 재시작만으로 해제하지 않는다. 재시작 후 token과 결과는 복원하지 않으므로 `--listen`만으로 과거 전화를 이어 받을 수 없다. 운영자는 공급자 계정에서 종료 여부를 별도로 확인한 뒤 잠금을 다뤄야 한다. 자동 삭제·재발신 명령은 제공하지 않는다.
- 파일 ledger는 하나의 로컬 공유 디렉터리를 쓰는 운영자 배치용이다. 여러 컨테이너·호스트의 전역 한도나 운영자 인증 시스템을 구현하지 않았다.

## 검증과 미검증

`node --test tests/phone-adapter.test.mjs`는 현재 34개 검사가 통과했다. 테스트는 합성 번호·가짜 키, fake fetch/socket/clock, 정리되는 임시 파일만 쓴다. 실제 네트워크 구현을 호출하지 않는다.

기본 비활성, 권한·수신처·시간·비용 거절, 공식 HMAC 예제, Stream 결합·재사용 방지, PCMU 패스스루, mark 기반 끼어들기, 취소/응답 생성 경합, AI 수락 전 tool 차단, 결과와 completed 분리, 180초, 소켓/서버 종료, 생성 유실·늦은 성공, 종료 실패 잠금, 재시작 grant 및 일일 한도를 검사했다.

실제 발신·착신·국가별 통신사 설정·프록시/WS 서명·음질·상대 발화 인식·AI 거절 준수·조율 품질·실제 예약·실제 청구액은 미검증이다. 단위검사 통과를 실제 운영·의료·개인정보·대회 제출 전체 준비 완료로 확대하지 않는다.

## 공식 근거

통합 담당자가 Ego로 원문을 확인하고 루트 `output/phone-result-qa/`에 저장한 자료를 이 worktree에서 읽었다.

- [Twilio Call resource](https://www.twilio.com/docs/voice/api/call-resource): outbound 생성, TimeLimit/Timeout/Record, 상태 콜백과 completed의 의미.
- [Twilio Stream TwiML](https://www.twilio.com/docs/voice/twiml/stream): Connect Stream 양방향 연결과 custom parameters.
- [Twilio Media Streams messages](https://www.twilio.com/docs/voice/media-streams/websocket-messages): μ-law/8000/mono, media/mark/clear와 clear 이후 mark 의미.
- [Twilio request validation](https://www.twilio.com/docs/usage/security): URL·form field의 HMAC-SHA1 검증과 공식 예제.
- [OpenAI Realtime conversations](https://developers.openai.com/api/docs/guides/realtime-conversations): GA session.update, audio events, tools, WebSocket 수동 truncate.
- [OpenAI 공식 Node SDK Realtime schema](https://github.com/openai/openai-node/blob/master/src/resources/realtime/realtime.ts): `audio/pcmu` 형식.

원문 파일은 `twilio-calls.txt`, `twilio-stream.txt`, `twilio-media.txt`, `twilio-security.txt`, `twilio-sdk-webhooks.txt`, `realtime-conversations.txt`, `openai-sdk-realtime.txt`다. 원문 보관 경로는 이번 구현 evidence이며 배포물에 자동 포함하지 않는다.

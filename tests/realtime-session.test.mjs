import test from 'node:test';
import assert from 'node:assert/strict';
import { createRealtimeService } from '../agent/realtime-session.mjs';

const KEY = 'fixture-voice-key-never-live';
const OFFER = 'v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
const ANSWER = OFFER + 'a=recvonly\r\n';
const HEADERS = { origin: 'http://127.0.0.1:4188', host: '127.0.0.1:4188', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
const json = response => JSON.parse(response.body);
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function clock() {
  let time = Date.parse('2026-11-17T12:00:00Z'), nextId = 0;
  const timers = new Map();
  return {
    now: () => time,
    setTimeoutImpl(fn, delay) { const id = ++nextId; timers.set(id, { at: time + delay, fn }); return id; },
    clearTimeoutImpl(id) { timers.delete(id); },
    async advance(ms) {
      await flush(); const until = time + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        time = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
      }
      time = until; await flush();
    },
  };
}
function counter(now) {
  const usage = new Map(); const limits = [];
  return {
    limits, usage,
    async consumeModelCall(limit, { signal }) {
      if (signal.aborted) throw Object.assign(new Error('cancelled fixture'), { code: 'AGENT_TIMEOUT' });
      limits.push(limit);
      const day = new Date(now()).toISOString().slice(0, 10), used = usage.get(day) ?? 0;
      if (used >= limit) throw Object.assign(new Error('PRIVATE budget error'), { code: 'MODEL_DAILY_LIMIT' });
      usage.set(day, used + 1);
    },
  };
}
const created = (id = 'rtc_fixture1', sdp = ANSWER) => new Response(sdp, { status: 201, headers: { 'content-type': 'application/sdp', location: `/v1/realtime/calls/${id}` } });
function fixture(t, options = {}) {
  const time = clock(), calls = [], budget = options.budget ?? counter(time.now);
  const service = createRealtimeService({
    env: { OPENAI_API_KEY: KEY, ...options.env }, budget, ...time,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return options.fetchImpl ? options.fetchImpl(url, init, calls.length) : url.endsWith('/hangup') ? new Response(null, { status: 200 }) : created();
    },
  });
  t.after(async () => { const ending = service.dispose(); await time.advance(5000); await ending; });
  return {
    service, time, calls, budget,
    start: (extra = {}) => service.handle({ method: 'POST', path: '/api/voice/session', headers: HEADERS, body: { sdp: OFFER, region: 'jeju' }, ...extra }),
    end: token => service.handle({ method: 'POST', path: '/api/voice/end', headers: HEADERS, body: { token } }),
  };
}
function privateFree(response) {
  assert.doesNotMatch(response.body, /fixture-voice-key|PRIVATE|gpt-|marin|Authorization|api\.openai|rtc_fixture/);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
}

test('브라우저 Origin·Host·same-origin이 맞지 않으면 한도 차감과 외부 전송 전에 거절한다', async t => {
  const f = fixture(t);
  for (const headers of [
    { ...HEADERS, origin: undefined }, { ...HEADERS, origin: 'null' },
    { ...HEADERS, origin: 'http://localhost:4188' }, { ...HEADERS, origin: 'http://127.0.0.1:9999' },
    { ...HEADERS, origin: 'https://evil.test', host: 'evil.test' },
    { ...HEADERS, origin: 'http://localhost.evil.test', host: 'localhost.evil.test' },
    { ...HEADERS, origin: 'http://user@127.0.0.1:4188' },
    { ...HEADERS, origin: 'http://127.0.0.1:4188/other' },
    { ...HEADERS, 'sec-fetch-site': 'cross-site' },
    { ...HEADERS, 'sec-fetch-site': 'same-site' },
    { ...HEADERS, origin: ['http://127.0.0.1:4188'] },
    { ...HEADERS, origin: 'https://evil.test', 'x-forwarded-host': 'evil.test' },
  ]) {
    const response = await f.start({ headers });
    assert.equal(response.statusCode, 403); privateFree(response);
  }
  assert.equal(f.calls.length, 0); assert.equal(f.budget.limits.length, 0);
});

test('명시 loopback 세 주소와 서버에 지정한 정확한 HTTPS origin만 허용한다', async t => {
  const f = fixture(t, { env: { REALTIME_ALLOWED_ORIGIN: 'https://hondi.example' } });
  for (const [origin, host] of [['http://localhost:4188', 'localhost:4188'], ['http://127.0.0.1:4188', '127.0.0.1:4188'], ['http://[::1]:4188', '[::1]:4188']]) {
    const result = await f.start({ headers: { ...HEADERS, origin, host } });
    assert.equal(result.statusCode, 200); await f.end(json(result).token);
  }
  await f.time.advance(86_400_000);
  assert.equal((await f.start({ headers: { ...HEADERS, origin: 'https://sub.hondi.example', host: 'sub.hondi.example' } })).statusCode, 403);
  const result = await f.start({ headers: new Headers({ ...HEADERS, origin: 'https://hondi.example', host: 'hondi.example' }) });
  assert.equal(result.statusCode, 200);
});

test('SDP UTF-8 24KB·지역 enum·JSON key·요청 경로와 방식을 검증한다', async t => {
  const f = fixture(t);
  for (const body of [null, [], '{', { sdp: OFFER }, { sdp: OFFER, region: 'mainland' }, { sdp: OFFER, region: 'jeju', model: 'PRIVATE' }, { sdp: OFFER, region: 'jeju', tools: [] }, { sdp: 'PRIVATE', region: 'jeju' }, { sdp: OFFER + '\0', region: 'jeju' }, { sdp: OFFER + '한'.repeat(8192), region: 'jeju' }, { sdp: 'v=0\r\nm=video 9\r\n', region: 'jeju' }]) {
    const response = await f.start({ body }); assert.equal(response.statusCode, 400); privateFree(response);
  }
  assert.equal((await f.start({ method: 'GET' })).statusCode, 405);
  assert.equal((await f.start({ path: '/api/voice/session?model=anything' })).statusCode, 404);
  assert.equal((await f.start({ headers: { ...HEADERS, 'content-type': 'text/plain' } })).statusCode, 400);
  assert.equal(f.calls.length, 0); assert.equal(f.budget.limits.length, 0);
  const body = JSON.stringify({ sdp: OFFER, region: 'seoul' });
  assert.equal((await f.start({ body })).statusCode, 200);
});

test('키 없음·잘못된 한도 설정은 외부 전송 전에 고정 오류로 끝난다', async t => {
  const empty = fixture(t, { env: { OPENAI_API_KEY: '' } });
  assert.equal((await empty.start()).statusCode, 503); assert.equal(empty.calls.length, 0); assert.equal(empty.budget.limits.length, 0);
  for (const limit of ['0', '-1', '3.5', 'NaN', '81', ' 3']) {
    const f = fixture(t, { env: { OPENAI_REALTIME_DAILY_SESSION_LIMIT: limit } });
    const response = await f.start(); assert.equal(json(response).error.code, 'VOICE_BUDGET_UNAVAILABLE');
    assert.equal(f.calls.length, 0); privateFree(response);
  }
});

test('unified multipart는 서버 고정 모델·음성·VAD·text 전용 도구를 쓰고 공개 응답에는 SDP/토큰/기한만 준다', async t => {
  const f = fixture(t), response = await f.start(), body = json(response);
  assert.equal(response.statusCode, 200); assert.deepEqual(Object.keys(body).sort(), ['expiresIn', 'sdp', 'token']);
  assert.equal(body.sdp, ANSWER); assert.equal(body.expiresIn, 180); assert.match(body.token, /^[A-Za-z0-9_-]{43}$/); privateFree(response);
  assert.equal(f.calls.length, 1);
  const { url, init } = f.calls[0];
  assert.equal(url, 'https://api.openai.com/v1/realtime/calls'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Authorization, `Bearer ${KEY}`); assert.ok(init.body instanceof FormData); assert.equal(init.body.get('sdp'), OFFER);
  const config = JSON.parse(init.body.get('session'));
  assert.equal(config.type, 'realtime'); assert.equal(config.model, 'gpt-realtime-2.1'); assert.equal(config.audio.output.voice, 'marin');
  assert.deepEqual(config.audio.input.transcription, { model: 'gpt-4o-mini-transcribe', language: 'ko' });
  assert.deepEqual(config.audio.input.turn_detection, { type: 'semantic_vad', eagerness: 'auto', create_response: true, interrupt_response: true });
  assert.equal(config.max_output_tokens, 768); assert.deepEqual(config.output_modalities, ['audio']);
  assert.equal(config.tools.length, 1); assert.equal(config.tools[0].name, 'update_preparation');
  assert.deepEqual(Object.keys(config.tools[0].parameters.properties), ['text']); assert.equal(config.tools[0].parameters.properties.text.maxLength, 1600);
  assert.equal(config.tools[0].parameters.additionalProperties, false); assert.match(config.instructions, /사용자가 실제로 말한/); assert.match(config.instructions, /외부 조회 도구가 없습니다/);
});

test('기본 일일 세션 한도는 3이고 실패한 전송도 환불하지 않으며 UTC 다음 날에 다시 허용한다', async t => {
  const f = fixture(t, { fetchImpl: async () => new Response('PRIVATE ' + KEY, { status: 429 }) });
  for (let i = 0; i < 3; i++) { const result = await f.start(); assert.equal(result.statusCode, 503); privateFree(result); }
  const rejected = await f.start(); assert.equal(rejected.statusCode, 429); assert.equal(json(rejected).error.code, 'VOICE_DAILY_LIMIT');
  assert.equal(f.calls.length, 3); assert.ok(f.budget.limits.every(limit => limit === 3));
  await f.time.advance(86_400_000); assert.equal((await f.start()).statusCode, 503); assert.equal(f.calls.length, 4);
});

test('한도 저장 실패에서는 전송하지 않으며 내부 오류나 경로를 노출하지 않는다', async t => {
  const f = fixture(t, { budget: { async consumeModelCall() { throw new Error('PRIVATE C:/secret/' + KEY); } } });
  const result = await f.start(); assert.equal(json(result).error.code, 'VOICE_BUDGET_UNAVAILABLE'); privateFree(result); assert.equal(f.calls.length, 0);
});

test('한도 확인 중부터 동시 한 건만 예약하고 두 번째 요청은 차감하지 않는다', async t => {
  const gate = deferred(); let consumed = 0;
  const f = fixture(t, { budget: { async consumeModelCall() { consumed++; await gate.promise; } } });
  const first = f.start(); await flush();
  assert.equal((await f.start()).statusCode, 409); assert.equal(consumed, 1); assert.equal(f.calls.length, 0);
  gate.resolve(); assert.equal((await first).statusCode, 200); assert.equal(f.calls.length, 1);
});

test('종료 토큰은 해당 세션만 종료하고 재종료·다른 토큰은 추가 hangup을 만들지 않는다', async t => {
  const f = fixture(t), token = json(await f.start()).token;
  assert.equal((await f.end('x'.repeat(43))).statusCode, 200); assert.equal(f.calls.length, 1);
  const ended = await f.end(token); assert.deepEqual(json(ended), { ended: true }); privateFree(ended);
  assert.equal(f.calls[1].url, 'https://api.openai.com/v1/realtime/calls/rtc_fixture1/hangup');
  assert.equal((await f.end(token)).statusCode, 200); assert.equal(f.calls.length, 2);
  assert.equal((await f.end('../rtc_fixture1')).statusCode, 400);
  const next = await f.start(); assert.equal(next.statusCode, 200); assert.notEqual(json(next).token, token);
  await f.end(token); assert.equal(f.calls.length, 3);
});

test('서버 180초 타이머는 클라이언트 동작 없이 hangup하고 이전 세션 타이머는 다음 세션을 닫지 않는다', async t => {
  const f = fixture(t), first = await f.start();
  await f.time.advance(10_000); await f.end(json(first).token); await f.start();
  await f.time.advance(170_000); assert.equal(f.calls.filter(call => call.url.endsWith('/hangup')).length, 1);
  await f.time.advance(9_999); assert.equal(f.calls.filter(call => call.url.endsWith('/hangup')).length, 1);
  await f.time.advance(1); assert.equal(f.calls.filter(call => call.url.endsWith('/hangup')).length, 2);
});

test('연결 협상 시간이 서버 만료에 포함되어 성공 응답에서 남은 시간만 반환한다', async t => {
  const gate = deferred(); const f = fixture(t, { fetchImpl: url => url.endsWith('/hangup') ? new Response(null, { status: 200 }) : gate.promise });
  const pending = f.start(); await flush(); await f.time.advance(10_000); gate.resolve(created());
  const response = await pending; assert.equal(response.statusCode, 200); assert.equal(json(response).expiresIn, 170);
});

test('사전 취소는 차감하지 않고 생성 중 취소 뒤 늦게 온 callId는 즉시 종료한다', async t => {
  const gate = deferred(), controller = new AbortController();
  const f = fixture(t, { fetchImpl: url => url.endsWith('/hangup') ? new Response(null, { status: 200 }) : gate.promise });
  assert.equal((await f.start({ signal: AbortSignal.abort() })).statusCode, 499); assert.equal(f.budget.limits.length, 0);
  const pending = f.start({ signal: controller.signal }); await flush(); controller.abort();
  const response = await pending; assert.equal(response.statusCode, 499); privateFree(response);
  assert.equal((await f.start()).statusCode, 409); assert.equal(f.calls.length, 1);
  gate.resolve(created()); await flush(); assert.equal(f.calls.length, 2); assert.ok(f.calls[1].url.endsWith('/hangup'));
});

test('설정 timeout은 abort를 무시하는 공급자를 기다리지 않고 늦은 세션을 정리한다', async t => {
  const gate = deferred(); const f = fixture(t, { fetchImpl: url => url.endsWith('/hangup') ? new Response(null, { status: 200 }) : gate.promise });
  const pending = f.start(); await flush(); await f.time.advance(15_000);
  const response = await pending; assert.equal(json(response).error.code, 'VOICE_SETUP_TIMEOUT'); assert.equal(f.calls[0].init.signal.aborted, true);
  assert.equal((await f.start()).statusCode, 409);
  gate.resolve(created()); await flush(); assert.equal(f.calls.filter(call => call.url.endsWith('/hangup')).length, 1);
});

test('callId 뒤 SDP 본문이 멈춰도 setup timeout은 reader 취소와 hangup을 수행한다', async t => {
  let bodyCancelled = false;
  const f = fixture(t, { fetchImpl: url => url.endsWith('/hangup') ? new Response(null, { status: 200 }) : new Response(new ReadableStream({ cancel() { bodyCancelled = true; } }), { status: 201, headers: { location: '/v1/realtime/calls/rtc_fixture1' } }) });
  const pending = f.start(); await flush(); await f.time.advance(15_000);
  const result = await pending; assert.equal(result.statusCode, 504); assert.equal(bodyCancelled, true); assert.equal(f.calls.length, 2);
});

test('성공이라도 callId 누락·다른 origin·경로 주입이면 SDP를 내보내지 않고 추가 생성을 차단한다', async t => {
  for (const location of [null, 'https://evil.test/v1/realtime/calls/rtc_fixture1', '/v1/realtime/calls/rtc_fixture1?x=1', '/v1/realtime/calls/rtc_fixture1%2Fhangup', '/v1/realtime/calls/../rtc_fixture1']) {
    const f = fixture(t, { fetchImpl: async () => new Response(ANSWER, { status: 201, headers: location ? { location } : {} }) });
    const result = await f.start(); assert.equal(result.statusCode, 503); privateFree(result); assert.equal(json(result).sdp, undefined);
    assert.equal((await f.start()).statusCode, 409); assert.equal(f.calls.length, 1);
  }
});

test('네트워크 실패로 생성 여부가 불명확하면 원문 없이 실패하고 다음 생성을 막는다', async t => {
  const f = fixture(t, { fetchImpl: async () => { throw new Error('PRIVATE provider ' + KEY); } });
  const result = await f.start(); assert.equal(result.statusCode, 503); privateFree(result);
  assert.equal((await f.start()).statusCode, 409); assert.equal(f.calls.length, 1);
});

test('잘못된·과도한·비밀을 담은 SDP 응답은 반환하지 않고 알려진 callId를 종료한다', async t => {
  for (const answer of ['PRIVATE ' + KEY, ANSWER + 'x'.repeat(24 * 1024), ANSWER + 'a=x:' + KEY, ANSWER + 'a=x:gpt-realtime-2.1']) {
    const f = fixture(t, { fetchImpl: async url => url.endsWith('/hangup') ? new Response(null, { status: 200 }) : created('rtc_fixture1', answer) });
    const result = await f.start(); assert.equal(result.statusCode, 503); privateFree(result); assert.equal(f.calls.length, 2);
  }
});

test('hangup 실패는 종료 성공으로 표시하지 않으며 180초에 다시 종료를 시도한다', async t => {
  let hangups = 0;
  const f = fixture(t, { fetchImpl: async url => url.endsWith('/hangup') ? new Response(hangups++ ? null : 'PRIVATE ' + KEY, { status: hangups > 1 ? 200 : 503 }) : created() });
  const token = json(await f.start()).token, result = await f.end(token);
  assert.equal(json(result).error.code, 'VOICE_END_UNCONFIRMED'); privateFree(result);
  assert.equal((await f.start()).statusCode, 409); await f.time.advance(180_000); assert.equal(hangups, 2);
  assert.equal((await f.start()).statusCode, 200);
});

test('hangup 자체가 멈추면 5초에 응답하고 늦은 성공 확인 후에만 슬롯을 해제한다', async t => {
  const gate = deferred();
  const f = fixture(t, { fetchImpl: url => url.endsWith('/hangup') ? gate.promise : created() });
  const token = json(await f.start()).token, pending = f.end(token); await flush(); await f.time.advance(5000);
  const result = await pending; assert.equal(result.statusCode, 503); assert.equal((await f.start()).statusCode, 409);
  gate.resolve(new Response(null, { status: 200 })); await flush(); assert.equal((await f.start()).statusCode, 200);
});

test('HTTP 응답 유실 signal과 dispose 모두 세션을 종료하고 dispose 뒤 생성은 거절한다', async t => {
  const controller = new AbortController(), f = fixture(t);
  assert.equal((await f.start({ signal: controller.signal })).statusCode, 200);
  controller.abort(); await flush(); assert.equal(f.calls.length, 2);
  await f.start(); await f.service.dispose(); assert.equal(f.calls.length, 4);
  assert.equal(json(await f.start()).error.code, 'VOICE_CLOSED');
});

test('dispose가 진행 중 생성에 앞서 끝나도 나중에 도착한 세션을 종료한다', async t => {
  const gate = deferred(), f = fixture(t, { fetchImpl: url => url.endsWith('/hangup') ? new Response(null, { status: 200 }) : gate.promise });
  const pending = f.start(); await flush(); await f.service.dispose();
  assert.equal(json(await pending).error.code, 'VOICE_CLOSED');
  gate.resolve(created()); await flush(); assert.equal(f.calls.length, 2); assert.ok(f.calls[1].url.endsWith('/hangup'));
});

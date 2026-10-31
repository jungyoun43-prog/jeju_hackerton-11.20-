import test from 'node:test';
import assert from 'node:assert/strict';
import { createDynamoSessionStore } from '../agent/dynamodb-store.mjs';
import { createAgentService } from '../agent/service.mjs';
import { createToolDispatcher } from '../agent/tools.mjs';
import { AgentError } from '../agent/errors.mjs';

const tableName = 'test-synthetic-sessions';
const initialTime = Date.parse('2026-10-31T12:00:00Z');
const clone = value => structuredClone(value);
const conditionError = () => Object.assign(new Error('fixture conditional failure'), { name: 'ConditionalCheckFailedException' });
const safeError = (code, status) => error => error.code === code && error.status === status && !/PRIVATE|Bearer|credential|arn:|test-synthetic-sessions/.test(error.message);

// 작은 원자적 조건식 실행기. store 구현의 분기 대신 SDK가 받은 식을 평가한다.
function condition(expression, item, names = {}, values = {}) {
  if (!expression) return true;
  const tokens = expression.match(/attribute_not_exists|attribute_exists|#[A-Za-z0-9_]+|:[A-Za-z0-9_]+|>=|<=|<>|=|>|<|\(|\)|AND|OR/g);
  let index = 0;
  const take = expected => { assert.equal(tokens[index++], expected); };
  const value = token => token.startsWith(':') ? values[token] : item?.[names[token]];
  function primary() {
    if (tokens[index] === '(') { index++; const result = or(); take(')'); return result; }
    if (tokens[index]?.startsWith('attribute_')) {
      const operator = tokens[index++]; take('('); const field = names[tokens[index++]]; take(')');
      const exists = item !== undefined && Object.hasOwn(item, field);
      return operator === 'attribute_exists' ? exists : !exists;
    }
    const left = value(tokens[index++]), operator = tokens[index++], right = value(tokens[index++]);
    if (left === undefined || right === undefined || typeof left !== typeof right) return false;
    return ({ '=': () => left === right, '<>': () => left !== right, '>': () => left > right,
      '<': () => left < right, '>=': () => left >= right, '<=': () => left <= right })[operator]();
  }
  function and() { let result = primary(); while (tokens[index] === 'AND') { index++; const next = primary(); result = result && next; } return result; }
  function or() { let result = and(); while (tokens[index] === 'OR') { index++; const next = and(); result = result || next; } return result; }
  const result = or(); assert.equal(index, tokens.length); return result;
}

class FakeDocumentClient {
  constructor(items = new Map()) { this.items = items; this.calls = []; }
  key(table, pk) { return `${table}\0${pk}`; }
  item(pk) { return clone(this.items.get(this.key(tableName, pk))); }
  async send(command, options = {}) {
    const input = clone(command.input), name = command.constructor.name;
    this.calls.push({ name, input, options });
    if (this.beforeSend) await this.beforeSend({ name, input, options });
    // 이 await 뒤에는 조건 판정과 갱신을 하나의 원자적 작업으로 수행한다.
    await Promise.resolve();
    const key = this.key(input.TableName, (input.Key ?? input.Item).pk), item = this.items.get(key);
    if (name === 'GetCommand') return item ? { Item: clone(item) } : {};
    assert.ok(['PutCommand', 'UpdateCommand'].includes(name));
    if (!condition(input.ConditionExpression, item, input.ExpressionAttributeNames, input.ExpressionAttributeValues)) throw conditionError();
    if (name === 'PutCommand') { this.items.set(key, clone(input.Item)); return {}; }
    const next = clone(item ?? input.Key), names = input.ExpressionAttributeNames ?? {}, values = input.ExpressionAttributeValues ?? {};
    const expression = input.UpdateExpression;
    const setIfAbsent = /(#\w+)\s*=\s*if_not_exists\((#\w+),\s*(:\w+)\)/g;
    for (const match of expression.matchAll(setIfAbsent)) {
      const [, target, original, fallback] = match;
      next[names[target]] = item?.[names[original]] ?? clone(values[fallback]);
    }
    for (const [, field, replacement] of expression.matchAll(/(#\w+)\s*=\s*(:\w+)/g)) next[names[field]] = clone(values[replacement]);
    const add = /ADD\s+(#\w+)\s+(:\w+)/.exec(expression);
    if (add) { const field = names[add[1]]; assert.ok(next[field] === undefined || typeof next[field] === 'number'); next[field] = (next[field] ?? 0) + values[add[2]]; }
    const remove = /REMOVE\s+(.+)$/.exec(expression);
    if (remove) for (const field of remove[1].split(',').map(value => value.trim())) delete next[names[field]];
    this.items.set(key, next);
    return {};
  }
}
function fixture() {
  let time = initialTime;
  const client = new FakeDocumentClient(), now = () => time;
  return { client, now, advance: seconds => { time += seconds * 1000; }, setTime: value => { time = value; },
    store: extra => createDynamoSessionStore({ client, tableName, now, ...extra }) };
}
async function locked(f) { const store = f.store(), item = await store.loadOrCreate(); await store.acquire(item.sessionId); return { store, item }; }

test('factory는 AWS 호출 없이 client·table·TTL을 검증한다', () => {
  const f = fixture(); assert.equal(f.store().kind, 'dynamodb'); assert.equal(f.client.calls.length, 0);
  for (const extra of [{ client: {} }, { tableName: 'PRIVATE invalid/name' }, { ttlSeconds: 0 }, { leaseSeconds: 0 }, { now: null }, { region: 'PRIVATE' }]) {
    assert.throws(() => f.store(extra), safeError('SESSION_STORE_UNAVAILABLE', 503));
  }
});

test('새 opaque 세션은 조건부 생성되고 두 client의 consistent read와 상태 복원이 일치한다', async () => {
  const f = fixture(), a = f.store(), item = await a.loadOrCreate();
  assert.match(item.sessionId, /^[A-Za-z0-9_-]{43}$/); assert.equal(item.expiresAt, initialTime / 1000 + 3600);
  const key = `session#${item.sessionId}`;
  assert.equal(f.client.calls[0].input.ConditionExpression, 'attribute_not_exists(#pk)');
  item.state.patient.area = '서귀포시';
  const clientB = new FakeDocumentClient(f.client.items), b = f.store({ client: clientB });
  assert.equal((await b.loadOrCreate(item.sessionId)).state.patient.area, '제주시 애월읍');
  await a.acquire(item.sessionId);
  item.turns = 1; item.requestIds = ['request-persist-001'];
  await a.save(item); await a.release(item.sessionId);
  const restored = await b.loadOrCreate(item.sessionId);
  assert.equal(restored.state.patient.area, '서귀포시'); assert.equal(restored.turns, 1);
  assert.deepEqual(restored.requestIds, ['request-persist-001']);
  assert.equal(clientB.calls.at(-1).input.ConsistentRead, true);
  assert.equal('leaseOwner' in restored, false); assert.equal('pk' in restored, false);
  assert.equal('leaseOwner' in f.client.item(key), false);
});

test('같은 client를 공유한 두 store도 한 lease만 획득하고 미소유 release/save는 격리된다', async () => {
  const f = fixture(), a = f.store(), b = f.store(), item = await a.loadOrCreate();
  const results = await Promise.allSettled([a.acquire(item.sessionId), b.acquire(item.sessionId)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(results.filter(item => item.status === 'rejected' && item.reason.code === 'SESSION_BUSY').length, 1);
  const winner = results[0].status === 'fulfilled' ? a : b, loser = winner === a ? b : a;
  const owner = f.client.item(`session#${item.sessionId}`).leaseOwner;
  assert.match(owner, /^[a-f0-9-]{36}$/);
  await loser.release(item.sessionId);
  assert.equal(f.client.item(`session#${item.sessionId}`).leaseOwner, owner);
  await assert.rejects(loser.save(item), safeError('SESSION_LEASE_LOST', 409));
  await winner.release(item.sessionId);
  await loser.acquire(item.sessionId); await loser.release(item.sessionId);
});

test('한 store의 병렬 acquire와 미해제 expired lease 재획득도 새 token 차용을 막는다', async () => {
  const f = fixture(), a = f.store(), item = await a.loadOrCreate();
  const results = await Promise.allSettled([a.acquire(item.sessionId), a.acquire(item.sessionId)]);
  assert.equal(results.filter(item => item.status === 'fulfilled').length, 1);
  f.advance(66);
  await assert.rejects(a.acquire(item.sessionId), safeError('SESSION_BUSY', 409));
  await a.release(item.sessionId); await a.acquire(item.sessionId); await a.release(item.sessionId);
});

test('만료 후 새 실행이 얻은 lease를 이전 실행의 save/release가 덮거나 제거하지 않는다', async () => {
  const f = fixture(), { store: a, item } = await locked(f), b = f.store();
  f.advance(66); await b.acquire(item.sessionId);
  const ownerB = f.client.item(`session#${item.sessionId}`).leaseOwner;
  await assert.rejects(a.save({ ...item, turns: 1 }), safeError('SESSION_LEASE_LOST', 409));
  await a.release(item.sessionId);
  assert.equal(f.client.item(`session#${item.sessionId}`).leaseOwner, ownerB);
  const latest = await b.loadOrCreate(item.sessionId); latest.turns = 1;
  await b.save(latest); await b.release(item.sessionId);
  assert.equal((await a.loadOrCreate(item.sessionId)).turns, 1);
});

test('local lease가 남아 있어도 DB 소유권 변경은 조건부 save와 release를 막는다', async () => {
  const f = fixture(), { store, item } = await locked(f), key = f.client.key(tableName, `session#${item.sessionId}`);
  f.client.items.get(key).leaseOwner = 'another-execution-owner';
  await assert.rejects(store.save(item), safeError('SESSION_LEASE_LOST', 409));
  await store.release(item.sessionId);
  assert.equal(f.client.items.get(key).leaseOwner, 'another-execution-owner');
});

test('취소한 save가 늦게 도착해도 cleanup 뒤의 새 소유자 상태를 덮어쓰지 않는다', async () => {
  const f = fixture(), { store: a, item } = await locked(f), b = f.store();
  const controller = new AbortController(); let continueWrite;
  f.client.beforeSend = ({ name }) => {
    if (name === 'PutCommand') { f.client.beforeSend = undefined; return new Promise(resolve => { continueWrite = resolve; }); }
  };
  const pending = a.save({ ...item, turns: 1 }, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort('PRIVATE cancel');
  await assert.rejects(pending, safeError('AGENT_TIMEOUT', 504));
  await a.release(item.sessionId, { signal: AbortSignal.timeout(2500) });
  await b.acquire(item.sessionId);
  const owner = f.client.item(`session#${item.sessionId}`).leaseOwner;
  continueWrite(); await new Promise(resolve => setImmediate(resolve));
  const stored = f.client.item(`session#${item.sessionId}`);
  assert.equal(stored.turns, 0); assert.equal(stored.leaseOwner, owner);
  await b.release(item.sessionId);
});

test('TTL 삭제 전 만료 행도 앱에서 거절하고 만료 세션을 save로 부활시키지 않는다', async () => {
  const f = fixture(), a = f.store({ ttlSeconds: 1 }), item = await a.loadOrCreate();
  await a.acquire(item.sessionId); f.advance(2);
  assert.ok(f.client.item(`session#${item.sessionId}`));
  await assert.rejects(a.loadOrCreate(item.sessionId), safeError('SESSION_EXPIRED', 404));
  await assert.rejects(a.save(item), safeError('SESSION_LEASE_LOST', 409));
  await a.release(item.sessionId);
  await assert.rejects(a.loadOrCreate('x'.repeat(43)), safeError('SESSION_EXPIRED', 404));
  await assert.rejects(a.loadOrCreate('../PRIVATE'), safeError('INVALID_SESSION', 400));
});

test('식별자 충돌은 세 번 이내에 새 ID로 재시도하고 실패 시 원문 없이 중단한다', async () => {
  const f = fixture(); let collisions = 2;
  f.client.beforeSend = ({ name }) => { if (name === 'PutCommand' && collisions-- > 0) throw conditionError(); };
  const item = await f.store().loadOrCreate(); assert.ok(item.sessionId);
  const calls = f.client.calls.filter(item => item.name === 'PutCommand');
  assert.equal(calls.length, 3); assert.equal(new Set(calls.map(item => item.input.Item.pk)).size, 3);
  f.client.calls.length = 0; f.client.beforeSend = () => { throw conditionError(); };
  await assert.rejects(f.store().loadOrCreate(), safeError('SESSION_STORE_UNAVAILABLE', 503)); assert.equal(f.client.calls.length, 3);
});

test('서로 다른 실행의 100개 동시 turn 중 UTC 전역 한도80개만 원자적으로 소비한다', async () => {
  const f = fixture(), stores = Array.from({ length: 5 }, () => f.store({ client: new FakeDocumentClient(f.client.items) }));
  const results = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => stores[index % stores.length].consumeTurn(80)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 80);
  assert.equal(results.filter(result => result.status === 'rejected' && safeError('DAILY_LIMIT', 429)(result.reason)).length, 20);
  const row = f.client.item('budget#2026-10-31');
  assert.deepEqual(Object.keys(row).sort(), ['expiresAt', 'pk', 'used']); assert.equal(row.used, 80);
  assert.equal(row.expiresAt, Date.parse('2026-11-01T00:00:00Z') / 1000);
  f.setTime(Date.parse('2026-11-01T00:00:00Z')); await stores[0].consumeTurn(80);
  assert.equal(f.client.item('budget#2026-11-01').used, 1); assert.equal(f.client.item('budget#2026-10-31').used, 80);
  for (const limit of [0, 81, 1.5, '80']) await assert.rejects(stores[0].consumeTurn(limit), safeError('SESSION_STORE_UNAVAILABLE', 503));
});

test('세션은 정규화된 사례만 저장하고 원문·응답·reasoning 추가 필드는 저장하지 않는다', async () => {
  const f = fixture(), { store, item } = await locked(f), secret = 'PRIVATE-NOT-TO-PERSIST';
  const dispatch = createToolDispatcher();
  let result = await dispatch({ name: 'request_records', input: { source: 'demo' }, state: item.state });
  result = await dispatch({ name: 'request_hospital_contact', input: { target: 'mainland' }, state: result.state });
  result = await dispatch({ name: 'prepare_inquiries', input: { kind: 'taxi' }, state: result.state });
  await store.save({ ...item, state: result.state, message: secret, history: [secret], reply: secret, providerContext: { encrypted_content: secret } });
  const row = f.client.item(`session#${item.sessionId}`);
  assert.equal(JSON.stringify(row).includes(secret), false);
  assert.deepEqual(Object.keys(row).sort(), ['expiresAt', 'leaseOwner', 'leaseUntil', 'pk', 'requestIds', 'sessionId', 'state', 'turns']);
  assert.equal((await store.loadOrCreate(item.sessionId)).state.visitSupport.taxi.status, 'prepared');
  await store.release(item.sessionId);
});

test('임의 중첩 context·실명·의료기록·자격증명·큰 상태는 DDB 쓰기 전에 거절한다', async () => {
  const f = fixture(), { store, item } = await locked(f);
  const bad = [
    state => { state.context = { encrypted_content: 'PRIVATE' }; },
    state => { state.patient.name = 'PRIVATE actual person'; },
    state => { state.documents[0].content = 'PRIVATE actual health record'; },
    state => { state.inquiries.mainland.reply = 'PRIVATE'; },
    state => { state.events[0].detail = 'sk-proj-' + 'x'.repeat(40); },
    state => { state.events = Array.from({ length: 200 }, (_, i) => ({ ...state.events[0], id: `event-${i + 1}`, detail: '예'.repeat(1500) })); },
  ];
  for (const mutate of bad) {
    const state = clone(item.state); mutate(state); const count = f.client.calls.length;
    await assert.rejects(store.save({ ...item, state }), safeError('SESSION_STATE_INVALID', 503));
    assert.equal(f.client.calls.length, count);
  }
  const withKeyId = { ...item, requestIds: ['sk-proj-' + 'x'.repeat(40)] };
  await assert.rejects(store.save(withKeyId), safeError('SESSION_STATE_INVALID', 503));
  await store.release(item.sessionId);
});

test('저장소가 반환한 잘못된 행도 model 호출 전에 정제된 오류로 처리한다', async () => {
  const f = fixture(), store = f.store(), item = await store.loadOrCreate(), key = f.client.key(tableName, `session#${item.sessionId}`);
  f.client.items.get(key).message = 'PRIVATE raw prompt';
  await assert.rejects(store.loadOrCreate(item.sessionId), safeError('SESSION_STATE_INVALID', 503));
});

test('모든 SDK 경로의 오류는 key·ARN·provider 오류 원문을 노출하지 않는다', async () => {
  for (const method of ['create', 'get', 'acquire', 'save', 'release', 'consumeTurn']) {
    const f = fixture(), store = f.store(), item = await store.loadOrCreate();
    if (['save', 'release'].includes(method)) await store.acquire(item.sessionId);
    f.client.beforeSend = () => { throw new Error('PRIVATE Bearer credential arn:aws:secret'); };
    const action = { create: () => store.loadOrCreate(), get: () => store.loadOrCreate(item.sessionId), acquire: () => store.acquire(item.sessionId),
      save: () => store.save(item), release: () => store.release(item.sessionId), consumeTurn: () => store.consumeTurn(80) }[method];
    await assert.rejects(action(), safeError('SESSION_STORE_UNAVAILABLE', 503));
  }
  const f = fixture(); f.client.beforeSend = () => { throw new AgentError('UNTRUSTED_CODE', 'PRIVATE credential', 500); };
  await assert.rejects(f.store().consumeTurn(80), safeError('SESSION_STORE_UNAVAILABLE', 503));
});

test('release 실패의 lease는 만료로 회복하며 임의 삭제나 budget 환불을 하지 않는다', async () => {
  const f = fixture(), { store, item } = await locked(f); await store.consumeTurn(80);
  f.client.beforeSend = () => { throw new Error('PRIVATE transport failed'); };
  await assert.rejects(store.release(item.sessionId), safeError('SESSION_STORE_UNAVAILABLE', 503));
  f.client.beforeSend = undefined;
  assert.ok(f.client.item(`session#${item.sessionId}`).leaseOwner); assert.equal(f.client.item('budget#2026-10-31').used, 1);
  f.advance(66); await store.acquire(item.sessionId); await store.release(item.sessionId);
  assert.equal(f.client.item(`session#${item.sessionId}`).leaseOwner, undefined);
});

test('상위 abort는 SDK에 전파되고 이미 중단된 요청은 전송하지 않는다', async () => {
  const f = fixture(), store = f.store(), before = new AbortController(); before.abort('PRIVATE reason');
  await assert.rejects(store.loadOrCreate(undefined, { signal: before.signal }), safeError('AGENT_TIMEOUT', 504));
  await assert.rejects(store.consumeTurn(80, { signal: before.signal }), safeError('AGENT_TIMEOUT', 504));
  assert.equal(f.client.calls.length, 0);
  const controller = new AbortController(); let sentSignal;
  f.client.beforeSend = ({ options }) => { sentSignal = options.abortSignal; return new Promise(() => {}); };
  const pending = store.consumeTurn(80, { signal: controller.signal });
  await new Promise(resolve => setImmediate(resolve)); controller.abort('PRIVATE reason');
  await assert.rejects(pending, safeError('AGENT_TIMEOUT', 504)); assert.equal(sentSignal.aborted, true);
});

test('caller signal이 없어도 SDK가 응답하지 않으면 짧은 상한에서 fail closed된다', async () => {
  const f = fixture(); let sentSignal;
  f.client.beforeSend = ({ options }) => { sentSignal = options.abortSignal; return new Promise(() => {}); };
  const started = Date.now();
  await assert.rejects(f.store().consumeTurn(80), safeError('SESSION_STORE_UNAVAILABLE', 503));
  assert.equal(sentSignal.aborted, true); assert.ok(Date.now() - started < 7000);
});

test('서비스 중복 요청과 전역 budget 실패는 두 인스턴스에서도 유료 provider보다 먼저 처리된다', async () => {
  const f = fixture(); let calls = 0;
  const provider = { connected: true, model: 'fixture', respond: async () => { calls++; return { content: [{ text: '합성 준비 상태입니다.' }], stopReason: 'end_turn', context: { encrypted_content: 'PRIVATE reasoning' } }; } };
  const a = createAgentService({ provider, store: f.store(), config: { dailyTurns: 2 } });
  const b = createAgentService({ provider, store: f.store({ client: new FakeDocumentClient(f.client.items) }), config: { dailyTurns: 2 } });
  const post = (service, requestId, sessionId) => service.handleAgentRequest({ method: 'POST', path: '/api/agent', body: { message: '합성 준비 확인', requestId, ...(sessionId ? { sessionId } : {}) } });
  const first = await post(a, 'request-service-001'); assert.equal(first.statusCode, 200);
  const sessionId = JSON.parse(first.body).sessionId;
  assert.equal((await post(b, 'request-service-001', sessionId)).statusCode, 200); assert.equal(calls, 1);
  assert.equal((await post(b, 'request-service-002', sessionId)).statusCode, 200); assert.equal(calls, 2);
  const limit = await post(a, 'request-service-003', sessionId);
  assert.equal(limit.statusCode, 429); assert.equal(JSON.parse(limit.body).error.code, 'DAILY_LIMIT'); assert.equal(calls, 2);
  assert.equal(JSON.stringify([...f.client.items.values()]).includes('PRIVATE'), false);
  f.client.beforeSend = () => { throw new Error('PRIVATE database error'); };
  assert.equal((await post(a, 'request-service-004', sessionId)).statusCode, 503); assert.equal(calls, 2);
});

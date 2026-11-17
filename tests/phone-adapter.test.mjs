import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {createHmac} from 'node:crypto';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,dirname,basename,join} from 'node:path';
import {createPhoneAdapter} from '../agent/phone-adapter.mjs';
import {PHONE_LIVE_ACK,phoneError,validatePhoneRequest,hashPhoneValue} from '../agent/phone-policy.mjs';
import {verifyTwilioSignature,buildPhoneTwiml} from '../agent/phone-twilio.mjs';
import {createFilePhoneLedger} from '../agent/phone-ledger.mjs';
import {createPhoneOperatorServer} from '../agent/phone-operator-server.mjs';

// All phone numbers, credentials, dates and audio below are synthetic. No network implementation is used.
const account='AC'+'1'.repeat(32),sid='CA'+'2'.repeat(32),stream='MZ'+'3'.repeat(32);
const token='a'.repeat(43),origin='https://voice.example.test',epoch=Date.parse('2026-11-18T00:00:00Z');
const env={PHONE_OUTBOUND_ENABLED:'true',PHONE_OUTBOUND_LIVE_ACK:PHONE_LIVE_ACK,PHONE_ALLOWED_NUMBERS:'+12025550123',
  PHONE_PUBLIC_ORIGIN:origin,TWILIO_FROM_NUMBER:'+12025550124',TWILIO_ACCOUNT_SID:account,
  TWILIO_AUTH_TOKEN:'synthetic-auth-token-only',OPENAI_API_KEY:'synthetic-key-never-network'};
const input=()=>({requestId:'request_0001',purpose:'hospital',recipient:{phone:'+12025550123',label:'가상 접수 창구',verified:true,verificationRef:'synthetic-recipient-check'},
  caller:{phone:'+12025550124',verified:true,verificationRef:'synthetic-caller-check'},
  authorization:{grantId:'grant_000001',verified:true,actor:'authorized_representative',revoked:false,
    recipientPhone:'+12025550123',purpose:'hospital',maxAttempts:1,scopes:['call','minimum_disclosure','negotiate','book'],
    validFrom:'2026-11-17T00:00:00Z',validUntil:'2026-11-19T00:00:00Z'},
  processing:{verified:true,policyRef:'synthetic-policy',recording:'off',transcription:'ephemeral',applicationRetention:'none',
    providerRetentionVerified:true,crossBorderVerified:true,minimumDisclosureVerified:true,notice:'AI 전화이며 합성 정책 안내입니다. 응대를 수락하시나요?',refusalAction:'handoff'},
  schedule:{date:'2026-12-03',earliestTime:'14:00',latestTime:'15:00',timeZone:'Asia/Seoul',service:'정형외과 접수'},
  limits:{maxDurationSeconds:180,ringSeconds:15,windowStart:'2026-11-17T00:00:00Z',windowEnd:'2026-11-19T00:00:00Z',
    cost:{currency:'USD',maxTotal:2,perMinuteUpperBound:0.5,fixedUpperBound:0.2,verified:true,quoteRef:'synthetic-quote',validUntil:'2026-11-19T00:00:00Z'}}});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const terminalReply=()=>({ok:true,json:async()=>({sid,account_sid:account,status:'completed'})});
class Clock {
  time=epoch;next=0;tasks=new Map();
  now=()=>this.time;
  set=(fn,ms)=>{const timer={id:++this.next,unref(){}};this.tasks.set(timer.id,{fn,at:this.time+ms});return timer;};
  clear=timer=>this.tasks.delete(timer?.id);
  async advance(ms){const end=this.time+ms;while(true){const pair=[...this.tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!pair||pair[1].at>end)break;this.time=pair[1].at;this.tasks.delete(pair[0]);pair[1].fn();await tick();}this.time=end;await tick();}
}
class Socket extends EventEmitter {
  readyState=1;bufferedAmount=0;sent=[];closes=0;
  send(value){this.sent.push(JSON.parse(value));}
  message(value){this.emit('message',JSON.stringify(value));}
  close(){if(this.readyState===3)return;this.readyState=3;this.closes++;this.emit('close');}
}
function memoryLedger(){return {persistent:true,reserves:0,releases:0,active:false,used:new Set(),
  async reserve({grantKey}){if(this.active)throw phoneError('BUSY');if(this.used.has(grantKey))throw phoneError('DUPLICATE');this.used.add(grantKey);this.active=true;this.reserves++;},
  async release({terminalConfirmed}){if(terminalConfirmed){this.active=false;this.releases++;}}};}
function harness(options={}) {
  const clock=new Clock(),calls=[],ledger=options.ledger||memoryLedger(),realtime=new Socket(),receipts=[];
  let connects=0;
  const fetchImpl=options.fetchImpl|| (async(url,request)=>{calls.push({url,...request});return url.endsWith('/Calls.json')?{ok:true,json:async()=>({sid,account_sid:account,to:'+12025550123',from:'+12025550124'})}:terminalReply();});
  const adapter=createPhoneAdapter({env:options.env||env,fetchImpl,ledger,now:clock.now,setTimer:clock.set,clearTimer:clock.clear,makeToken:()=>token,
    connectRealtime:options.connectRealtime|| (async()=>{connects++;return realtime;}),onReceipt:r=>receipts.push(r)});
  return {clock,calls,ledger,realtime,receipts,adapter,get connects(){return connects;}};
}
function signature(url,params={}) {
  const data=url+Object.keys(params).sort().map(k=>k+params[k]).join('');
  return createHmac('sha1',env.TWILIO_AUTH_TOKEN).update(data).digest('base64');
}
function streamStart(overrides={}) {
  return {event:'start',streamSid:stream,start:{accountSid:account,callSid:sid,streamSid:stream,tracks:['inbound'],
    mediaFormat:{encoding:'audio/x-mulaw',sampleRate:8000,channels:1},customParameters:{token},...overrides}};
}
async function connected(h) {
  await h.adapter.start(input(),{mode:'live'});
  const socket=new Socket();assert.equal(h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}}),true);
  socket.message({event:'connected'});socket.message(streamStart());await tick();
  h.realtime.message({type:'session.updated',session:{audio:{input:{format:{type:'audio/pcmu'}},output:{format:{type:'audio/pcmu'}}}}});
  return socket;
}
function tool(h,name,value,id='tool_1'){h.realtime.message({type:'response.function_call_arguments.done',name,call_id:id,arguments:JSON.stringify(value)});}
async function callback(h,status,patch={}) {
  const url=`${origin}/phone/status/${token}`,params={AccountSid:account,CallSid:sid,To:'+12025550123',From:'+12025550124',CallStatus:status,...patch};
  return h.adapter.handleStatusCallback({url,headers:{'x-twilio-signature':signature(url,params)},body:new URLSearchParams(params).toString()});
}

test('기본 dry-run은 키·전송·소켓·영속 ledger에 접근하지 않고 실행 없음 receipt를 반환한다',async()=>{
  let touches=0;const h=harness({env:{},fetchImpl:()=>{touches++;throw new Error('network forbidden');},connectRealtime:()=>{touches++;throw new Error('network forbidden');}});
  const result=await h.adapter.start(input());
  assert.equal(result.mode,'simulation');assert.equal(result.actualCallPlaced,false);assert.equal(result.reservationConfirmed,false);
  assert.equal(touches,0);assert.equal(h.ledger.reserves,0);assert.equal(h.clock.tasks.size,0);
});

test('두 활성화 guard를 각각 요구하고 기본 live 요청을 차단한다',async()=>{
  for(const change of [{PHONE_OUTBOUND_ENABLED:''},{PHONE_OUTBOUND_LIVE_ACK:''},{PHONE_OUTBOUND_ENABLED:'TRUE'}]){
    const h=harness({env:{...env,...change}});await assert.rejects(h.adapter.start(input(),{mode:'live'}),{code:'DISABLED'});assert.equal(h.calls.length,0);
  }
});

test('수신처·실제 위임·공유·정책·비용·시간 guard 실패는 발신을 만들지 않는다',async()=>{
  const changes=[
    r=>r.recipient.verified=false,r=>r.recipient.phone='+12025550125',r=>r.authorization.revoked=true,
    r=>r.authorization.purpose='taxi',r=>r.authorization.maxAttempts=2,r=>r.authorization.scopes=['call'],
    r=>r.authorization.validUntil='2026-11-18T00:01:00Z',r=>r.authorization.verified=false,
    r=>r.processing.recording='on',r=>r.processing.crossBorderVerified=false,r=>r.processing.providerRetentionVerified=false,
    r=>r.processing.applicationRetention='forever',r=>r.limits.maxDurationSeconds=181,r=>r.limits.ringSeconds=31,
    r=>r.limits.cost.maxTotal=0.1,r=>r.limits.cost.perMinuteUpperBound=NaN,r=>r.limits.cost.verified=false,
    r=>r.limits.windowStart='2026-11-19T00:00:00Z',r=>r.schedule.date='2026-02-30',r=>r.schedule.date='2026-99-99',
    r=>r.caller.verified=false,r=>r.schedule.earliestTime='25:00',
  ];
  for(const change of changes){const h=harness(),r=input();change(r);await assert.rejects(h.adapter.start(r,{mode:'live'}),error=>error.name==='PhoneAdapterError');assert.equal(h.calls.length,0);assert.equal(h.ledger.reserves,0);}
});

test('발신은 하나의 REST 요청과 양방향 Stream TwiML이며 녹음·자동 재발신을 설정하지 않는다',async()=>{
  const h=harness(),r=await h.adapter.start(input(),{mode:'live'}),call=h.calls[0],body=new URLSearchParams(call.body);
  assert.equal(h.calls.length,1);assert.equal(call.url,`https://api.twilio.com/2010-04-01/Accounts/${account}/Calls.json`);
  assert.equal(body.get('To'),'+12025550123');assert.equal(body.get('TimeLimit'),'180');assert.equal(body.get('Timeout'),'15');assert.equal(body.get('Record'),'false');
  assert.deepEqual(body.getAll('StatusCallbackEvent'),['initiated','ringing','answered','completed']);
  assert.match(body.get('Twiml'),/<Connect><Stream url="wss:\/\/voice.example.test\/phone\/media">/);
  assert.match(body.get('Twiml'),/<Parameter name="token"/);assert.match(body.get('Twiml'),/<Hangup/);assert.doesNotMatch(body.get('Twiml'),/Record|Dial/);
  assert.equal(r.mode,'real');assert.equal(r.actualCallPlaced,true);assert.equal(r.reservationConfirmed,false);
  assert.doesNotMatch(JSON.stringify(r),/synthetic-key|auth-token|\+1202|gpt-|CA222|aaaaaa/);
  await h.adapter.dispose();assert.equal(h.calls.length,2);
});

test('Twilio 공식 HMAC 예제와 일치하며 URL·본문·서명 변경을 거부한다',()=>{
  const params={CallSid:'CA1234567890ABCDE',Caller:'+14158675310',Digits:'1234',From:'+14158675310',To:'+18005551212'};
  const sample={authToken:'12345',url:'https://example.com/myapp.php?foo=1&bar=2',params,signature:'L/OH5YylLD5NRKLltdqwSvS0BnU='};
  assert.equal(verifyTwilioSignature(sample),true);
  for(const patch of [{url:sample.url+'/'},{params:{...params,Digits:'9999'}},{signature:'invalid'}])assert.equal(verifyTwilioSignature({...sample,...patch}),false);
  assert.match(buildPhoneTwiml({mediaUrl:'wss://example.test/?a="&b=<',token:'"<&'}),/&quot;&amp;b=&lt;/);
});

test('중복 시작·동시 발신을 막고 종료 후에도 같은 grant를 재사용하지 않는다',async()=>{
  const h=harness();await h.adapter.start(input(),{mode:'live'});
  await assert.rejects(h.adapter.start(input(),{mode:'live'}),{code:'DUPLICATE'});
  const other=input();other.requestId='request_0002';await assert.rejects(h.adapter.start(other,{mode:'live'}),{code:'BUSY'});
  await h.adapter.end('request_0001');
  const next=harness({ledger:h.ledger});await assert.rejects(next.adapter.start(other,{mode:'live'}),{code:'DUPLICATE'});assert.equal(next.calls.length,0);
});

test('서명 없는 WS·다른 canonical URL을 거부하고 callSid/token/형식을 묶는다',async()=>{
  const h=harness();await h.adapter.start(input(),{mode:'live'});
  for(const headers of [{},{'x-twilio-signature':signature('https://attacker.test/phone/media')}]){
    const socket=new Socket();assert.equal(h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers}),false);assert.equal(socket.closes,1);
  }
  for(const change of [{callSid:'CA'+'4'.repeat(32)},{customParameters:{token:'bad'}},{accountSid:'AC'+'4'.repeat(32)},
    {mediaFormat:{encoding:'audio/pcm',sampleRate:8000,channels:1}},{tracks:['outbound']}]){
    const socket=new Socket();assert.equal(h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}}),true);
    socket.message(streamStart(change));await tick();assert.equal(socket.closes,1);
  }
  assert.equal(h.connects,0);await h.adapter.dispose();
});

test('같은 stream token의 두 번째 소켓은 거부하고 원래 통화를 유지한다',async()=>{
  const h=harness(),first=await connected(h),second=new Socket();
  h.adapter.acceptMediaSocket({socket:second,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}});
  second.message(streamStart());await tick();assert.equal(second.closes,1);assert.equal(first.closes,0);assert.equal(h.connects,1);await h.adapter.dispose();
});

test('g711 mu-law payload는 변환 없이 양방향 통과하고 GA audio schema를 사용한다',async()=>{
  const h=harness(),socket=await connected(h),payload=Buffer.alloc(160,0xff).toString('base64');
  const session=h.realtime.sent.find(e=>e.type==='session.update').session;
  assert.deepEqual(session.audio.input.format,{type:'audio/pcmu'});assert.deepEqual(session.audio.output.format,{type:'audio/pcmu'});
  assert.equal(session.type,'realtime');assert.equal(session.max_output_tokens,768);
  socket.message({event:'media',streamSid:stream,media:{track:'inbound',payload,timestamp:'20'}});
  assert.equal(h.realtime.sent.at(-1).audio,payload);
  h.realtime.message({type:'response.created',response:{id:'response_1'}});
  h.realtime.message({type:'response.output_audio.delta',response_id:'response_1',item_id:'item_1',content_index:0,delta:payload});
  assert.equal(socket.sent.find(e=>e.event==='media').media.payload,payload);assert.equal(socket.sent.at(-1).event,'mark');await h.adapter.dispose();
});

test('barge-in은 clear와 mark로 확인된 재생 구간만 truncate하며 clear 뒤 늦은 mark/audio를 무시한다',async()=>{
  const h=harness(),socket=await connected(h),payload=Buffer.alloc(160,0xff).toString('base64');
  h.realtime.message({type:'response.created',response:{id:'response_1'}});
  const delta={type:'response.output_audio.delta',response_id:'response_1',item_id:'item_1',content_index:0,delta:payload};
  h.realtime.message(delta);socket.message({event:'mark',streamSid:stream,mark:{name:'p1'}});h.realtime.message(delta);
  h.realtime.message({type:'input_audio_buffer.speech_started'});
  assert.equal(socket.sent.at(-1).event,'clear');assert.equal(h.realtime.sent.find(e=>e.type==='response.cancel').response_id,'response_1');
  assert.deepEqual(h.realtime.sent.find(e=>e.type==='conversation.item.truncate'),{type:'conversation.item.truncate',item_id:'item_1',content_index:0,audio_end_ms:20});
  const count=socket.sent.length;socket.message({event:'mark',streamSid:stream,mark:{name:'p2'}});h.realtime.message(delta);
  assert.equal(socket.sent.length,count);await h.adapter.dispose();
});

test('AI 처리 안내 수락 전에는 문의 조건·예약 tool을 열지 않으며 조기 결과를 거부한다',async()=>{
  const h=harness();await connected(h);const session=h.realtime.sent[0].session;
  assert.deepEqual(session.tools.map(t=>t.name),['handoff','acknowledge_ai']);assert.doesNotMatch(session.instructions,/2026-12-03|정형외과 접수/);
  tool(h,'report_call_result',{outcome:'reported_booked',date:'2026-12-03',time:'14:00',reference:'R-1'});await tick();
  assert.equal(h.adapter.getReceipt('request_0001').reason,'invalid_tool');assert.equal(h.adapter.getReceipt('request_0001').result,null);
});

test('상대 회신은 별도 result tool로만 수집하며 모델의 예약 보고도 독립 확정으로 표시하지 않는다',async()=>{
  const h=harness();await connected(h);tool(h,'acknowledge_ai',{accepted:true});
  const update=h.realtime.sent.filter(e=>e.type==='session.update').at(-1);assert.match(update.session.instructions,/2026-12-03/);
  tool(h,'report_call_result',{outcome:'reported_booked',date:'2026-12-03',time:'14:30',reference:'R-1'},'tool_2');await tick();
  const result=h.adapter.getReceipt('request_0001');assert.equal(result.result.outcome,'reported_booked');assert.equal(result.result.source,'realtime_counterparty_report');
  assert.equal(result.result.requiresOperatorVerification,true);assert.equal(result.reservationConfirmed,false);assert.equal(result.terminationConfirmed,true);
});

test('본인확인·AI거절·결제·범위 밖 요청은 인계 후 종료한다',async()=>{
  for(const reason of ['identity_required','ai_refused','payment_required','out_of_scope']) {
    const h=harness();await connected(h);tool(h,'handoff',{reason});await tick();const r=h.adapter.getReceipt('request_0001');
    assert.equal(r.result.outcome,'handoff');assert.equal(r.reason,reason);assert.equal(r.reservationConfirmed,false);assert.equal(r.terminationConfirmed,true);assert.equal(h.calls.length,2);
  }
});

test('범위 밖 날짜·시각 또는 예약 권한 없는 booking 보고는 채택하지 않는다',async()=>{
  const h=harness();await connected(h);tool(h,'acknowledge_ai',{accepted:true});
  tool(h,'report_call_result',{outcome:'reported_booked',date:'2026-12-04',time:'14:30',reference:'R-1'},'tool_2');await tick();
  assert.equal(h.adapter.getReceipt('request_0001').reason,'out_of_scope');assert.equal(h.adapter.getReceipt('request_0001').result,null);
});

test('공급자 completed callback은 예약 성공을 만들지 않으며 서명·수신처 변조를 거부한다',async()=>{
  const h=harness();await h.adapter.start(input(),{mode:'live'});
  await assert.rejects(callback(h,'completed',{To:'+12025550199'}),{code:'AUTHENTICATION'});
  await callback(h,'completed');const r=h.adapter.getReceipt('request_0001');assert.equal(r.reservationConfirmed,false);assert.equal(r.result,null);assert.equal(r.terminationConfirmed,true);assert.equal(h.calls.length,1);
  await callback(h,'ringing');assert.equal(h.adapter.getReceipt('request_0001').status,'handoff');
});

test('180초가 지나면 서버가 hangup하고 모든 소켓을 닫는다',async()=>{
  const h=harness(),socket=await connected(h);await h.clock.advance(180000);
  const r=h.adapter.getReceipt('request_0001');assert.equal(r.reason,'duration_limit');assert.equal(r.terminationConfirmed,true);
  assert.equal(new URLSearchParams(h.calls.at(-1).body).get('Status'),'completed');assert.equal(socket.closes,1);assert.equal(h.realtime.closes,1);
});

test('소켓 실패·서버 dispose는 hangup하며 원문 공급자 오류를 receipt에 노출하지 않는다',async()=>{
  for(const failure of ['socket','provider','dispose']){
    const h=harness(),socket=await connected(h);
    if(failure==='socket')socket.emit('error',new Error('secret-provider-body'));
    else if(failure==='provider')h.realtime.message({type:'error',error:{message:'synthetic-key-never-network'}});
    else await h.adapter.dispose();
    await tick();assert.equal(h.calls.length,2);assert.equal(h.adapter.getReceipt('request_0001').terminationConfirmed,true);
    assert.doesNotMatch(JSON.stringify(h.receipts),/secret-provider-body|synthetic-key|auth-token|gpt-realtime/);
  }
});

test('생성 응답 유실은 재발신하지 않고 잠금을 유지한다',async()=>{
  let fetches=0;const h=harness({fetchImpl:async()=>{fetches++;throw new Error('PRIVATE PROVIDER ERROR');}});
  await assert.rejects(h.adapter.start(input(),{mode:'live'}),error=>error.code==='PROVIDER'&&!error.message.includes('PRIVATE'));
  assert.equal(fetches,1);assert.equal(h.ledger.active,true);assert.equal(h.adapter.getReceipt('request_0001').status,'creation_unknown');
  const other=input();other.requestId='request_0002';await assert.rejects(h.adapter.start(other,{mode:'live'}),{code:'BUSY'});assert.equal(fetches,1);
});

test('취소를 무시한 늦은 생성 성공도 hangup하고 재시도하지 않는다',async()=>{
  let resolveCreate;const requests=[];
  const h=harness({fetchImpl:(url,request)=>{requests.push({url,...request});return url.endsWith('/Calls.json')?new Promise(resolve=>{resolveCreate=resolve;}):Promise.resolve(terminalReply());}});
  const pending=h.adapter.start(input(),{mode:'live'});await tick();
  const failure=assert.rejects(pending,{code:'PROVIDER'});await h.clock.advance(10000);await failure;
  resolveCreate({ok:true,json:async()=>({sid,account_sid:account,to:'+12025550123',from:'+12025550124'})});await tick();await tick();
  assert.equal(requests.length,2);assert.match(requests[1].url,new RegExp(`${sid}\\.json$`));assert.equal(h.adapter.getReceipt('request_0001').terminationConfirmed,true);assert.equal(h.ledger.active,false);
});

test('생성 응답보다 먼저 온 인증된 Stream을 결합하고 완료 시 정리한다',async()=>{
  let resolveCreate;const h=harness({fetchImpl:async url=>url.endsWith('/Calls.json')?new Promise(resolve=>resolveCreate=resolve):terminalReply()});
  const pending=h.adapter.start(input(),{mode:'live'});await tick();const socket=new Socket();
  h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}});socket.message(streamStart());await tick();
  assert.equal(h.connects,1);resolveCreate({ok:true,json:async()=>({sid,account_sid:account,to:'+12025550123',from:'+12025550124'})});await pending;await h.adapter.dispose();assert.equal(socket.closes,1);
});

test('hangup 실패는 종료 완료를 만들지 않고 동시 발신 잠금을 유지한다',async()=>{
  let calls=0;const h=harness({fetchImpl:async()=>++calls===1?{ok:true,json:async()=>({sid,account_sid:account,to:'+12025550123',from:'+12025550124'})}:{ok:false}});
  await h.adapter.start(input(),{mode:'live'});await h.adapter.end('request_0001');const r=h.adapter.getReceipt('request_0001');
  assert.equal(r.terminationConfirmed,false);assert.equal(r.status,'termination_unknown');assert.equal(h.ledger.active,true);
  await callback(h,'completed');assert.equal(h.adapter.getReceipt('request_0001').terminationConfirmed,true);assert.equal(h.ledger.active,false);
});

test('로컬 ledger는 재시작 후 grant 재사용·동시 발신·일일 3회를 막고 민감정보를 저장하지 않는다',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'hondi-phone-test-'));
  t.after(async()=>{const target=resolve(directory);assert.equal(dirname(target),resolve(tmpdir()));assert.ok(basename(target).startsWith('hondi-phone-test-'));await rm(target,{recursive:true,force:true});});
  const options={directory,now:()=>epoch},a=createFilePhoneLedger(options),key=hashPhoneValue('grant_one');
  await a.reserve({grantKey:key});const b=createFilePhoneLedger(options);await assert.rejects(b.reserve({grantKey:hashPhoneValue('grant_two')}),{code:'BUSY'});
  assert.equal(await a.release({grantKey:key,terminalConfirmed:false}),false);await a.release({grantKey:key,terminalConfirmed:true});
  await assert.rejects(b.reserve({grantKey:key}),{code:'DUPLICATE'});
  for(const name of ['grant_two','grant_three']){const grantKey=hashPhoneValue(name);await b.reserve({grantKey});await b.release({grantKey,terminalConfirmed:true});}
  await assert.rejects(b.reserve({grantKey:hashPhoneValue('grant_four')}),{code:'LIMIT'});
  const contents=await Promise.all((await readdir(directory)).map(name=>readFile(join(directory,name),'utf8')));
  assert.doesNotMatch(contents.join(''),/\+1202|grant_one|synthetic-key|정형외과|transcript/);
});

test('운영자 listener에는 일반 앱용 발신 route가 없고 구성만으로 listen 또는 발신하지 않는다',async()=>{
  let disposed=0;class Server extends EventEmitter {clients=new Set();close(cb){cb();}handleUpgrade(){throw new Error('not used');}}
  const host=await createPhoneOperatorServer({adapter:{dispose:async()=>disposed++},publicOrigin:origin,WebSocketServerImpl:Server});
  assert.equal(host.server.listening,false);await host.dispose();assert.equal(disposed,1);
});

test('정상 cancel/done 경합 오류만 무시하며 새 응답의 음성은 계속 전달한다',async()=>{
  const h=harness(),socket=await connected(h),payload=Buffer.alloc(160,0xff).toString('base64');
  h.realtime.message({type:'response.created',response:{id:'old_response'}});
  h.realtime.message({type:'response.output_audio.delta',response_id:'old_response',item_id:'old_item',content_index:0,delta:payload});
  h.realtime.message({type:'input_audio_buffer.speech_started'});
  const cancel=h.realtime.sent.find(e=>e.type==='response.cancel');
  h.realtime.message({type:'response.done',response:{id:'old_response'}});
  h.realtime.message({type:'response.created',response:{id:'new_response'}});
  h.realtime.message({type:'error',error:{code:'response_cancel_not_active',event_id:cancel.event_id,message:'private provider text'}});
  h.realtime.message({type:'response.output_audio.delta',response_id:'new_response',item_id:'new_item',content_index:0,delta:payload});
  assert.equal(socket.closes,0);assert.equal(socket.sent.filter(e=>e.event==='media').length,2);assert.equal(h.calls.length,1);
  // The same code unrelated to our own cancel is still a provider error.
  h.realtime.message({type:'error',error:{code:'response_cancel_not_active',event_id:'unrelated'}});await tick();
  assert.equal(h.adapter.getReceipt('request_0001').reason,'provider_error');
});

test('수락 tool의 후속 response.create는 활성 응답 done 이후 한 번만 보낸다',async()=>{
  const h=harness();await connected(h);h.realtime.message({type:'response.created',response:{id:'consent_response'}});
  const before=h.realtime.sent.filter(e=>e.type==='response.create').length;
  tool(h,'acknowledge_ai',{accepted:true});assert.equal(h.realtime.sent.filter(e=>e.type==='response.create').length,before);
  h.realtime.message({type:'response.done',response:{id:'consent_response'}});
  assert.equal(h.realtime.sent.filter(e=>e.type==='response.create').length,before+1);
  h.realtime.message({type:'response.done',response:{id:'consent_response'}});
  assert.equal(h.realtime.sent.filter(e=>e.type==='response.create').length,before+1);await h.adapter.dispose();
});

test('알려진 create 경합 오류는 활성 응답 종료를 기다리고 재요청 폭주를 만들지 않는다',async()=>{
  const h=harness();await connected(h);const create=h.realtime.sent.find(e=>e.type==='response.create');
  h.realtime.message({type:'error',error:{code:'conversation_already_has_active_response',event_id:create.event_id}});
  assert.equal(h.realtime.sent.filter(e=>e.type==='response.create').length,1);
  h.realtime.message({type:'response.created',response:{id:'server_active'}});
  h.realtime.message({type:'response.done',response:{id:'server_active'}});
  assert.equal(h.realtime.sent.filter(e=>e.type==='response.create').length,2);await h.adapter.dispose();
});

test('REST 응답 전 terminal callback은 생성 완료까지 ledger를 해제하지 않는다',async()=>{
  let resolveCreate;const h=harness({fetchImpl:async()=>new Promise(resolve=>resolveCreate=resolve)});
  const pending=h.adapter.start(input(),{mode:'live'});await tick();await callback(h,'completed');
  assert.equal(h.ledger.active,true);const other=input();other.requestId='request_0002';
  await assert.rejects(h.adapter.start(other,{mode:'live'}),{code:'BUSY'});
  resolveCreate({ok:true,json:async()=>({sid,account_sid:account,to:'+12025550123',from:'+12025550124'})});await pending;
  assert.equal(h.ledger.active,false);assert.equal(h.adapter.getReceipt('request_0001').reservationConfirmed,false);
});

test('거절된 ledger 예약을 dispose해도 다른 작업의 잠금을 풀지 않는다',async()=>{
  const ledger=memoryLedger(),first=harness({ledger});await first.adapter.start(input(),{mode:'live'});
  const second=harness({ledger});await assert.rejects(second.adapter.start(input(),{mode:'live'}),{code:'BUSY'});
  await second.adapter.dispose();assert.equal(ledger.active,true);assert.equal(ledger.releases,0);await first.adapter.dispose();
});

test('CallSid 없는 생성 응답은 확인 불가이며 provider 원문을 노출하지 않는다',async()=>{
  const h=harness({fetchImpl:async()=>({ok:true,json:async()=>({error:'synthetic-key-never-network'})})});
  await assert.rejects(h.adapter.start(input(),{mode:'live'}),{code:'PROVIDER'});
  const r=h.adapter.getReceipt('request_0001');assert.equal(r.actualCallPlaced,null);assert.equal(r.status,'creation_unknown');assert.equal(h.ledger.active,true);
  assert.doesNotMatch(JSON.stringify(r),/synthetic-key/);
});

test('Realtime 연결 전에 전화 소켓이 닫히면 hangup하고 늦게 열린 소켓도 닫는다',async()=>{
  let resolveRealtime;const h=harness({connectRealtime:()=>new Promise(resolve=>resolveRealtime=resolve)});
  await h.adapter.start(input(),{mode:'live'});const socket=new Socket();
  h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}});socket.message(streamStart());await tick();
  socket.close();await tick();assert.equal(h.calls.length,2);
  const late=new Socket();resolveRealtime(late);await tick();assert.equal(late.closes,1);assert.equal(late.sent.length,0);
});

test('Realtime 연결이 지연되면 10초에 정리하고 늦은 연결을 사용하지 않는다',async()=>{
  let resolveRealtime;const h=harness({connectRealtime:()=>new Promise(resolve=>resolveRealtime=resolve)});
  await h.adapter.start(input(),{mode:'live'});const socket=new Socket();
  h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}});socket.message(streamStart());await tick();
  await h.clock.advance(10000);assert.equal(h.adapter.getReceipt('request_0001').terminationConfirmed,true);
  const late=new Socket();resolveRealtime(late);await tick();assert.equal(late.closes,1);
});

test('설정된 음성 형식이 다르거나 입력 버퍼가 넘치면 발신을 종료한다',async()=>{
  for(const fault of ['format','buffer']) {
    const h=harness();await h.adapter.start(input(),{mode:'live'});const socket=new Socket();
    h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}});socket.message(streamStart());await tick();
    if(fault==='format')h.realtime.message({type:'session.updated',session:{audio:{input:{format:{type:'audio/pcm'}},output:{format:{type:'audio/pcm'}}}}});
    else socket.message({event:'media',streamSid:stream,media:{track:'inbound',payload:Buffer.alloc(33000).toString('base64')}});
    await tick();assert.equal(socket.closes,1);assert.equal(h.adapter.getReceipt('request_0001').terminationConfirmed,true);
  }
});

test('실제 예약 권한이 없는 범위에서는 booking 보고를 거부한다',async()=>{
  const r=input();r.authorization.scopes=r.authorization.scopes.filter(s=>s!=='book');const h=harness();
  await h.adapter.start(r,{mode:'live'});const socket=new Socket();h.adapter.acceptMediaSocket({socket,url:`${origin}/phone/media`,headers:{'x-twilio-signature':signature(`${origin}/phone/media`)}});socket.message(streamStart());await tick();
  h.realtime.message({type:'session.updated',session:{audio:{input:{format:{type:'audio/pcmu'}},output:{format:{type:'audio/pcmu'}}}}});
  tool(h,'acknowledge_ai',{accepted:true});tool(h,'report_call_result',{outcome:'reported_booked',date:'2026-12-03',time:'14:30',reference:'R-1'},'tool_2');await tick();
  assert.equal(h.adapter.getReceipt('request_0001').result,null);assert.equal(h.adapter.getReceipt('request_0001').reason,'out_of_scope');
});

test('hangup의 HTTP 200만으로 종료를 확정하지 않고 동일 통화의 terminal 응답을 요구한다',async()=>{
  for(const body of [{},{sid,account_sid:account,status:'ringing'},{sid:'CA'+'4'.repeat(32),account_sid:account,status:'completed'},
    {sid,account_sid:'AC'+'4'.repeat(32),status:'completed'}]) {
    const h=harness({fetchImpl:async url=>({ok:true,json:async()=>url.endsWith('/Calls.json')?{sid,account_sid:account,to:'+12025550123',from:'+12025550124'}:body})});
    await h.adapter.start(input(),{mode:'live'});await h.adapter.end('request_0001');
    assert.equal(h.adapter.getReceipt('request_0001').terminationConfirmed,false);assert.equal(h.ledger.active,true);
  }
});

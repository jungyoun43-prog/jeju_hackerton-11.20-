import {randomBytes} from 'node:crypto';
import {validatePhoneRequest,dryRunPhoneReceipt,phoneError} from './phone-policy.mjs';
import {validateTwilioConfiguration,createTwilioTransport,verifyTwilioSignature,isCallSid,isStreamSid} from './phone-twilio.mjs';
import {createPhoneMediaBridge,connectPhoneRealtime} from './phone-bridge.mjs';
import {createFilePhoneLedger} from './phone-ledger.mjs';

const terminalStatuses=new Set(['completed','busy','failed','no-answer','canceled']);
const statuses=new Set(['queued','initiated','ringing','in-progress',...terminalStatuses]);
const close=socket=>{try{socket?.close(1000,'ended');}catch{try{socket?.terminate();}catch{}}};
const header=(headers,name)=>typeof headers?.get==='function'?headers.get(name):headers?.[name];
const safeReason=reason=>['operator_stop','disposed','duration_limit','create_timeout','provider_error','socket_failure','socket_closed','stream_stopped',
  'realtime_timeout','audio_format','protocol_error','audio_backpressure','invalid_tool','stream_mismatch','result_received',
  'identity_required','ai_refused','payment_required','out_of_scope','processing_refused','uncertain','provider_terminal'].includes(reason)?reason:'uncertain';

/** Standalone operator service. Importing or constructing it never places a call. */
export function createPhoneAdapter({env=process.env,fetchImpl=globalThis.fetch,connectRealtime=connectPhoneRealtime,
  ledger,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,makeToken=()=>randomBytes(32).toString('base64url'),onReceipt=()=>{}}={}) {
  const attempts=new Map(),tokens=new Map(),unbound=new Set();
  let disposed=false,busy=null,config=null,transport=null,store=ledger;
  function receipt(entry) {
    return {requestId:entry.request.requestId,mode:'real',source:'twilio_outbound_adapter',status:entry.status,
      actualCallPlaced:entry.actualCallPlaced,reservationConfirmed:false,clinicalAcceptanceConfirmed:false,
      automaticRetry:false,terminationConfirmed:entry.terminalConfirmed,reason:entry.reason||null,result:entry.result?{...entry.result}:null};
  }
  function publish(entry){try{onReceipt(receipt(entry));}catch{}}
  async function release(entry) {
    if(!entry.reserved || !entry.terminalConfirmed || entry.unreconciled || entry.networkAttempted&&!entry.creationSettled)return;
    try{await store.release({grantKey:entry.request.grantKey,terminalConfirmed:true});}catch{return;}
    if(busy===entry)busy=null;
  }
  async function hangup(entry) {
    if(entry.terminalConfirmed){await release(entry);return;}
    if(!entry.callSid)return;
    if(entry.hangupPromise)return entry.hangupPromise;
    entry.hangupPromise=(async()=>{
      const controller=new AbortController();let timer;
      try {
        await Promise.race([transport.hangup(entry.callSid,{signal:controller.signal}),new Promise((_,reject)=>{
          timer=setTimer(()=>{controller.abort();reject(phoneError('PROVIDER'));},5000);timer?.unref?.();
        })]);
        entry.terminalConfirmed=!entry.unreconciled;
      }catch{entry.status='termination_unknown';}
      finally{clearTimer(timer);await release(entry);publish(entry);}
    })();
    return entry.hangupPromise;
  }
  async function stop(entry,reason='operator_stop') {
    if(!entry.ended) {
      entry.ended=true;entry.reason=safeReason(reason);entry.status=entry.result?'result_reported':'handoff';
      clearTimer(entry.timer);entry.controller.abort();entry.removeAbort?.();
      entry.bridge?.close(entry.reason);close(entry.socket);close(entry.realtime);publish(entry);
    }
    if(!entry.networkAttempted)entry.terminalConfirmed=true;
    await hangup(entry);return receipt(entry);
  }
  async function start(input,{mode='dry-run',signal}={}) {
    if(disposed)throw phoneError('CLOSED');
    if(!['dry-run','live'].includes(mode))throw phoneError('INVALID_REQUEST');
    const request=validatePhoneRequest(input,{env,now:now(),live:mode==='live'});
    if(mode==='dry-run')return dryRunPhoneReceipt(request);
    if(signal?.aborted)throw phoneError('CLOSED');
    if(attempts.has(request.requestId))throw phoneError('DUPLICATE');
    if(busy)throw phoneError('BUSY');
    if(attempts.size>=100)throw phoneError('LIMIT');
    config ||= validateTwilioConfiguration(env);
    transport ||= createTwilioTransport({config,fetchImpl});
    store ||= createFilePhoneLedger({now});
    if(store.persistent!==true||typeof store.reserve!=='function'||typeof store.release!=='function')throw phoneError('CONFIGURATION');
    const token=makeToken();if(!/^[A-Za-z0-9_-]{32,100}$/.test(token)||tokens.has(token))throw phoneError('CONFIGURATION');
    const entry={request,token,callSid:null,controller:new AbortController(),actualCallPlaced:false,terminalConfirmed:false,
      status:'creating',ended:false,bridge:null,socket:null,result:null};
    busy=entry;attempts.set(request.requestId,entry);
    try{await store.reserve({grantKey:request.grantKey});entry.reserved=true;}catch(error){if(busy===entry)busy=null;throw error?.name==='PhoneAdapterError'?error:phoneError('LIMIT');}
    tokens.set(token,entry);
    const abort=()=>{void stop(entry,'operator_stop');};signal?.addEventListener('abort',abort,{once:true});
    entry.removeAbort=()=>signal?.removeEventListener('abort',abort);
    if(disposed||signal?.aborted){await stop(entry,'operator_stop');throw phoneError('CLOSED');}
    entry.timer=setTimer(()=>{void stop(entry,'duration_limit');},request.limits.maxDurationSeconds*1000);entry.timer?.unref?.();
    let createTimer;
    entry.networkAttempted=true;entry.actualCallPlaced=null;
    const creation=transport.create(request,{token,signal:entry.controller.signal}).then(async({callSid})=>{
      entry.creationSettled=true;
      if(entry.callSid && entry.callSid!==callSid) {
        // A mismatched late REST result must not leave a second call alive.
        entry.unreconciled=true;entry.terminalConfirmed=false;
        void transport.hangup(callSid,{signal:AbortSignal.timeout(5000)}).catch(()=>{});
        await stop(entry,'stream_mismatch');throw phoneError('PROVIDER');
      }
      entry.callSid=callSid;entry.actualCallPlaced=true;
      if(entry.ended||disposed){await stop(entry,'operator_stop');return;}
      entry.status=entry.bridge?'connected':'dialing';publish(entry);
    },error=>{entry.creationSettled=true;throw error;});
    // Observe late success even when the transport ignores abort. No create retry is performed.
    creation.catch(()=>{});
    try {
      await Promise.race([creation,new Promise((_,reject)=>{
        createTimer=setTimer(()=>{entry.controller.abort();reject(phoneError('PROVIDER'));},10000);createTimer?.unref?.();
      })]);
      if(entry.ended)return receipt(entry);
      return receipt(entry);
    }catch {
      await stop(entry,'provider_error');
      if(!entry.callSid)entry.status='creation_unknown';
      publish(entry);throw phoneError('PROVIDER');
    }finally{clearTimer(createTimer);}
  }
  async function handleStatusCallback({url,headers,body}) {
    if(!config || typeof body!=='string'||Buffer.byteLength(body)>32768)throw phoneError('AUTHENTICATION');
    const prefix=`${config.origin}/phone/status/`;
    if(typeof url!=='string'||!url.startsWith(prefix))throw phoneError('AUTHENTICATION');
    const token=url.slice(prefix.length),entry=tokens.get(token),params=new URLSearchParams(body);
    if(!entry || !verifyTwilioSignature({authToken:config.authToken,url,params,signature:header(headers,'x-twilio-signature')}))throw phoneError('AUTHENTICATION');
    for(const field of ['CallSid','AccountSid','To','From','CallStatus'])if(params.getAll(field).length!==1)throw phoneError('AUTHENTICATION');
    const callSid=params.get('CallSid'),status=params.get('CallStatus');
    if(!isCallSid(callSid)||params.get('AccountSid')!==config.accountSid||params.get('To')!==entry.request.recipient.phone
      || params.get('From')!==entry.request.caller.phone || !statuses.has(status) || entry.callSid&&entry.callSid!==callSid)throw phoneError('AUTHENTICATION');
    entry.callSid=callSid;entry.actualCallPlaced=true;
    if(terminalStatuses.has(status)) {
      entry.terminalConfirmed=true;await stop(entry,'provider_terminal');
    }else if(entry.ended||disposed)await hangup(entry);
    else {entry.status=status;publish(entry);}
    return {ok:true}; // completed describes the call connection, never a booking.
  }
  function acceptMediaSocket({socket,url,headers}) {
    const signatureUrl=config?`${config.origin}/phone/media`:'';
    if(disposed||!config||unbound.size>=4||url!==signatureUrl||!verifyTwilioSignature({authToken:config.authToken,url:signatureUrl,signature:header(headers,'x-twilio-signature')})) {
      close(socket);return false;
    }
    let bound=false,failed=false,entry=null,queue=[],queueBytes=0;
    unbound.add(socket);
    const timer=setTimer(()=>reject(),5000);timer?.unref?.();
    function reject() {if(failed)return;failed=true;clearTimer(timer);unbound.delete(socket);close(socket);if(entry)void stop(entry,'stream_mismatch');}
    const fail=()=>{if(bound&&entry)void stop(entry,'socket_closed');else reject();};socket.on('close',fail);socket.on('error',fail);
    async function first(raw) {
      if(failed)return;
      const data=raw?.data??raw;if(!(typeof data==='string'||Buffer.isBuffer(data))||Buffer.byteLength(data)>65536){reject();return;}
      let event;try{event=JSON.parse(String(data));}catch{reject();return;}
      if(bound) {
        queueBytes+=Buffer.byteLength(data);if(queueBytes>48000){reject();return;}queue.push(data);return;
      }
      if(event.event==='connected')return;
      if(event.event!=='start'){reject();return;}
      const s=event.start,candidate=tokens.get(s?.customParameters?.token);
      if(!candidate||candidate.ended||candidate.socket||!isCallSid(s.callSid)||!isStreamSid(event.streamSid)
        || s.streamSid&&s.streamSid!==event.streamSid || s.accountSid!==config.accountSid || candidate.callSid&&candidate.callSid!==s.callSid
        || s.mediaFormat?.encoding!=='audio/x-mulaw'||s.mediaFormat?.sampleRate!==8000||s.mediaFormat?.channels!==1
        || !Array.isArray(s.tracks)||s.tracks.length!==1||s.tracks[0]!=='inbound'){reject();return;}
      entry=candidate;bound=true;entry.socket=socket;entry.callSid=s.callSid;entry.actualCallPlaced=true;
      clearTimer(timer);unbound.delete(socket);
      let connectTimer;
      try {
        const connection=Promise.resolve().then(()=>connectRealtime({apiKey:env.OPENAI_API_KEY}));
        connection.then(socket=>{if(entry.ended||failed||disposed)close(socket);},()=>{});
        const realtime=await Promise.race([connection,new Promise((_,reject)=>{
          connectTimer=setTimer(()=>reject(new Error('connection_timeout')),10000);connectTimer?.unref?.();
        })]);entry.realtime=realtime;
        if(disposed||entry.ended||failed){close(realtime);await stop(entry,'socket_closed');return;}
        socket.removeListener('message',first);
        entry.bridge=createPhoneMediaBridge({request:entry.request,twilio:socket,realtime,streamSid:event.streamSid,setTimer,clearTimer,
          onEnd:reason=>stop(entry,reason),onResult:result=>{if(!entry.ended){entry.result=result;publish(entry);}}});
        entry.status='connected';publish(entry);
        for(const frame of queue)entry.bridge.receiveTwilio(frame);queue=[];
      }catch{await stop(entry,'socket_failure');}finally{clearTimer(connectTimer);}
    }
    socket.on('message',first);return true;
  }
  return {
    start,handleStatusCallback,acceptMediaSocket,
    getReceipt(requestId){const entry=attempts.get(requestId);return entry?receipt(entry):null;},
    async end(requestId){const entry=attempts.get(requestId);return entry?stop(entry):null;},
    async dispose(){disposed=true;for(const socket of unbound)close(socket);unbound.clear();await Promise.all([...attempts.values()].map(entry=>stop(entry,'disposed')));},
  };
}

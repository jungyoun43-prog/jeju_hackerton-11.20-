import {phoneInstructions,phoneTools,validatePhoneResult,PHONE_HANDOFF_REASONS} from './phone-policy.mjs';

const MAX_MESSAGE=65536;
const MAX_BUFFER_BYTES=32000; // Four seconds of 8 kHz mu-law; never an unbounded transcript/audio buffer.
const MAX_SOCKET_BUFFER=256000;
const bytesOf = value => typeof value==='string' && value.length<=MAX_MESSAGE && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ? Buffer.from(value,'base64').length : 0;
function parse(data) {
  const raw=data?.data ?? data;
  if(!(typeof raw==='string'||Buffer.isBuffer(raw)) || Buffer.byteLength(raw)>MAX_MESSAGE)return null;
  try{return JSON.parse(String(raw));}catch{return null;}
}
const send=(socket,value)=>{
  if(socket.readyState!==1 || socket.bufferedAmount>MAX_SOCKET_BUFFER)throw new Error('socket_not_ready');
  socket.send(JSON.stringify(value));
};
const close=socket=>{try{socket?.close(1000,'ended');}catch{try{socket?.terminate();}catch{}}};

export function phoneRealtimeSession(request,{accepted=false}={}) {
  return {type:'realtime',model:'gpt-realtime-2.1',output_modalities:['audio'],max_output_tokens:768,
    instructions:phoneInstructions(request,{accepted}),tools:phoneTools({accepted}),tool_choice:'auto',
    audio:{input:{format:{type:'audio/pcmu'},turn_detection:{type:'server_vad',create_response:true,interrupt_response:false}},
      output:{format:{type:'audio/pcmu'},voice:'marin'}}};
}

/** Optional ws package is loaded only after the operator has passed every live guard. */
export async function connectPhoneRealtime({apiKey}) {
  const {WebSocket}=await import('ws');
  return new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1',{
    headers:{Authorization:`Bearer ${apiKey}`},maxPayload:MAX_MESSAGE,handshakeTimeout:10000,
  });
}

/** A bound Twilio stream only. No global server route, logging, recording or persistent audio. */
export function createPhoneMediaBridge({request,twilio,realtime,streamSid,onEnd,onResult,
  setTimer=setTimeout,clearTimer=clearTimeout}) {
  let closed=false,configured=false,accepted=false,configSent=false,activeResponse=null,currentItem=null;
  let buffered=[],bufferedBytes=0,markSequence=0,requestSequence=0,pendingResponse=false,responseRequested=null;
  const toolCalls=new Set(),marks=new Map(),items=new Map(),interrupted=new Set(),cancelRequests=new Map();
  const timer=setTimer(()=>finish('realtime_timeout'),10000);timer?.unref?.();
  function finish(reason) {
    if(closed)return;
    closed=true;clearTimer(timer);buffered=[];bufferedBytes=0;marks.clear();items.clear();
    // Publish the cause before closing sockets; synchronous close events must not replace it.
    void onEnd(reason);close(realtime);close(twilio);
  }
  function safeSend(socket,value){try{send(socket,value);return true;}catch{finish('socket_failure');return false;}}
  function open() {
    if(closed||configSent)return;configSent=true;
    safeSend(realtime,{type:'session.update',session:phoneRealtimeSession(request)});
  }
  function output(value){return safeSend(realtime,value);}
  function requestResponse() {
    if(activeResponse||responseRequested){pendingResponse=true;return;}
    pendingResponse=false;responseRequested=`phone_response_${++requestSequence}`;
    output({type:'response.create',event_id:responseRequested});
  }
  function acknowledge(callId,value) {
    return output({type:'conversation.item.create',item:{type:'function_call_output',call_id:callId,output:JSON.stringify(value)}});
  }
  function handleTool(event) {
    if(!/^[A-Za-z0-9_-]{1,150}$/.test(event.call_id??'') || toolCalls.has(event.call_id))return;
    toolCalls.add(event.call_id);
    if(toolCalls.size>20){finish('protocol_error');return;}
    let value;try{if(typeof event.arguments!=='string'||event.arguments.length>4096)throw new Error();value=JSON.parse(event.arguments);}catch{finish('invalid_tool');return;}
    if(event.name==='handoff') {
      const reason=PHONE_HANDOFF_REASONS.includes(value?.reason)?value.reason:'uncertain';
      onResult({outcome:'handoff',reason,source:'realtime_counterparty_report',reservationConfirmed:false,requiresOperatorVerification:true,clinicalAcceptanceConfirmed:false});
      acknowledge(event.call_id,{ok:true,action:'handoff'});finish(reason);return;
    }
    if(event.name==='acknowledge_ai'&&!accepted) {
      if(value?.accepted!==true || Object.keys(value).some(k=>k!=='accepted')){finish('processing_refused');return;}
      accepted=true;acknowledge(event.call_id,{ok:true});
      output({type:'session.update',session:{type:'realtime',instructions:phoneInstructions(request,{accepted:true}),tools:phoneTools({accepted:true})}});
      requestResponse();return;
    }
    if(event.name!=='report_call_result'||!accepted){finish('invalid_tool');return;}
    const result=validatePhoneResult(value,request);
    if(!result){finish('out_of_scope');return;}
    onResult(result);acknowledge(event.call_id,{ok:true,requiresOperatorVerification:true});finish('result_received');
  }
  function bargeIn() {
    if(activeResponse){
      interrupted.add(activeResponse);const eventId=`phone_cancel_${++requestSequence}`;cancelRequests.set(eventId,activeResponse);
      output({type:'response.cancel',event_id:eventId,response_id:activeResponse});
    }
    // Clear first and forget pending marks: Twilio also acknowledges marks for discarded audio.
    if(marks.size||currentItem)safeSend(twilio,{event:'clear',streamSid});
    marks.clear();
    const item=items.get(currentItem);
    if(item) {
      item.interrupted=true;
      output({type:'conversation.item.truncate',item_id:currentItem,content_index:item.contentIndex,
        audio_end_ms:Math.floor(item.playedBytes/8)});
    }
    currentItem=null;
  }
  function onRealtime(raw) {
    if(closed)return;
    const e=parse(raw);if(!e||typeof e.type!=='string'){finish('protocol_error');return;}
    if(e.type==='error'){
      const failedEvent=e.error?.event_id;
      if(e.error?.code==='response_cancel_not_active'&&cancelRequests.has(failedEvent)) {
        const target=cancelRequests.get(failedEvent);cancelRequests.delete(failedEvent);
        if(activeResponse===target){activeResponse=null;if(pendingResponse)requestResponse();}
        return;
      }
      if(e.error?.code==='conversation_already_has_active_response'&&failedEvent===responseRequested) {
        responseRequested=null;pendingResponse=true;return; // Wait for the server's active response.done, never retry immediately.
      }
      finish('provider_error');return;
    }
    if(e.type==='session.updated'&&!configured) {
      if(e.session?.audio?.input?.format?.type!=='audio/pcmu'||e.session?.audio?.output?.format?.type!=='audio/pcmu'){finish('audio_format');return;}
      configured=true;clearTimer(timer);
      for(const audio of buffered)if(!output({type:'input_audio_buffer.append',audio}))return;
      buffered=[];bufferedBytes=0;requestResponse();return;
    }
    if(!configured)return;
    if(e.type==='response.created'){
      if(typeof e.response?.id!=='string'){finish('protocol_error');return;}
      activeResponse=e.response.id;responseRequested=null;return;
    }
    if(e.type==='response.done'){
      if(e.response?.id===activeResponse||!activeResponse){activeResponse=null;if(pendingResponse)requestResponse();}
      return;
    }
    if(e.type==='input_audio_buffer.speech_started'){bargeIn();return;}
    if(e.type==='response.function_call_arguments.done'){handleTool(e);return;}
    if(e.type!=='response.output_audio.delta')return;
    if(interrupted.has(e.response_id))return;
    const size=bytesOf(e.delta);
    if(!size||typeof e.item_id!=='string'||e.item_id.length>150||!Number.isInteger(e.content_index)||e.content_index<0){finish('audio_format');return;}
    const item=items.get(e.item_id)||{sentBytes:0,playedBytes:0,contentIndex:e.content_index,interrupted:false};
    if(item.interrupted)return;
    if(items.size>=100&&!items.has(e.item_id)){finish('protocol_error');return;}
    item.sentBytes+=size;items.set(e.item_id,item);currentItem=e.item_id;
    const name=`p${++markSequence}`;marks.set(name,{itemId:e.item_id,endBytes:item.sentBytes});
    if(marks.size>500){finish('audio_backpressure');return;}
    if(safeSend(twilio,{event:'media',streamSid,media:{payload:e.delta}}))safeSend(twilio,{event:'mark',streamSid,mark:{name}});
  }
  function onTwilio(raw) {
    if(closed)return;
    const e=parse(raw);if(!e || e.streamSid!==streamSid){finish('stream_mismatch');return;}
    if(e.event==='stop'){finish('stream_stopped');return;}
    if(e.event==='mark') {
      const mark=marks.get(e.mark?.name);if(!mark)return;
      marks.delete(e.mark.name);const item=items.get(mark.itemId);
      if(item&&!item.interrupted)item.playedBytes=Math.max(item.playedBytes,mark.endBytes);
      return;
    }
    if(e.event!=='media'){finish('protocol_error');return;}
    if(e.media?.track!=='inbound'){finish('audio_format');return;}
    const size=bytesOf(e.media.payload);if(!size){finish('audio_format');return;}
    if(!configured) {
      bufferedBytes+=size;if(bufferedBytes>MAX_BUFFER_BYTES){finish('audio_backpressure');return;}
      buffered.push(e.media.payload);return;
    }
    output({type:'input_audio_buffer.append',audio:e.media.payload});
  }
  realtime.on('open',open);realtime.on('message',onRealtime);
  realtime.on('error',()=>finish('socket_failure'));realtime.on('close',()=>finish('socket_closed'));
  twilio.on('message',onTwilio);twilio.on('error',()=>finish('socket_failure'));twilio.on('close',()=>finish('socket_closed'));
  if(realtime.readyState===1)open();
  return {close:reason=>finish(reason||'operator_stop'),receiveTwilio:onTwilio,get closed(){return closed;}};
}

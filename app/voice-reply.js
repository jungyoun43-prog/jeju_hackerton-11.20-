/** WebRTC 음성은 사용자가 시작할 때만 열며, 혼디 서버에 원음·전사를 저장하지 않는다. */
export function createRealtimeVoice({onState=()=>{},onTranscript=()=>{},onConditions=()=>{},fetchImpl=fetch,mediaDevices=navigator.mediaDevices,Peer=globalThis.RTCPeerConnection,audioFactory=()=>document.createElement('audio'),endTimeoutMs=8000}={}) {
  let generation=0,peer,stream,channel,audio,token,timer,controller,active=false;
  let assistant='',transcripts=new Map(),toolIds=new Set(),seed='',ending=false,endPromise;
  const state=(status,extra={})=>onState({status,active,ending,assistant,...extra});
  const end=async value=>{
    if(!value)return true;
    const abort=new AbortController();let timeout;
    try{return await Promise.race([
      fetchImpl('/api/voice/end',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:value}),keepalive:true,signal:abort.signal}).then(response=>response.ok).catch(()=>false),
      new Promise(resolve=>{timeout=setTimeout(()=>{abort.abort();resolve(false);},endTimeoutMs);}),
    ]);}finally{clearTimeout(timeout);}
  };
  function release(){clearTimeout(timer);controller?.abort();channel?.close();peer?.close();stream?.getTracks().forEach(track=>track.stop());if(audio){audio.pause();audio.srcObject=null;audio.remove?.();}channel=peer=stream=audio=undefined;}
  async function stop(){
    if(ending)return endPromise;
    const version=++generation;active=false;release();const old=token;token=undefined;ending=Boolean(old);state(ending?'ending':'ended');
    endPromise=end(old);const confirmed=await endPromise;
    if(version===generation){ending=false;state('ended',confirmed?{}:{error:'마이크는 껐어요. 서버 종료를 확인하지 못했어요. 자동 종료 제한은 유지됩니다.'});}
    return confirmed;
  }
  async function start({region,draft=''}) {
    if(active||ending)return;
    if(!Peer||!mediaDevices?.getUserMedia){state('error',{error:'이 브라우저에서 실시간 음성을 사용할 수 없어요. 글로 계속할 수 있습니다.'});return;}
    const version=++generation;active=true;assistant='';transcripts=new Map();toolIds=new Set();seed=draft.trim();state('connecting');
    const current=()=>version===generation;
    const send=event=>{if(current()&&channel?.readyState==='open')channel.send(JSON.stringify(event));};
    try {
      const acquired=await mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
      if(!current()){acquired.getTracks().forEach(track=>track.stop());return;}stream=acquired;
      peer=new Peer();audio=audioFactory();audio.autoplay=true;audio.setAttribute?.('playsinline','');
      peer.ontrack=event=>{if(!current())return;audio.srcObject=event.streams[0];const playing=audio.play?.();playing?.catch(()=>{if(current())state('playback_blocked',{error:'소리 재생이 막혔어요. 소리 듣기를 눌러 주세요.'});});};
      for(const track of stream.getAudioTracks())peer.addTrack(track,stream);
      peer.onconnectionstatechange=()=>{if(!current())return;if(['failed','closed','disconnected'].includes(peer.connectionState)){void stop();state('error',{error:'음성 연결이 끊겼어요. 입력된 내용은 남아 있습니다.'});}};
      channel=peer.createDataChannel('oai-events');
      channel.onopen=()=>{if(!current())return;state('listening');send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text:`${region==='jeju'?'제주':'내륙'} 진료 준비를 시작합니다.${seed?` 작성 중인 요청: ${seed}`:''} 짧게 인사하고 아직 모르는 조건 하나만 물어봐 주세요.`}]}});send({type:'response.create'});};
      channel.onmessage=event=>{
        if(!current()||typeof event.data!=='string'||event.data.length>64000)return;
        let item;try{item=JSON.parse(event.data);}catch{return;}
        if(item.type==='input_audio_buffer.speech_started'){assistant='';state('listening');}
        if(item.type==='input_audio_buffer.speech_stopped')state('thinking');
        if(item.type==='response.created'){assistant='';state('thinking');}
        if(item.type==='response.output_audio_transcript.delta'){assistant=(assistant+String(item.delta||'')).slice(0,3200);state('speaking');}
        if(item.type==='response.output_audio_transcript.done'){assistant=String(item.transcript||assistant).slice(0,3200);state('speaking');}
        if(item.type==='output_audio_buffer.stopped')state('listening');
        if(item.type==='conversation.item.input_audio_transcription.delta'||item.type==='conversation.item.input_audio_transcription.completed'){
          const id=String(item.item_id||'current');
          transcripts.set(id,item.type.endsWith('.completed')?String(item.transcript||''):(transcripts.get(id)||'')+String(item.delta||''));
          const text=[seed,...transcripts.values()].filter(Boolean).join('\n');
          if(text.length<=1600)onTranscript(text);else{void stop();state('error',{error:'입력 한도에 도달해 음성을 멈췄어요. 현재 내용을 확인해 주세요.'});}
        }
        if(item.type==='response.function_call_arguments.done'&&item.name==='update_preparation'&&!toolIds.has(item.call_id)){
          toolIds.add(item.call_id);let accepted=false;
          try{const args=JSON.parse(item.arguments);if(typeof args.text==='string'&&args.text.trim()&&args.text.length<=1600){onConditions(args.text);accepted=true;}}catch{/* 잘못된 도구 인자는 화면에 적용하지 않는다. */}
          send({type:'conversation.item.create',item:{type:'function_call_output',call_id:item.call_id,output:JSON.stringify({updated:accepted,reservationConfirmed:false})}});send({type:'response.create'});
        }
        if(item.type==='error'){void stop();state('error',{error:'음성 응답을 처리하지 못했어요. 입력된 내용을 글로 확인해 주세요.'});}
      };
      channel.onclose=()=>{if(current())void stop();};
      const offer=await peer.createOffer();if(!current())return;await peer.setLocalDescription(offer);if(!current())return;
      controller=new AbortController();
      const response=await fetchImpl('/api/voice/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sdp:offer.sdp,region}),signal:controller.signal});
      const data=await response.json();
      if(!current()){await end(data?.token);return;}
      if(!response.ok)throw new Error(['VOICE_DAILY_LIMIT','VOICE_NOT_CONFIGURED','VOICE_QUOTA_EXHAUSTED','VOICE_BUSY'].includes(data?.error?.code)?data.error.code:'VOICE_UNAVAILABLE');
      if(typeof data.sdp!=='string'||typeof data.token!=='string')throw new Error('VOICE_UNAVAILABLE');
      token=data.token;await peer.setRemoteDescription({type:'answer',sdp:data.sdp});if(!current())return;
      const seconds=Math.min(180,Math.max(1,Number(data.expiresIn)||180));timer=setTimeout(()=>{void stop();state('ended',{error:'3분 대화를 마쳤어요. 모은 조건을 확인하고 이어가세요.'});},seconds*1000);
    } catch(error) {
      if(!current())return;const ending=stop(),stoppedVersion=generation;await ending;if(generation!==stoppedVersion)return;
      const messages={NotAllowedError:'마이크 사용을 허용하지 않았어요. 글로 계속하거나 브라우저 권한을 확인해 주세요.',NotFoundError:'마이크를 찾지 못했어요. 글로 계속할 수 있습니다.',VOICE_DAILY_LIMIT:'오늘의 음성 대화 한도에 도달했어요. 글이나 직접 선택으로 계속할 수 있습니다.',VOICE_NOT_CONFIGURED:'음성 연결이 준비되지 않았어요. 글이나 직접 선택으로 계속할 수 있습니다.',VOICE_QUOTA_EXHAUSTED:'음성 API 이용 잔액을 확인해 주세요. 입력한 내용은 그대로예요.',VOICE_BUSY:'다른 음성 대화가 진행 중이에요. 잠시 후 다시 시작하거나 글로 계속해 주세요.'};
      state('error',{error:messages[error.name]||messages[error.message]||'음성 연결을 시작하지 못했어요. 글이나 직접 선택으로 계속할 수 있습니다.'});
    }
  }
  return {start,stop,resumeAudio:()=>audio?.play?.().catch(()=>state('playback_blocked',{error:'브라우저의 소리 재생 권한을 확인해 주세요.'})),get active(){return active;}};
}

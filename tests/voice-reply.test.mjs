import test from 'node:test';
import assert from 'node:assert/strict';
import {createRealtimeVoice} from '../app/voice-reply.js';

function fixture(endResponse=()=>Promise.resolve({ok:true})) {
  const states=[],conditions=[];let stopped=0,peer;
  class Peer {
    constructor(){peer=this;}
    addTrack(){}
    createDataChannel(){return this.channel={readyState:'open',send(){},close(){}};}
    async createOffer(){return {sdp:'fixture'};}
    async setLocalDescription(){}
    async setRemoteDescription(){this.channel.onopen();}
    close(){this.closed=true;}
  }
  const track={stop(){stopped++;}};
  const voice=createRealtimeVoice({Peer,endTimeoutMs:30,onState:s=>states.push(s),onConditions:t=>conditions.push(t),
    mediaDevices:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})},
    audioFactory:()=>({pause(){},remove(){},setAttribute(){}}),
    fetchImpl:async url=>url.endsWith('/end')?endResponse():{ok:true,json:async()=>({sdp:'fixture',token:'fixture',expiresIn:180})},
  });
  return {voice,states,conditions,get stopped(){return stopped;},get peer(){return peer;}};
}
test('종료 요청이 멈춰도 마이크는 즉시 닫고 제한 시간 안에 오류를 돌려준다',async()=>{
  const f=fixture(()=>new Promise(()=>{}));await f.voice.start({region:'jeju'});
  const end=f.voice.stop();assert.equal(f.stopped,1);assert.equal(f.peer.closed,true);assert.equal(f.voice.active,false);
  assert.equal(await end,false);assert.match(f.states.at(-1).error,/서버 종료를 확인/);
  f.peer.channel.onmessage({data:JSON.stringify({type:'response.function_call_arguments.done',name:'update_preparation',call_id:'late',arguments:'{"text":"늦은 변경"}'})});
  assert.deepEqual(f.conditions,[]);
});
test('종료 확인 중 다시 시작해도 추가 세션을 만들지 않는다',async()=>{
  let finish;const f=fixture(()=>new Promise(resolve=>{finish=resolve;}));
  await f.voice.start({region:'jeju'});const end=f.voice.stop();await f.voice.start({region:'seoul'});
  assert.equal(f.voice.active,false);assert.equal(f.states.at(-1).status,'ending');
  finish({ok:true});await end;await f.voice.start({region:'seoul'});assert.equal(f.voice.active,true);assert.equal(f.states.at(-1).status,'listening');
  const cleanup=f.voice.stop();finish({ok:true});await cleanup;
});

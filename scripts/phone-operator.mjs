import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createPhoneAdapter} from '../agent/phone-adapter.mjs';
import {createPhoneOperatorServer} from '../agent/phone-operator-server.mjs';
import {validatePhoneRequest,phoneError} from '../agent/phone-policy.mjs';
import {validateTwilioConfiguration} from '../agent/phone-twilio.mjs';

// Operator CLI only. The public application has no route that can trigger this runner.
export function previewPhoneRequest(now=Date.now()) {
  return {requestId:'preview_no_call',purpose:'hospital',recipient:{phone:'+12025550123',label:'가상 병원 접수 창구'},
    schedule:{date:new Date(now+86400000).toISOString().slice(0,10),earliestTime:'14:00',latestTime:'15:00',timeZone:'Asia/Seoul',service:'진료 접수 가능 시간 문의'},
    limits:{maxDurationSeconds:180,ringSeconds:15,windowStart:new Date(now-60000).toISOString(),windowEnd:new Date(now+600000).toISOString(),
      cost:{currency:'USD',maxTotal:2,perMinuteUpperBound:0.5,fixedUpperBound:0.2}}};
}

export async function runPhoneOperator({args=[],env=process.env,write=message=>console.log(message),
  makeAdapter=createPhoneAdapter,makeServer=createPhoneOperatorServer,load=path=>readFile(path,'utf8')}={}) {
  if(args.length===0 || (args.length===1&&args[0]==='--dry-run')) {
    const adapter=makeAdapter({env:{}}); // Even live-enabled environment variables cannot enable the default command.
    try{const receipt=await adapter.start(previewPhoneRequest());write(JSON.stringify(receipt));return{mode:'dry-run',receipt};}
    finally{await adapter.dispose();}
  }
  const listenOnly=args.length===1&&args[0]==='--listen';
  const live=args.length===3&&args[0]==='--live'&&args[1]==='--request'&&typeof args[2]==='string'&&args[2].length>0;
  if(!listenOnly&&!live)throw phoneError('INVALID_REQUEST');
  let input;
  if(live) {
    // A trusted operator provides this file; it is never accepted from a browser form or model tool.
    let raw;try{raw=await load(resolve(args[2]));if(Buffer.byteLength(raw)>16384)throw new Error();input=JSON.parse(raw);}catch{throw phoneError('INVALID_REQUEST');}
    validatePhoneRequest(input,{env,live:true});
  }
  const config=validateTwilioConfiguration(env);
  const port=Number(env.PHONE_PORT||4190);
  if(!Number.isInteger(port)||port<1024||port>65535)throw phoneError('CONFIGURATION');
  let resolveTerminal;
  const terminal=new Promise(resolve=>{resolveTerminal=resolve;});
  const adapter=makeAdapter({env,onReceipt:receipt=>{
    // Status only. Do not log provider payloads, phone numbers, booking references or conversation content.
    write(JSON.stringify({status:receipt.status,actualCallPlaced:receipt.actualCallPlaced,terminationConfirmed:receipt.terminationConfirmed,
      outcome:receipt.result?.outcome??null,requiresOperatorVerification:receipt.result?.requiresOperatorVerification??false}));
    if(receipt.terminationConfirmed)resolveTerminal();
  }});
  let listener;
  try {
    listener=await makeServer({adapter,publicOrigin:config.origin});
    await new Promise((resolve,reject)=>{listener.server.once('error',reject);listener.server.listen(port,'127.0.0.1',()=>{listener.server.removeListener('error',reject);resolve();});});
    write(listenOnly?'전화 콜백 수신 서버만 시작했습니다. 발신하지 않습니다.':'운영자 승인 요청을 1회 처리합니다.');
    let closing;
    const close=()=>closing??=listener.dispose();
    const stop=()=>{void close();};
    process.once('SIGINT',stop);process.once('SIGTERM',stop);
    const cleanup=()=>{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);};
    listener.server.once('close',cleanup);
    if(live) {
      try{await adapter.start(input,{mode:'live'});await terminal;}finally{await close();cleanup();}
    }
    return{mode:listenOnly?'listen':'live',receipt:live?adapter.getReceipt(input.requestId):null,close};
  }catch(error){if(listener)await listener.dispose();else await adapter.dispose();throw error;}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  runPhoneOperator({args:process.argv.slice(2)}).catch(error=>{
    const safe=error?.name==='PhoneAdapterError'?error:phoneError('CONFIGURATION');
    console.error(`${safe.code}: ${safe.message}`);process.exitCode=1;
  });
}

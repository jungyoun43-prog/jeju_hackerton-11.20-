import {createHmac,timingSafeEqual} from 'node:crypto';
import {phoneError} from './phone-policy.mjs';

export const isCallSid = value => typeof value==='string' && /^CA[0-9a-fA-F]{32}$/.test(value);
export const isStreamSid = value => typeof value==='string' && /^MZ[0-9a-fA-F]{32}$/.test(value);
const escapeXml = value => String(value).replace(/[<>&'\"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;'}[c]));
export function validateTwilioConfiguration(env) {
  if(!/^AC[0-9a-fA-F]{32}$/.test(env.TWILIO_ACCOUNT_SID || '') || typeof env.TWILIO_AUTH_TOKEN!=='string'
    || env.TWILIO_AUTH_TOKEN.length<16 || typeof env.OPENAI_API_KEY!=='string' || !env.OPENAI_API_KEY.trim()) throw phoneError('CONFIGURATION');
  let origin;try{origin=new URL(env.PHONE_PUBLIC_ORIGIN);}catch{throw phoneError('CONFIGURATION');}
  if(origin.protocol!=='https:' || origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash
    || /^(localhost|127\.|\[::1\])/.test(origin.hostname)) throw phoneError('CONFIGURATION');
  return {accountSid:env.TWILIO_ACCOUNT_SID,authToken:env.TWILIO_AUTH_TOKEN,origin:origin.origin,
    mediaUrl:`${origin.origin.replace(/^https:/,'wss:')}/phone/media`};
}

/** Exact externally configured URL; never derive trust from Host/X-Forwarded-* headers. */
export function verifyTwilioSignature({authToken,url,params={},signature}) {
  if(typeof authToken!=='string' || !authToken || typeof signature!=='string' || !/^[A-Za-z0-9+/]{27}=$/.test(signature))return false;
  const entries=params instanceof URLSearchParams?[...params.entries()]:Object.entries(params);
  const names=[...new Set(entries.map(([key])=>key))].sort();
  let data=url;
  for(const name of names) {
    const values=[...new Set(entries.filter(([key])=>key===name).flatMap(([,value])=>Array.isArray(value)?value:[value]).map(String))].sort();
    for(const value of values)data+=name+value;
  }
  const expected=createHmac('sha1',authToken).update(data,'utf8').digest();
  const received=Buffer.from(signature,'base64');
  return received.length===expected.length && timingSafeEqual(received,expected);
}

export function buildPhoneTwiml({mediaUrl,token}) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXml(mediaUrl)}"><Parameter name="token" value="${escapeXml(token)}" /></Stream></Connect><Hangup /></Response>`;
}

export function createTwilioTransport({config,fetchImpl=globalThis.fetch}) {
  const root=`https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls`;
  const headers={Authorization:`Basic ${Buffer.from(`${config.accountSid}:${config.authToken}`).toString('base64')}`,'Content-Type':'application/x-www-form-urlencoded'};
  async function post(url,body,signal) {
    try {
      const response=await fetchImpl(url,{method:'POST',headers,body:body.toString(),signal,redirect:'error'});
      if(!response.ok)throw phoneError('PROVIDER');
      return response;
    }catch{throw phoneError('PROVIDER');}
  }
  return {
    async create(request,{token,signal}) {
      const body=new URLSearchParams({To:request.recipient.phone,From:request.caller.phone,
        Twiml:buildPhoneTwiml({mediaUrl:config.mediaUrl,token}),StatusCallback:`${config.origin}/phone/status/${token}`,
        StatusCallbackMethod:'POST',Timeout:String(request.limits.ringSeconds),TimeLimit:String(request.limits.maxDurationSeconds),Record:'false'});
      for(const event of ['initiated','ringing','answered','completed'])body.append('StatusCallbackEvent',event);
      const response=await post(`${root}.json`,body,signal);
      let data;try{data=await response.json();}catch{throw phoneError('PROVIDER');}
      if(!isCallSid(data?.sid) || data.account_sid!==config.accountSid || data.to!==request.recipient.phone || data.from!==request.caller.phone)throw phoneError('PROVIDER');
      return {callSid:data.sid};
    },
    async hangup(callSid,{signal}={}) {
      if(!isCallSid(callSid))throw phoneError('PROVIDER');
      const response=await post(`${root}/${callSid}.json`,new URLSearchParams({Status:'completed'}),signal);
      let data;try{data=await response.json();}catch{throw phoneError('PROVIDER');}
      if(data?.sid!==callSid || data.account_sid!==config.accountSid
        || !['completed','canceled','busy','no-answer','failed'].includes(data.status))throw phoneError('PROVIDER');
      return true;
    },
  };
}

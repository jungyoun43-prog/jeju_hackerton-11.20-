import {mkdir,open,readFile,writeFile,unlink,rmdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {phoneError} from './phone-policy.mjs';

/** Local operator deployment only. Persist hashes/counts, never numbers, speech, request text or credentials. */
export function createFilePhoneLedger({directory=resolve('.runtime/outbound-phone'),now=Date.now,dailyLimit=3}={}) {
  if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>3)throw phoneError('CONFIGURATION');
  const root=resolve(directory),lock=resolve(root,'lock'),active=resolve(root,'active.json');
  async function locked(fn) {
    await mkdir(root,{recursive:true,mode:0o700});
    try{await mkdir(lock);}catch{throw phoneError('BUSY');}
    try{return await fn();}finally{await rmdir(lock).catch(()=>{});}
  }
  return {
    persistent:true,
    async reserve({grantKey}) {
      if(!/^[a-f0-9]{64}$/.test(grantKey))throw phoneError('INVALID_REQUEST');
      return locked(async()=>{
        try{await readFile(active);throw phoneError('BUSY');}catch(error){if(error.code!=='ENOENT')throw error;}
        const day=new Date(now()).toISOString().slice(0,10),dayPath=resolve(root,`day-${day}.json`);
        let count=0;try{const data=JSON.parse(await readFile(dayPath,'utf8'));count=data.count;if(!Number.isInteger(count)||count<0)throw phoneError('LIMIT');}catch(error){if(error.code!=='ENOENT')throw error;}
        if(count>=dailyLimit)throw phoneError('LIMIT');
        let file;try{file=await open(resolve(root,`grant-${grantKey}.json`),'wx',0o600);}catch(error){throw phoneError(error.code==='EEXIST'?'DUPLICATE':'LIMIT');}
        try{await file.writeFile(JSON.stringify({version:1,day,status:'attempted'}));}finally{await file.close();}
        await writeFile(dayPath,JSON.stringify({count:count+1}),{mode:0o600});
        await writeFile(active,JSON.stringify({grantKey}),{flag:'wx',mode:0o600});
        return true;
      });
    },
    async release({grantKey,terminalConfirmed}) {
      if(terminalConfirmed!==true)return false; // Unknown outcomes keep the operator lock after restart.
      return locked(async()=>{
        let data;try{data=JSON.parse(await readFile(active,'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw error;}
        if(data.grantKey!==grantKey)return false;
        await unlink(active);return true;
      });
    },
  };
}

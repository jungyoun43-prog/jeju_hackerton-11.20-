import { cp, mkdir, lstat, rm } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
export async function prepareWeb() {
  const root=fileURLToPath(new URL('../',import.meta.url));
  const target=resolve(root,'web/public');
  const previous=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(previous?.isSymbolicLink() || target!==resolve(root,'web','public'))throw new Error('생성 자산 경로가 올바르지 않습니다.');
  if(previous)await rm(target,{recursive:true,force:true});
  await mkdir(target,{recursive:true});
  await cp(resolve(root,'app'),target,{recursive:true,filter:async path=>{
    if((await lstat(path)).isSymbolicLink())throw new Error('공개 자산의 링크는 허용하지 않습니다.');
    return !basename(path).startsWith('.env') && basename(path)!=='index.html';
  }});
  await cp(resolve(root,'node_modules/leaflet/dist'),resolve(target,'vendor/leaflet'),{recursive:true});
}

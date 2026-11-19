import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSite } from './build.mjs';
import { prepareWeb } from './prepare-web.mjs';
import { runtimeFingerprint } from '../orchestration/checks.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function buildWeb() {
  const sourceHash=await runtimeFingerprint(root);
  await prepareWeb();
  const {stdout}=await promisify(execFile)(process.execPath,[resolve(root,'node_modules/next/dist/bin/next'),'build','web','--webpack'],{cwd:root,windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,NEXT_TELEMETRY_DISABLED:'1'}});
  console.log(stdout);
  const result=await buildSite();
  await cp(resolve(root,'web/out'),result.directory,{recursive:true,filter:source=>!source.includes('/api/') && !source.includes('\\api\\')});
  if(await runtimeFingerprint(root)!==sourceHash)throw new Error('빌드 중 실행 소스가 변경되었습니다. 다시 빌드해 주세요.');
  await writeFile(resolve(result.directory,'deployment.json'),JSON.stringify({...result.deployment,sourceHash,frontend:'next-react'},null,2)+'\n');
  console.log('Next.js 정적 UI 빌드 완료: dist/ · 기존 Node/Lambda API 별도 유지');
  return result;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await buildWeb();

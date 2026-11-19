import { mkdir,writeFile,rm } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { pythonCli } from './python-cli.mjs';

const exec = promisify(execFile);
const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)),'..');
/** 정적 dist와 분리된 Lambda ZIP. 외부 배포/계정 변경을 수행하지 않는다. */
export async function buildAgent({root = defaultRoot,revision = process.env.APP_REVISION ?? 'development'} = {}) {
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(revision)) throw new Error('APP_REVISION 형식을 확인해 주세요.');
  const directory = resolve(root,'output/agent-lambda'),zipPath = resolve(root,'output/agent-lambda.zip');
  await rm(directory,{recursive:true,force:true});
  await mkdir(directory,{recursive:true});
  await build({
    entryPoints:[resolve(root,'agent/handler.mjs')],outfile:resolve(directory,'index.mjs'),bundle:true,platform:'node',target:'node22',format:'esm',
    sourcemap:false,minify:false,define:{__APP_REVISION__:JSON.stringify(revision)},
    banner:{js:"import { createRequire as __agentCreateRequire } from 'node:module'; const require = __agentCreateRequire(import.meta.url);"},
  });
  await writeFile(resolve(directory,'deployment.json'),JSON.stringify({revision,runtime:'lambda',mode:'synthetic'},null,2)+'\n');
  // Python 표준 라이브러리로 생성하여 추가 zip 의존성을 요구하지 않는다.
  await exec(pythonCli(),['-c',"import pathlib,sys,zipfile; root=pathlib.Path(sys.argv[1]); output=pathlib.Path(sys.argv[2]); z=zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED); [z.write(p,p.relative_to(root).as_posix()) for p in sorted(root.rglob('*')) if p.is_file()]; z.close()",directory,zipPath],{windowsHide:true});
  return {directory,zipPath,revision,handler:'index.handler'};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await buildAgent();
  process.stdout.write(JSON.stringify(result)+'\n');
}

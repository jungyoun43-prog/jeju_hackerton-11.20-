import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
export const excluded = new Set(['.git','node_modules','dist','output','.worktrees','.impeccable','runs']);
export async function sourceFiles(root, prefix='') {
  const files=[];
  for(const item of await readdir(resolve(root,prefix),{withFileTypes:true})) {
    if(excluded.has(item.name) || (item.name.startsWith('.env') && item.name !== '.env.example')) continue;
    if(prefix==='web' && ['.next','out','public'].includes(item.name))continue;
    const path=prefix ? `${prefix}/${item.name}` : item.name;
    if(item.isDirectory()) files.push(...await sourceFiles(root,path));
    else if(item.isFile()) files.push(path);
  }
  return files;
}
export async function scanProject(root) {
  const findings=[];
  const patterns=[/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,/sk-proj-[A-Za-z0-9_-]{20,}/,/sk-[A-Za-z0-9]{32,}/,/AIza[0-9A-Za-z_-]{30,}/,/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/];
  for(const path of await sourceFiles(root)) {
    const bytes=await readFile(resolve(root,path));
    if(bytes.subarray(0,8192).includes(0)) continue;
    const content=bytes.toString('utf8');
    if(patterns.some(pattern=>pattern.test(content))) findings.push(path);
  }
  return findings;
}
export async function runtimeFingerprint(root) {
  const hash=createHash('sha256');
  const files=(await sourceFiles(root)).filter(p=>p.startsWith('app/') || p.startsWith('web/') || p.startsWith('agent/') || p.startsWith('prompts/') || ['scripts/server.mjs','scripts/dev.mjs','scripts/build-web.mjs','scripts/prepare-web.mjs','package.json','package-lock.json'].includes(p)).sort();
  for(const path of files) {hash.update(path+'\0');hash.update(await readFile(resolve(root,path)));}
  return hash.digest('hex');
}

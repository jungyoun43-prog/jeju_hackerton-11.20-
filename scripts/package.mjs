import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { scanProject } from '../orchestration/checks.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sensitive = await scanProject(root);
if (sensitive.length) throw new Error(`민감정보 패턴을 발견해 패키징을 중단했습니다. 파일: ${sensitive.join(', ')}`);
const { buildSite } = await import('./build.mjs');
await buildSite();
await mkdir(resolve(root,'output'),{recursive:true});
const zipPath = resolve(root,'output/jeju-care-compass-mvp.zip');
const selected = ['README.md','AGENTS.md','PRODUCT.md','DESIGN.md','THIRD_PARTY.md','.env.example','package.json','package-lock.json','app','agent','prompts','scripts','tests','docs','research','orchestration','infra','.github','dist','.impeccable/design.json','.impeccable/review/desktop.png','.impeccable/review/mobile.png','.impeccable/review/data-desktop.png','.impeccable/review/data-mobile.png','.impeccable/review/conversation-initial-desktop.png','.impeccable/review/conversation-initial-mobile.png','.impeccable/review/conversation-preview-desktop.png','.impeccable/review/conversation-preview-mobile.png'];
const code = `import json,sys,zipfile,pathlib
root=pathlib.Path(sys.argv[1]); dest=pathlib.Path(sys.argv[2]); selected=json.loads(sys.argv[3])
safe_evidence={'orchestration/runs/browser.json','orchestration/runs/conversation-browser.json','orchestration/runs/latest-eval.json','orchestration/runs/release.json','orchestration/runs/rollback.json'}
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
 for name in selected:
  p=root/name
  if not p.exists(): continue
  files=[p] if p.is_file() else sorted(p.rglob('*'))
  for f in files:
   if not f.is_file(): continue
   rel=f.relative_to(root)
   if any(s in ['node_modules','.git','__pycache__'] for s in rel.parts): continue
   if 'runs' in rel.parts and rel.as_posix() not in safe_evidence: continue
   if f.name.startswith('.env') and f.name!='.env.example': continue
   z.write(f,str(pathlib.Path('jeju-care-compass-mvp')/rel))
print(dest)
`;
execFileSync('python3',['-c',code,root,zipPath,JSON.stringify(selected)],{stdio:'inherit'});
await writeFile(resolve(root,'output/README.txt'),'개발 중인 UI·워크플로 MVP 스냅샷입니다. 최종 대회 제출 준비 완료를 뜻하지 않습니다. docs/submission-checklist.md의 미완료 요건을 확인하세요.\n');
console.log('MVP 스냅샷 ZIP 생성 완료. 최종 제출 전 미완료 요건 확인 필요.');

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { scanProject } from '../orchestration/checks.mjs';
import { pythonCli } from './python-cli.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sensitive = await scanProject(root);
if (sensitive.length) throw new Error(`민감정보 패턴을 발견해 패키징을 중단했습니다. 파일: ${sensitive.join(', ')}`);
const hasReactApp=await access(resolve(root,'web/package.json')).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
if(hasReactApp)await (await import('./build-web.mjs')).buildWeb();
else await (await import('./build.mjs')).buildSite();
await mkdir(resolve(root,'output'),{recursive:true});
const zipPath = resolve(root,'output/jeju-care-compass-mvp.zip');
const selected = [
  'README.md','AGENTS.md','PRODUCT.md','DESIGN.md','THIRD_PARTY.md','.env.example','package.json','package-lock.json',
  'app','web','agent','prompts','scripts','tests','docs','research','orchestration','infra','.github','dist',
  '.impeccable/design.json',
];
const code = `import json,os,stat,sys,zipfile,pathlib
root=pathlib.Path(sys.argv[1]); dest=pathlib.Path(sys.argv[2]); selected=json.loads(sys.argv[3])
safe_evidence={
 'orchestration/runs/browser.json','orchestration/runs/conversation-browser.json',
 'orchestration/runs/visit-recovery-browser.json','orchestration/runs/journey-browser.json',
 'orchestration/runs/visit-recovery-integration.json','orchestration/runs/preparation-board-browser.json',
 'orchestration/runs/native-zoom-browser.json','orchestration/runs/latest-eval.json',
 'orchestration/runs/proposal-pdf.json','orchestration/runs/aws-deployment.json',
 'orchestration/runs/preparation-board-deployed.json','orchestration/runs/release.json',
 'orchestration/runs/agent-evaluation-scope.json','orchestration/runs/agent-evaluation.json',
 'orchestration/runs/agent-evaluation-deployed.json','orchestration/runs/agent-semantic-review.json',
}
def checked_stat(path):
 try:
  info=path.lstat()
 except FileNotFoundError:
  return None
 # A Windows directory junction is a mount-point reparse entry, not a POSIX symlink.
 junction=os.name=='nt' and info.st_reparse_tag==stat.IO_REPARSE_TAG_MOUNT_POINT
 if stat.S_ISLNK(info.st_mode) or junction:
  raise ValueError('심볼릭 링크는 패키징할 수 없습니다: '+str(path.relative_to(root)))
 return info

def regular_files(path):
 info=checked_stat(path)
 if info is None: return
 if stat.S_ISREG(info.st_mode):
  yield path
 elif stat.S_ISDIR(info.st_mode):
  for child in sorted(path.iterdir()):
   yield from regular_files(child)

entries=[]
for name in selected:
 parent=root
 for part in pathlib.Path(name).parts[:-1]:
  parent=parent/part
  checked_stat(parent)
 for f in regular_files(root/name):
  rel=f.relative_to(root)
  if any(s in ['node_modules','.git','__pycache__','.next'] for s in rel.parts): continue
  if len(rel.parts)>1 and rel.parts[0]=='web' and rel.parts[1] in ['public','out']: continue
  if 'runs' in rel.parts and rel.as_posix() not in safe_evidence: continue
  if f.name.startswith('.env') and f.name!='.env.example': continue
  entries.append((f,rel))
# 링크 검사에 실패하면 기존 ZIP을 보존한다.
with zipfile.ZipFile(dest,'w',zipfile.ZIP_DEFLATED) as z:
 for f,rel in entries:
  z.write(f,str(pathlib.Path('jeju-care-compass-mvp')/rel))
print(dest)
`;
execFileSync(pythonCli(),['-c',code,root,zipPath,JSON.stringify(selected)],{stdio:'inherit',windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
await writeFile(resolve(root,'output/README.txt'),'개발 중인 UI·워크플로 MVP 스냅샷입니다. 최종 대회 제출 준비 완료를 뜻하지 않습니다. docs/submission-checklist.md의 미완료 요건을 확인하세요.\n');
console.log('MVP 스냅샷 ZIP 생성 완료. 최종 제출 전 미완료 요건 확인 필요.');

if (process.argv.includes('--submission')) {
  execFileSync(pythonCli(), [resolve(root, 'scripts/prepare-submission.py')], {
    stdio: 'inherit',
    windowsHide: true,
    env: {...process.env, PYTHONIOENCODING: 'utf-8'},
  });
}

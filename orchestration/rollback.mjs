import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const state=JSON.parse(await readFile(resolve(root,'orchestration/state.json'),'utf8'));
const args=process.argv.slice(2), commit=args.find(x=>/^[a-f0-9]{7,40}$/.test(x));
if(!commit) throw new Error('npm run rollback -- <통합 커밋> [--apply] 로 사용하세요. --apply 없이는 미리보기만 합니다.');
const allowed=Object.values(state.tasks).flatMap(t=>t.integrationCommits);
const full=execFileSync('git',['rev-parse','--verify',`${commit}^{commit}`],{cwd:root,encoding:'utf8'}).trim();
if(!allowed.some(c=>full.startsWith(c)||c.startsWith(full))) throw new Error('기록된 작업 통합 커밋만 되돌릴 수 있습니다.');
console.log(`대상: ${full}\n명령: git revert --no-edit ${full}`);
if(!args.includes('--apply')) console.log('미리보기 완료. 변경은 없습니다.');
else {
 const dirty=execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim();
 if(dirty) throw new Error('미커밋 변경이 있어 중단했습니다. 현재 변경을 먼저 보존하세요.');
 execFileSync('git',['-c','user.name=Codex','-c','user.email=codex@local','revert','--no-edit',full],{cwd:root,stdio:'inherit'});
 console.log('롤백 커밋 생성 완료. npm run eval로 영향을 재검증하세요.');
}

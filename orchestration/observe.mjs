import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const rules=JSON.parse(await readFile(resolve(root,'orchestration/rules.json'),'utf8'));
const state=JSON.parse(await readFile(resolve(root,'orchestration/state.json'),'utf8'));
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
const rows=rules.tasks.map(task=>{
 const saved=state.tasks[task.id];
 let status='';try{status=execFileSync('git',['status','--short'],{cwd:saved.worktree,encoding:'utf8'}).trim();}catch{status='워크트리 경로 확인 필요';}
 let files=[];try{files=git('diff','--name-only',task.baseCommit || state.baseCommit,task.branch).split('\n').filter(Boolean);}catch{}
 return {id:task.id,branch:task.branch,phase:saved.phase,worktree:saved.worktree,note:saved.note,committedFiles:files,uncommitted:status,integrationCommits:saved.integrationCommits};
});
let awsDeployment=state.awsDeployment;
try {awsDeployment=JSON.parse(await readFile(resolve(root,'orchestration/runs/aws-deployment.json'),'utf8'));}catch{}
const result={observedAt:new Date().toISOString(),baseCommit:state.baseCommit,tasks:rows,awsDeployment};
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
await writeFile(resolve(root,'orchestration/runs/observation.json'),JSON.stringify(result,null,2)+'\n');
for(const row of rows) console.log(`${row.id} · ${row.phase}\n  ${row.branch} · ${row.worktree}\n  ${row.note}\n  커밋 파일 ${row.committedFiles.length}개 · 미커밋 변경 ${row.uncommitted ? '있음' : '없음'}\n  통합: ${row.integrationCommits.join(', ') || '아직 없음'}`);
console.log('기록: orchestration/runs/observation.json (상태는 담당자 보고와 Git 관측 기준)');
if(awsDeployment) console.log(`AWS · ${awsDeployment.phase} · ${awsDeployment.siteUrl || awsDeployment.liveUrl || 'URL 대기'}${awsDeployment.ciRun ? '\nActions: '+awsDeployment.ciRun : ''}`);

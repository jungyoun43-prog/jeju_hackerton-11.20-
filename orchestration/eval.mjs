import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanProject, sourceFiles, runtimeFingerprint } from './checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
let repositoryRoot;
try { repositoryRoot=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim(); } catch {}
if(repositoryRoot!==root) throw new Error('이 eval은 Git 브랜치·worktree가 유지된 개발 저장소용입니다. 압축 해제 소스는 npm test, npm run build와 앱 실행으로 검증하세요.');
const rules=JSON.parse(await readFile(resolve(root,'orchestration/rules.json'),'utf8'));
const state=JSON.parse(await readFile(resolve(root,'orchestration/state.json'),'utf8'));
const checks=[];
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function check(id, rule, run) {
 try { const evidence=await run(); checks.push({id,rule,status:'pass',evidence}); }
 catch(error) { checks.push({id,rule,status:'fail',evidence:error.message.slice(0,2200)}); }
}
const requireThat=(value,message)=>{if(!value) throw new Error(message);};
await check('worktree-isolation','isolation',()=>{
 const output=git('worktree','list','--porcelain');
 const paths=rules.tasks.map(t=>state.tasks[t.id].worktree);
 requireThat(new Set(paths).size===rules.tasks.length,'워크트리 경로가 중복됩니다.');
 for(const task of rules.tasks) {
  const entry=output.split('\n\n').find(e=>e.includes(`worktree ${state.tasks[task.id].worktree}\n`));
  requireThat(entry?.includes(`branch refs/heads/${task.branch}`),`${task.id}: 등록된 브랜치/워크트리가 다릅니다.`);
 }
 return '서로 다른 3개 worktree와 전용 브랜치 등록 확인';
});
for(const task of rules.tasks) await check(`file-ownership-${task.id}`,'ownership',()=>{
 const files=git('diff','--name-only',state.baseCommit,task.branch).split('\n').filter(Boolean);
 requireThat(files.length>0,`${task.id}: 완료 커밋이 아직 없습니다.`);
 const violations=files.filter(file=>!task.allow.includes(file));
 requireThat(violations.length===0,`파일 소유권 위반: ${violations.join(', ')}`);
 const dirty=execFileSync('git',['status','--porcelain'],{cwd:state.tasks[task.id].worktree,encoding:'utf8'}).trim();
 requireThat(!dirty,`${task.id}: 미커밋 변경이 있어 완료 평가를 보류합니다.`);
 return `${files.length}개 변경 파일이 허용 목록에 포함, 워크트리 clean`;
});
await check('domain-and-server-tests','contract',async()=>{
 const testFiles=(await sourceFiles(root)).filter(p=>p.startsWith('tests/') && p.endsWith('.test.mjs')).sort();
 requireThat(testFiles.length>0,'실행할 테스트 파일이 없습니다.');
 const output=execFileSync(process.execPath,['--test',...testFiles],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
 requireThat(/# pass [1-9]/.test(output),'실행된 테스트 결과가 없습니다.');
 return output.split('\n').filter(line=>/^# (tests|pass|fail|duration_ms)/.test(line)).join('; ');
});
await check('simulation-report-provenance','provenance',async()=>{
 const domain=await import('../app/domain.js');
 const report=domain.buildReport(domain.createDemoCase());
 requireThat(/시연|합성/.test(report),'출력 보고서에 시연·합성 표시가 없습니다.');
 requireThat(/출처/.test(report),'보고서의 출처 표시를 확인할 수 없습니다.');
 requireThat(/미확인/.test(report),'미확인 비용이 구분되지 않습니다.');
 const html=await readFile(resolve(root,'app/index.html'),'utf8');
 const app=await readFile(resolve(root,'app/app.js'),'utf8');
 requireThat(/시연|simulation/.test(html+app),'화면의 시연 표시를 확인할 수 없습니다.');
 return '시연 보고서·출처·미확인 항목, 화면 시연 라벨 존재 확인 (모든 문구의 진실성 자동 증명 아님)';
});
await check('asset-provenance','provenance',async()=>{
 const manifest=JSON.parse(await readFile(resolve(root,'app/assets/manifest.json'),'utf8'));
 requireThat(manifest.assets.length>0,'자산 명세가 비어 있습니다.');
 for(const asset of manifest.assets) {await access(resolve(root,'app/assets',asset.file));requireThat(asset.prompt && asset.tool && asset.createdAt,'생성 자산의 프롬프트/도구/날짜가 없습니다.');}
 return '배너 파일 및 정확한 생성 프롬프트·도구·날짜 기록';
});
await check('secret-pattern-scan','privacy',async()=>{
 const findings=await scanProject(root);
 requireThat(findings.length===0,`민감정보 패턴 감지 파일: ${findings.join(', ')}`);
 return '제출 소스·문서의 UTF-8 텍스트에서 대표 키/개인키 패턴 미발견. 바이너리·개인정보 전수 판정이나 적법성 검토를 대체하지 않음';
});
await check('javascript-syntax','verification',async()=>{
 const paths=(await sourceFiles(root)).filter(p=>/\.(m?js)$/.test(p));
 for(const path of paths) execFileSync(process.execPath,['--check',resolve(root,path)],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 return `${paths.length}개 JS 모듈 문법 검사 통과`;
});
await check('static-build','verification',()=>{
 const output=execFileSync(process.execPath,['scripts/build.mjs'],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000});
 return output.trim();
});
await check('browser-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/browser.json'),'utf8'));
 requireThat(proof.result==='pass' && proof.errors.length===0,'브라우저 실행에서 오류가 발견됐습니다.');
 requireThat(proof.desktop.width>=1200 && proof.mobile.width<=430,'PC·모바일 크기 검증이 필요합니다.');
 requireThat(proof.desktop.noOverflow && proof.mobile.noOverflow,'화면 가로 넘침이 있습니다.');
 requireThat(proof.flowCompleted && proof.supplementLoop,'협진 준비와 자료 보완 루프 검증이 필요합니다.');
 requireThat(proof.sourceHash===await runtimeFingerprint(root),'브라우저 증거 이후 실행 소스가 변경됐습니다. 다시 캡처하세요.');
 for(const p of [proof.desktop.screenshot,proof.mobile.screenshot]) {const bytes=await readFile(resolve(root,p));requireThat(bytes.readUInt32BE(0)===0x89504e47,'유효한 PNG 화면 증거가 아닙니다.');}
 return 'PC·모바일 넘침/기능 흐름/보완 루프 검사와 화면 캡처 존재. 타일 네트워크·임상 검증은 별도';
});
await check('rollback-boundary','rollback',()=>{
 for(const task of rules.tasks) {
  const integrated=state.tasks[task.id].integrationCommits;
  requireThat(integrated.length>0,`${task.id}: 통합 커밋이 아직 기록되지 않았습니다.`);
  for(const commit of integrated) git('merge-base','--is-ancestor',commit,'HEAD');
 }
 return '작업별 통합 커밋을 HEAD의 조상으로 확인; 허용된 커밋만 revert 가능';
});
const passed=checks.filter(c=>c.status==='pass').length;
const result={evaluatedAt:new Date().toISOString(),commit:git('rev-parse','HEAD'),automated:{passed,total:checks.length,rate:Math.round(passed/checks.length*1000)/10},checks,
 manualUnverified:['필수 공공데이터의 실제 사용·접근·재배포 권한','실제 전화·기관 접수·의료진 참여','런타임 AI 모델·Prompt/Tool 연동의 실작동','임상 유효성·실서비스 개인정보 처리·정책 검토','기획서 최종 PDF 15페이지 이내 및 센터 실기기 실행'],submissionReady:false};
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
await writeFile(resolve(root,'orchestration/runs/latest-eval.json'),JSON.stringify(result,null,2)+'\n');
for(const item of checks) console.log(`${item.status==='pass'?'PASS':'FAIL'} ${item.id} · ${item.evidence}`);
console.log(`\n자동 검증 규칙 준수율: ${passed}/${checks.length} (${result.automated.rate}%)\n별도 미검증 요건: ${result.manualUnverified.length}개 · 최종 제출 준비 완료: 아니오\n기록: orchestration/runs/latest-eval.json`);
if(passed!==checks.length) process.exitCode=1;

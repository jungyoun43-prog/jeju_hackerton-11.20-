import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createFixtureLink } from './helpers/fixture-link.mjs';
import { pythonCli } from '../scripts/python-cli.mjs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { scanProject } from '../orchestration/checks.mjs';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'hondi-package-')),project=join(directory,'project');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const folder of ['scripts','orchestration','app','docs','output','node_modules/leaflet/dist'])await mkdir(join(project,folder),{recursive:true});
  for(const path of ['scripts/package.mjs','scripts/build.mjs','scripts/python-cli.mjs','orchestration/checks.mjs'])await writeFile(join(project,path),await readFile(new URL('../'+path,import.meta.url)));
  for(const [path,content] of Object.entries({
    'package.json':'{"type":"module"}',
    'app/index.html':'<!doctype html><title>합성 시연</title>',
    'docs/reference.txt':'공개 자료',
    '.env':'fixture-private-value',
    '.env.example':'OPENAI_API_KEY=',
    'node_modules/leaflet/dist/leaflet.js':'/* fixture */',
    'node_modules/leaflet/LICENSE':'fixture license',
  }))await writeFile(join(project,path),content);
  return {directory,project,archive:join(project,'output/jeju-care-compass-mvp.zip')};
}
const pack=project=>spawnSync(process.execPath,['scripts/package.mjs'],{cwd:project,encoding:'utf8',env:{...process.env,OPENAI_API_KEY:''}});

test('심사용 ZIP에는 현재 소스로 통과한 브라우저 검사만 넣는다',()=>{
  const receipt={sourceHash:'current',checks:[{pass:true}],passed:1,failed:[],errors:[]};
  const calendar={sourceHash:'current',measurements:[{width:1024}],errors:[],posts:[]};
  const scenarios=[
    ['calendar.json',calendar,true],
    ['calendar.json',{...calendar,errors:['footer not visible']},false],
    ['calendar.json',{...calendar,measurements:[]},false],
    ['coordination.json',{...receipt,apiPosts:0},true],
    ['coordination.json',{...receipt,apiPosts:0,checks:[{pass:false}]},false],
    ['reservation-edit.json',{...receipt,posts:0},true],
    ['reservation-edit.json',{...receipt,posts:1},false],
    ['reservation-edit.json',{...receipt,posts:0,sourceHash:'older'},false],
  ];
  const verify=`import json, runpy, sys
check = runpy.run_path("scripts/prepare-submission.py")["verify_browser_report"]
for name, report, expected in json.load(sys.stdin):
    try:
        check(name, json.dumps(report), "current")
        accepted = True
    except ValueError:
        accepted = False
    assert accepted == expected, (name, report)
`;
  const result=spawnSync(pythonCli(),['-c',verify],{cwd:new URL('../',import.meta.url),input:JSON.stringify(scenarios),encoding:'utf8',windowsHide:true});
  assert.equal(result.status,0,result.stderr);
});

test('실제 ZIP은 소스·빌드·대표 화면·최종 요약을 보존하고 반복 캡처·비공개 파일을 제외한다',async t=>{
  const {project,archive}=await fixture(t);
  const currentFiles={
    '.impeccable/design.json':'{"fixture":"design"}',
    'docs/reviews/2026-11-15-evidence/initial-1440.png':'fixture initial desktop',
    'docs/reviews/2026-11-15-evidence/final-1440.png':'fixture preview desktop',
    'docs/reviews/2026-11-15-evidence/final-390.png':'fixture preview mobile',
    'docs/reviews/2026-11-15-evidence/guided-demo.json':'{"fixture":"final summary"}',
    'orchestration/runs/browser.json':'{"fixture":"browser"}',
    'orchestration/runs/latest-eval.json':'{"fixture":"latest evaluation"}',
  };
  const excludedFiles={
    '.impeccable/review/chat-rail/product-redesign/release-capture/preview-1440.png':'fixture old preview',
    'output/guided-demo-qa/error-390.png':'fixture intermediate',
    '.impeccable/review/chat-rail/product-redesign/final-before/old-capture.png':'fixture old capture',
    '.impeccable/review/board/old-capture.png':'fixture old board',
    'orchestration/runs/caregiver-local-live-check.json':'{"fixture":"historical run"}',
    'docs/.env.local':'fixture-private-value',
    'docs/.git/config':'fixture-private-value',
    'docs/node_modules/private.txt':'fixture-private-value',
  };
  for(const [path,content] of Object.entries({...currentFiles,...excludedFiles})){
    await mkdir(dirname(join(project,path)),{recursive:true});
    await writeFile(join(project,path),content);
  }
  const result=pack(project);
  assert.equal(result.status,0,result.stderr);
  const entries=JSON.parse(execFileSync(pythonCli(),['-c','import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))',archive],{encoding:'utf8',windowsHide:true}));
  for(const path of ['app/index.html','scripts/package.mjs','docs/reference.txt','.env.example','dist/index.html','dist/vendor/leaflet/LICENSE.txt',...Object.keys(currentFiles)])assert.ok(entries.includes('jeju-care-compass-mvp/'+path));
  for(const path of Object.keys(excludedFiles))assert.ok(!entries.includes('jeju-care-compass-mvp/'+path),path);
  assert.ok(entries.every(path=>!path.endsWith('/.env')&&!path.includes('/node_modules/')));
});

test('선택 경로와 중첩 링크는 외부 파일을 읽기 전에 거절하고 기존 ZIP을 보존한다',async t=>{
  for(const kind of ['file','directory','selected-directory','selected-parent'])await t.test(kind,async child=>{
    const {directory,project,archive}=await fixture(child),external=join(directory,'private'),privateText='sk-'+'A'.repeat(40);
    await mkdir(external);await writeFile(join(external,'private.txt'),privateText);
    const link=kind==='selected-parent'?join(project,'.impeccable'):kind==='selected-directory'?join(project,'docs'):join(project,'docs',kind==='file'?'linked.txt':'linked-directory');
    if(kind==='selected-directory')await rm(link,{recursive:true});
    if(kind==='selected-parent'){
      await mkdir(join(external,'review/board'),{recursive:true});
      await writeFile(join(external,'review/board/private.txt'),privateText);
    }
    const target=kind==='file'?join(external,'private.txt'):external;
    if (!await createFixtureLink(child,target,link,kind==='file'?'file':'dir')) return;
    await writeFile(archive,'previous-archive');
    assert.deepEqual(await scanProject(project),[]);
    const result=pack(project);
    assert.notEqual(result.status,0);assert.match(result.stderr,/심볼릭 링크는 패키징할 수 없습니다/);
    assert.ok(!result.stdout.includes(privateText)&&!result.stderr.includes(privateText));
    assert.equal(await readFile(archive,'utf8'),'previous-archive');
  });
});

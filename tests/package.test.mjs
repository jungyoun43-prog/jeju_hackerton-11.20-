import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync, execFileSync } from 'node:child_process';
import { scanProject } from '../orchestration/checks.mjs';

async function fixture(t) {
  const directory=await mkdtemp(join(tmpdir(),'hondi-package-')),project=join(directory,'project');
  t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const folder of ['scripts','orchestration','app','docs','output','node_modules/leaflet/dist'])await mkdir(join(project,folder),{recursive:true});
  for(const path of ['scripts/package.mjs','scripts/build.mjs','orchestration/checks.mjs'])await writeFile(join(project,path),await readFile(new URL('../'+path,import.meta.url)));
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

test('실제 패키지 명령은 일반 파일·빌드·라이선스를 포함하고 .env를 제외한다',async t=>{
  const {project,archive}=await fixture(t),result=pack(project);
  assert.equal(result.status,0,result.stderr);
  const entries=JSON.parse(execFileSync('python3',['-c','import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))',archive],{encoding:'utf8'}));
  for(const path of ['docs/reference.txt','.env.example','dist/index.html','dist/vendor/leaflet/LICENSE.txt'])assert.ok(entries.includes('jeju-care-compass-mvp/'+path));
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
    await symlink(kind==='file'?join(external,'private.txt'):external,link);
    await writeFile(archive,'previous-archive');
    assert.deepEqual(await scanProject(project),[]);
    const result=pack(project);
    assert.notEqual(result.status,0);assert.match(result.stderr,/심볼릭 링크는 패키징할 수 없습니다/);
    assert.ok(!result.stdout.includes(privateText)&&!result.stderr.includes(privateText));
    assert.equal(await readFile(archive,'utf8'),'previous-archive');
  });
});

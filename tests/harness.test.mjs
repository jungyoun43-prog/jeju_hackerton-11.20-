import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanProject, runtimeFingerprint } from '../orchestration/checks.mjs';

test('확장자가 다른 제출 텍스트도 검사하고 실제 비밀 .env는 수집하지 않는다',async t=>{
 const root=await mkdtemp(join(tmpdir(),'jeju-harness-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const fake='sk-proj-'+'x'.repeat(40);
 await writeFile(join(root,'integration.yaml'),`test_only: ${fake}`);
 await writeFile(join(root,'tool.sh'),`TEST_ONLY=${fake}`);
 await writeFile(join(root,'deploy.ini'),'test_only='+'ASIA'+'A'.repeat(16));
 await writeFile(join(root,'.env'),`EXAMPLE=${fake}`);
 await writeFile(join(root,'record.png'),Buffer.from([137,80,78,71,0,1,2,3]));
 assert.deepEqual((await scanProject(root)).sort(),['deploy.ini','integration.yaml','tool.sh']);
});

test('미커밋 실행 소스 변경도 브라우저 증거의 지문을 바꾼다',async t=>{
 const root=await mkdtemp(join(tmpdir(),'jeju-fingerprint-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 await mkdir(join(root,'app'));
 await writeFile(join(root,'app/app.js'),'export const value=1;');
 const before=await runtimeFingerprint(root);
 await writeFile(join(root,'app/app.js'),'export const value=2;');
 assert.notEqual(await runtimeFingerprint(root),before);
 const after=await runtimeFingerprint(root);
 await writeFile(join(root,'README.md'),'검증 기록 수정');
 assert.equal(await runtimeFingerprint(root),after);
});

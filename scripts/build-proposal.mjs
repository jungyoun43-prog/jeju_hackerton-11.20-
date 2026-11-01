import { createRequire } from 'node:module';
import { readFile,writeFile,mkdir,rename } from 'node:fs/promises';
import { resolve,dirname } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runtimeFingerprint } from '../orchestration/checks.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const sourceHash=await runtimeFingerprint(root);
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
try {
  const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).protocol==='file:'?route.continue():route.abort());
  await page.goto(pathToFileURL(resolve(root,'docs/submission-proposal.html')).href,{waitUntil:'load'});
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('.revision').evaluateAll((nodes,label)=>nodes.forEach(node=>node.textContent=label),`구현 ${revision.slice(0,8)} · ${sourceHash.slice(0,10)}`);
  const proofPath=resolve(root,'orchestration/runs/preparation-board-browser.json');
  let screenshotIncluded=false;
  try {
    const proof=JSON.parse(await readFile(proofPath,'utf8'));
    if(proof.result==='pass' && proof.sourceHash===sourceHash) {
      const selected=proof.viewports.find(view=>view.width===1440 && view.height===900);
      if(selected?.screenshot) {
        const bytes=await readFile(resolve(root,selected.screenshot));
        if(bytes.readUInt32BE(0)!==0x89504e47)throw new Error('검증 캡처가 PNG가 아닙니다.');
        await page.locator('[data-screenshot]').evaluate((node,url)=>{const img=document.createElement('img');img.className='screen';img.alt='동일 소스의 실제 PC 브라우저 검증 화면';img.src=url;node.replaceWith(img);},'data:image/png;base64,'+bytes.toString('base64'));
        await page.locator('.screen').evaluate(node=>node.decode());screenshotIncluded=true;
      }
    }
  } catch(error) {if(error.code!=='ENOENT')throw error;}
  const directory=resolve(root,'output');await mkdir(directory,{recursive:true});
  const temporary=resolve(directory,'hondi-proposal-render.pdf');
  await page.pdf({path:temporary,format:'A4',printBackground:true,preferCSSPageSize:true});
  const info=execFileSync('pdfinfo',[temporary],{encoding:'utf8'}),pages=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  if(pages!==12)throw new Error(`기획서 페이지 수를 확인해 주세요: ${pages}; 목표12, 대회상한15`);
  if(await runtimeFingerprint(root)!==sourceHash)throw new Error('기획서 생성 중 구현 소스가 변경됐습니다.');
  if(!screenshotIncluded)throw new Error('같은 실행 지문의 최종 PC 캡처가 필요합니다. 기존 PDF는 보존했습니다.');
  await rename(temporary,resolve(root,'docs/submission-proposal.pdf'));
  const proof={checkedAt:new Date().toISOString(),result:'pass',revision,sourceHash,pages,screenshotIncluded,networkRequestsAllowed:false,source:'docs/submission-proposal.html',file:'docs/submission-proposal.pdf'};
  await writeFile(resolve(directory,'proposal-check.json'),JSON.stringify(proof,null,2)+'\n');
  console.log(JSON.stringify(proof));
} finally {await browser.close();}

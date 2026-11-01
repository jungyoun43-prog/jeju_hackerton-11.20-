import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
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
 catch(error) {
  const tests=String(error.stdout || '').split('\n').filter(line=>/^not ok |^# (tests|pass|fail) /.test(line)).join('\n');
  checks.push({id,rule,status:'fail',evidence:(tests ? tests+'\n'+error.message : error.message).slice(0,2200)});
 }
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
 return `서로 다른 ${rules.tasks.length}개 worktree와 전용 브랜치 등록 확인`;
});
for(const task of rules.tasks) await check(`file-ownership-${task.id}`,'ownership',()=>{
 const files=git('diff','--name-only',task.baseCommit || state.baseCommit,task.branch).split('\n').filter(Boolean);
 requireThat(files.length>0,`${task.id}: 완료 커밋이 아직 없습니다.`);
 const violations=files.filter(file=>!task.allow.some(allowed=>allowed.endsWith('/**') ? file.startsWith(allowed.slice(0,-2)) : file===allowed));
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
 return '이미지·로고 파일 및 정확한 생성 프롬프트·도구·날짜 기록';
});
await check('public-data-boundary','provenance',async()=>{
 const candidates=JSON.parse(await readFile(resolve(root,'app/data/hospital-candidates.json'),'utf8'));
 const profile=JSON.parse(await readFile(resolve(root,'app/data/datahub-profile.json'),'utf8'));
 requireThat(candidates.datasetId==='859' && candidates.scope==='public-preview','지정된 허브859 공개 미리보기 출처가 필요합니다.');
 requireThat(candidates.totalPreviewRows===20 && candidates.records.length===13 && candidates.excludedClosedRows===7,'공개 미리보기20행·폐업7·등록후보13 범위가 다릅니다.');
 requireThat(profile.totalRows===20 && profile.activeRegistrationRows===13,'전체 공개 집계와 후보 범위를 구분해야 합니다.');
 requireThat(candidates.records.every(row=>row.source?.isSynthetic===false && row.source?.scope==='public-preview' && row.inquiryStatus==='unverified'),'실제 등록 사실과 미확인 수용 상태를 보존해야 합니다.');
 return '실제 공개 미리보기20행 집계·등록후보13곳·출처·현재 수용 미확인 범위 확인';
});
await check('visit-support-data-boundary','provenance',async()=>{
 const {validateSupportRegistry,getSupportCandidates}=await import('../app/support-data.js');
 const registry=validateSupportRegistry(JSON.parse(await readFile(resolve(root,'app/data/visit-support-providers.json'),'utf8')));
 requireThat(registry.datasets.find(d=>d.id==='327')?.rowCount===34,'최신 연결 원출처의 콜택시34행이 필요합니다.');
 requireThat(registry.datasets.find(d=>d.id==='327')?.asOf==='2026-03-19','택시2020미리보기를2026자료로 표시하지 않습니다.');
 requireThat(registry.datasets.find(d=>d.id==='254')?.rowCount===19,'과거 돌봄 등록 문의처19행을 구분합니다.');
 requireThat(getSupportCandidates(registry,{kind:'taxi',area:'제주시 애월읍'})[0]?.name==='애월콜','출발 지역이 실제 후보를 바꿔야 합니다.');
 requireThat(getSupportCandidates(registry,{kind:'taxi',area:'제주시 애월읍',wheelchair:true})[0]?.serviceType==='accessible_transport','휠체어 요청은 별도 차량·자격 문의 경로로 이어져야 합니다.');
 requireThat(registry.providers.filter(p=>p.source.scope==='official-service-page').length===2,'공식 서비스2건을 허브 자료와 구분합니다.');
 return '지원 자료의 택시최신34/돌봄과거19/공식보완2·지역/휠체어 분기 확인 (실제 배차·동행 가능 확인 아님)';
});
await check('public-health-contact-data-boundary','provenance',async()=>{
 const {validatePublicHealthSnapshot,getPublicHealthContacts}=await import('../app/public-health-data.js');
 const snapshot=validatePublicHealthSnapshot(JSON.parse(await readFile(resolve(root,'app/data/public-health-contacts.json'),'utf8')));
 requireThat(snapshot.dataset.id==='1304' && snapshot.dataset.rowCount===35 && snapshot.dataset.asOf==='2026-03-23','제주시 공식 연결파일35행과 기준일을 확인해야 합니다.');
 requireThat(snapshot.dataset.fileSha256==='e2ac77a972f8cde38ee4cfb46c149f9f495fe5739eff0d8343563ddb93aab510','재취득한 파일의 출처 해시를 보존해야 합니다.');
 requireThat(getPublicHealthContacts(snapshot,'제주시 애월읍').some(item=>item.phone==='064-728-1514') && getPublicHealthContacts(snapshot,'제주시 조천읍').some(item=>item.phone==='064-728-1516'),'관할에 따라 실제 문의처가 달라져야 합니다.');
 const {analyzePublicData}=await import('../app/public-data-skill.js');
 const outside=analyzePublicData({analysis:'public_health_contacts',area:'서귀포시'});
 requireThat(outside.status==='unavailable' && outside.metrics[0].value===null,'제주시 자료 밖의 지역을 기관0개로 단정하면 안 됩니다.');
 return '허브 계보4종 중1304의35개 등록 문의처·관할 분기·범위 밖null 확인. 현재 운영·진료 수용의 검증 아님';
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
await check('conversation-browser-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/conversation-browser.json'),'utf8'));
 requireThat(proof.result==='pass' && proof.errors.length===0 && proof.checks.every(c=>c.status==='pass'),'대화 UI 검사에 실패한 항목이 있습니다.');
 requireThat(proof.apiLive && proof.fixedPreview && proof.normalInputDisconnected,'실제 API의 고정 예시와 일반 입력 미연결 경로가 필요합니다.');
 requireThat(proof.modelInvoked===false && proof.phoneInvoked===false && proof.healthRecordsQueried===false,'연동 보류 범위를 실제 호출 검증으로 표시하면 안 됩니다.');
 requireThat(proof.desktop.noOverflow && proof.mobile.noOverflow,'PC·모바일 대화 화면에 가로 넘침이 있습니다.');
 requireThat(proof.sourceHash===await runtimeFingerprint(root),'대화 화면 증거 이후 실행 소스가 변경됐습니다. 다시 캡처하세요.');
 for(const path of [proof.desktop.screenshot,proof.mobile.screenshot]) {const bytes=await readFile(resolve(root,path));requireThat(bytes.readUInt32BE(0)===0x89504e47,'유효한 PNG 대화 화면 증거가 아닙니다.');}
 return `${proof.checks.length}개 실제 API/화면 검사·고정 예시·일반503·입력복원·출처 확인. 실제 모델·음성·발신 품질 검증은 아님`;
});
await check('journey-browser-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/journey-browser.json'),'utf8'));
 requireThat(proof.result==='pass' && proof.errors.length===0 && proof.checks.length>0 && proof.checks.every(c=>c.status==='pass'),'진료 연결 여정 브라우저 검사가 필요합니다.');
 requireThat(proof.apiLive===true && ['missing_record','jeju_unavailable','time_changed'].every(id=>proof.scenarioIds.includes(id)),'실제 keyless preview 세 상황을 확인해야 합니다.');
 requireThat(proof.modelInvoked===false && proof.phoneInvoked===false && proof.healthRecordsQueried===false,'합성 여정 검사를 실제 연동 검증으로 표시하면 안 됩니다.');
 requireThat(['call_no_answer','call_ai_declined','call_identity_required','call_documents_or_schedule'].every(id=>proof.recoveryScenarioIds?.includes(id)) && (proof.normalAgentPostAttempts ?? proof.scope?.normalAgentPostAttempts)===0,'전화 실패4종의 인계와 모델 비발송 검사가 필요합니다.');
 requireThat(proof.desktop.noOverflow && proof.mobile.noOverflow,'진료 연결 여정 화면에 가로 넘침이 있습니다.');
 requireThat(proof.sourceHash===await runtimeFingerprint(root),'여정 증거 이후 실행 소스가 변경됐습니다. 다시 캡처하세요.');
 for(const path of [proof.desktop.screenshot,proof.mobile.screenshot]) {const bytes=await readFile(resolve(root,path));requireThat(bytes.readUInt32BE(0)===0x89504e47,'유효한 여정 PNG 증거가 아닙니다.');}
 return `${proof.checks.length}개 실제 preview/여정 검사. 실제 의료진·전화·환자기록·효과 검증은 별도`;
});
await check('preparation-board-browser-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/preparation-board-browser.json'),'utf8'));
 requireThat(proof.result==='pass' && proof.errors.length===0 && proof.checks.length>0 && proof.checks.every(item=>item.status==='pass'),'중앙 채팅·오른쪽4칸·문서스크롤·준비요약·진행검사가 필요합니다.');
 requireThat(proof.modelInvoked===false && proof.phoneInvoked===false && proof.healthRecordsQueried===false,'보드 fixture를 실제 모델/전화/기록 검증으로 표시하지 않습니다.');
 requireThat(proof.sourceHash===await runtimeFingerprint(root) && proof.finalSourceHash===proof.sourceHash,'읽기 UI 증거와 현재 실행 소스 지문이 다릅니다.');
 requireThat(proof.apiLive===true && proof.apiProgress?.unregistered?.status===200 && proof.apiProgress.unregistered.available===false && proof.apiProgress?.invalid?.status===400,'실제 keyless 진행 조회의 미등록200·잘못된입력400 검사가 필요합니다.');
 requireThat(proof.scope?.unmockedNormalPostAttempts===0 && proof.scope?.blockedPostAttempts===0,'보드 검증에서 실제 일반 모델 요청을 보내지 않습니다.');
 const sizes=[[1800,1125],[1440,900],[1152,720],[960,600],[720,450],[1060,900],[390,844],[390,500],[320,500],[768,512]];
 requireThat(proof.viewports?.length>=10 && proof.viewports.every(view=>view.noOverflow) && sizes.every(([width,height])=>proof.viewports.some(view=>view.width===width&&view.height===height)),'PC/모바일/80~200% 대응 가용 CSS 크기10종의 접근·넘침 검사가 필요합니다.');
 requireThat(proof.viewports.every(view=>view.viewportFit===true && view.sharedComposer===true && view.scrollRegions===true && view.compactPanels===true && view.initialSignalSummary===true),'한 화면 경계·같은 공통 입력·공유 스크롤·패널 전환·기호 요약의 실제 관측이 필요합니다.');
 requireThat(proof.viewports.every(view=>view.layout===(view.width>900 && view.height>650?'task-right-navigation':'tabbed-workspace') && view.chatLayout===true),'실제 좌표와 DOM으로 PC 대화/오른쪽4칸과 좁은 창 패널 전환 검사가 필요합니다.');
 requireThat(proof.viewports.every(view=>view.categoryIcons===true && view.compactSummary===true),'네 제목 아이콘과 핵심/상세 분리의 실제 viewport 검사가 필요합니다.');
 requireThat(proof.workspaceScenarios?.length>=10 && proof.workspaceScenarios.every(item=>item.viewportFit===true && item.sharedComposer===true && item.scrollRegions===true && item.compactPanels===true),'장문·표·여러 줄 입력·큰 글자·패널/반응형 전환 후 작업 공간과 공통 입력의 실제 관측이 필요합니다.');
 requireThat(['long-answer-table','multiline-12','text-200','resize-continuity','compact-discovery'].every(id=>proof.workspaceScenarios.some(item=>item.id===id)) && proof.workspaceScenarios.every(item=>item.contentReachable!==false && item.tableKeyboard!==false && item.readingStable!==false) && proof.workspaceScenarios.filter(item=>item.id==='long-answer-table').every(item=>item.contentReachable===true&&item.tableKeyboard===true) && proof.workspaceScenarios.filter(item=>['multiline-12','text-200'].includes(item.id)).every(item=>item.contentReachable===true) && proof.workspaceScenarios.filter(item=>item.id==='resize-continuity').every(item=>item.readingStable===true),'높이 맞춤만으로 본문/고지 도달·표 키보드·반응형 읽기 보존 실패를 통과시키면 안 됩니다.');
 requireThat(proof.motionScenarios?.length===4 && ['no-preference','reduce'].every(mode=>[1440,390].every(width=>proof.motionScenarios.some(item=>item.width===width && item.reducedMotion===mode))) && proof.motionScenarios.every(item=>item.greenSurfaces && item.contrastPassed && item.interactionFeedback && item.replyFeedback && item.readingStable && item.normalPostAttempts===0),'초록 대비와 일반/줄인동작의 PC·모바일 피드백/읽기 보존 검사가 필요합니다.');
 for(const view of proof.viewports){const bytes=await readFile(resolve(root,view.screenshot));requireThat(bytes.readUInt32BE(0)===0x89504e47,'읽기 UI PNG 증거가 필요합니다.');}
 return `${proof.checks.length}개 한 화면 작업 공간·공통 입력·공유 스크롤·준비 요약·기호/아이콘·실제 keyless 진행 API·진행/취소 fixture와10개 가용 CSS 크기. 실제 browser zoom·기기·모델/DDB는 별도증거.`;
});
await check('historical-model-task-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/agent-evaluation.json'),'utf8'));
 const {AGENT_EVAL_CASES}=await import('../scripts/agent-eval-cases.mjs');
 const definitionHash=createHash('sha256').update(await readFile(resolve(root,'scripts/evaluate-agent.mjs'))).update(await readFile(resolve(root,'scripts/agent-eval-cases.mjs'))).digest('hex');
 requireThat(proof.result==='pass' && proof.mode==='local-model' && proof.model==='gpt-6.1-sol' && proof.actualModelRequests>0,'과거 실제 Sol 과업의 원실행 증거가 필요합니다.');
 requireThat(proof.finalSourceHash===proof.sourceHash && proof.definitionHash===definitionHash && proof.finalDefinitionHash===definitionHash,'원실행 중 소스 또는 평가 정의가 바뀌었습니다.');
 requireThat(/^[a-f0-9]{40}$/.test(proof.revision),'원실행의 고정 커밋이 필요합니다.');
 const runtimePath=path=>path.startsWith('app/') || path.startsWith('agent/') || path.startsWith('prompts/') || ['scripts/server.mjs','package.json','package-lock.json'].includes(path);
 const previousPaths=git('ls-tree','-r','--name-only',proof.revision).split('\n').filter(runtimePath).sort();
 const previousHash=createHash('sha256');
 for(const path of previousPaths){previousHash.update(path+'\0');previousHash.update(execFileSync('git',['show',`${proof.revision}:${path}`],{cwd:root,maxBuffer:32*1024*1024}));}
 requireThat(previousHash.digest('hex')===proof.sourceHash,'원실행 커밋과 증거의 지문이 다릅니다.');
 requireThat(proof.cases.length===AGENT_EVAL_CASES.length && AGENT_EVAL_CASES.every(task=>proof.cases.some(item=>item.id===task.id && item.pass && item.checks.every(check=>check.pass) && item.recovery?.stateMatches===true && item.recovery?.requestStatus==='completed')),'과거 필수 과업·상태 검사와 읽기 복구가 모두 필요합니다.');
 requireThat(proof.actualCallsPlaced===false && proof.realRecordsConnected===false && proof.semanticReview==='required-separately','과거 합성 과업을 실제 기관/기록 검증으로 확대하지 않습니다.');
 const review=JSON.parse(await readFile(resolve(root,'orchestration/runs/agent-semantic-review.json')));
 const evidenceSha256=createHash('sha256').update(await readFile(resolve(root,'orchestration/runs/agent-evaluation.json'))).digest('hex');
 requireThat(review.result==='pass' && review.sourceHash===proof.sourceHash && review.definitionHash===definitionHash && review.reviewerModelCalls===0 && review.sourceEdits===0,'같은 원실행의 독립 의미 검토가 필요합니다.');
 requireThat(review.evidenceSha256===evidenceSha256 && review.reviewedCases.length===proof.cases.length && proof.cases.every(item=>review.reviewedCases.some(c=>c.id===item.id && c.result==='pass')),'독립 검토는 실제 응답과 모든 과업을 대조해야 합니다.');
 const currentSourceHash=await runtimeFingerprint(root), currentVerified=proof.sourceHash===currentSourceHash;
 const scope={checkedAt:new Date().toISOString(),result:currentVerified?'pass':'unverified',sourceHash:currentSourceHash,finalSourceHash:currentSourceHash,modelEvidenceSourceHash:proof.sourceHash,modelEvidenceRevision:proof.revision,modelEvidenceSha256:evidenceSha256,modelToolDataCodeUnchanged:currentVerified,currentModelValidated:currentVerified,scope:'과거12과업은 원래 커밋에만 귀속한다. 현재 서버·Prompt·workflow 변경은 fixture/keyless 검증이며 실제 모델 품질을 대신하지 않는다.'};
 if(!currentVerified){
  const quota=JSON.parse(await readFile(resolve(root,'.impeccable/review/chat-rail/reliable-visit/review/provider-quota-status.json')));
  requireThat(quota.localConfiguredApiKeyDiagnostic?.errorCode==='credit_balance_exhausted' && quota.furtherModelCallsStopped===true,'현재 모델 미검증의 관측된 호출 중단 근거가 필요합니다.');
  checks.push({id:'current-model-task-evidence',rule:'verification',status:'unverified',evidence:'현재 서버·Prompt 변경의 실제 모델 품질은 크레딧 소진으로 미검증. 이전12과업/UI-only 예외를 재사용하지 않음.'});
 } else checks.push({id:'current-model-task-evidence',rule:'verification',status:'pass',evidence:'같은 실행 지문의 실제 모델 고정 과업. 임상·일반 품질 검증은 별도.'});
 await writeFile(resolve(root,'orchestration/runs/agent-evaluation-scope.json'),JSON.stringify(scope,null,2)+'\n');
 return `${proof.revision.slice(0,8)} 당시 ${proof.cases.length}과업·Responses ${proof.actualModelRequests}회·독립 의미 검토만 확인. 현재 변경의 실모델 품질과 분리`;
});
await check('visit-recovery-browser-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/visit-recovery-browser.json'),'utf8'));
 requireThat(proof.result==='pass' && proof.errors.length===0 && proof.checks.length>=1 && proof.checks.every(item=>item.status==='pass'),'방문 복구 UI 검사가 필요합니다.');
 requireThat(proof.sourceHash===await runtimeFingerprint(root) && proof.finalSourceHash===proof.sourceHash,'방문 복구 UI의 실행 지문이 다릅니다.');
 requireThat(proof.modelInvoked===false && proof.phoneInvoked===false && proof.recordsQueried===false && proof.unmockedModelPosts===0 && proof.actualFixedPreviews===1,'복구 UI fixture와 실제 keyless preview 범위를 구분합니다.');
 requireThat(proof.viewports.length===10 && proof.viewports.every(view=>view.viewportFit && view.sharedComposer && view.scrollRegions && view.compactPanels),'복구 안내의 가용 크기10종·초안·공통 입력 검사가 필요합니다.');
 for(const view of proof.viewports){const bytes=await readFile(resolve(root,view.screenshot));requireThat(bytes.readUInt32BE(0)===0x89504e47,'복구 UI PNG 증거가 필요합니다.');}
 return `${proof.checks.length}개 실제 정적 UI/응답 fixture·실패/만료/late·입력/초점/읽기 보존. 실제 서비스 통합은 별도 증거`;
});
await check('proposal-pdf-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/proposal-pdf.json'),'utf8'));
 const pdf=await readFile(resolve(root,'docs/submission-proposal.pdf'));
 const info=execFileSync('pdfinfo',[resolve(root,'docs/submission-proposal.pdf')],{encoding:'utf8'});
 requireThat(proof.result==='pass' && proof.sourceHash===await runtimeFingerprint(root) && proof.pages===12 && Number(info.match(/^Pages:\s+(\d+)/m)?.[1])===12 && proof.screenshotIncluded===true,'같은 구현과 실제 캡처를 포함한12페이지 기획서가 필요합니다.');
 requireThat(proof.pdfHash===createHash('sha256').update(pdf).digest('hex') && pdf.subarray(0,5).toString()==='%PDF-','기획서 PDF 바이트와 기록이 다릅니다.');
 return '실제 PDF12페이지·동일 실행 지문의 PC 캡처·파일 SHA 확인. 권리 최종 검토/영상/대회 업로드/센터 실기기와 구분';
});
await check('visit-recovery-http-integration-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/visit-recovery-integration.json'),'utf8'));
 requireThat(proof.result==='pass' && proof.errors.length===0 && proof.checks.length>0 && proof.checks.every(item=>item.status==='pass'),'실제 HTTP 응답 유실·복구 통합 검사가 필요합니다.');
 requireThat(proof.sourceHash===await runtimeFingerprint(root) && proof.finalSourceHash===proof.sourceHash,'통합 HTTP/UI의 실행 지문이 다릅니다.');
 requireThat(proof.modelInvoked===false && proof.realModelCalls===0 && proof.realAwsCalls===0 && proof.externalHttpAttempts===0 && proof.fixtureProviderRespondCalls>0 && proof.actualHttpPostCounts.agent>0 && proof.actualHttpPostCounts.resume>0,'실제 HTTP/서비스와 고정 provider fixture를 구분합니다.');
 const fields=['completedResponseLost','sameTokenRestored','transcriptNotReplayed','actualResumeReadOnly','firstRequestReplayedWithoutEffects','bodyConflictRejected','nextRequestChangedVisit','draftPreserved','identifiersAbsent'];
 requireThat(proof.viewports.length===2 && [1440,390].every(width=>proof.viewports.some(view=>view.width===width)) && proof.viewports.every(view=>fields.every(field=>view[field]===true)),'PC/모바일 응답 유실→복구→중복/409→후속 변경을 확인해야 합니다.');
 requireThat(proof.staticFiles.length>0 && proof.staticFiles.every(item=>item.matches===true),'실제 제공한 정적 모듈 바이트 대조가 필요합니다.');
 for(const view of proof.viewports)for(const path of view.screenshots){const bytes=await readFile(resolve(root,path));requireThat(bytes.readUInt32BE(0)===0x89504e47,'통합 복구 PNG 증거가 필요합니다.');}
 return `${proof.checks.length}개 실제 HTTP/현재 서비스·저장소·dispatcher/UI 통합. provider fixture만 사용하며 실모델/AWS 지속성/전화 증거와 구분`;
});
await check('native-tab-zoom-browser-evidence','verification',async()=>{
 const proof=JSON.parse(await readFile(resolve(root,'orchestration/runs/native-zoom-browser.json'),'utf8'));
 requireThat(proof.result==='pass' && proof.errors.length===0 && proof.checks.length>0 && proof.checks.every(item=>item.status==='pass'),'실제 탭 확대·읽기/초안/초점 보존 검사가 필요합니다.');
 requireThat(proof.sourceHash===await runtimeFingerprint(root) && proof.finalSourceHash===proof.sourceHash,'실제 확대 검사의 소스 지문이 다릅니다.');
 requireThat(proof.zoomMethod?.playwrightViewport===null && /setZoom/.test(proof.zoomMethod.api),'CSS 크기 에뮬레이션과 실제 MV3 탭 확대를 구분해야 합니다.');
 requireThat(proof.zoomScenarios.length===5 && [.8,1,1.25,1.5,2].every(zoom=>proof.zoomScenarios.some(view=>view.requestedZoom===zoom && Math.abs(view.actualZoom-zoom)<.01 && Math.abs(view.dpr-zoom)<.01)),'80/100/125/150/200% 실제 getZoom·DPR 관측이 필요합니다.');
 requireThat(proof.zoomScenarios.every(view=>view.rootZoom==='1' && view.bodyTransform==='none' && view.viewportFit && view.noOverflow && view.sharedComposer && view.scrollRegions && view.compactPanels && view.targets44),'확대를 CSS 축소로 상쇄하거나 입력/읽기 접근을 제거하면 안 됩니다.');
 requireThat(proof.normalModelPostAttempts===0 && proof.otherPostAttempts===0 && proof.modelInvoked===false && proof.fixtureResponses===false && proof.fixedPreviewRequests>0,'실제 keyless preview와 GET·native 확대만 사용하는 범위를 지켜야 합니다.');
 requireThat(proof.cleanup?.contextClosed && proof.cleanup?.xvfbStopped && proof.cleanup?.temporaryProfileRemoved,'격리 브라우저·화면·임시 프로필 정리가 필요합니다.');
 for(const view of proof.zoomScenarios){const bytes=await readFile(resolve(root,view.screenshot));requireThat(bytes.readUInt32BE(0)===0x89504e47,'실제 native 확대 PNG 캡처가 필요합니다.');}
 return `${proof.checks.length}개 격리 Chromium/Xvfb·MV3 탭 확대와 초안/출처 읽기/고지 확인. 툴바 직접조작·실제 휴대폰/하드웨어 검증은 아님`;
});
await check('rollback-boundary','rollback',()=>{
 for(const task of rules.tasks) {
  const integrated=state.tasks[task.id].integrationCommits;
  requireThat(integrated.length>0,`${task.id}: 통합 커밋이 아직 기록되지 않았습니다.`);
  for(const commit of integrated) git('merge-base','--is-ancestor',commit,'HEAD');
 }
 return '작업별 통합 커밋을 HEAD의 조상으로 확인; 허용된 커밋만 revert 가능';
});
const passed=checks.filter(c=>c.status==='pass').length,failed=checks.filter(c=>c.status==='fail').length,unverified=checks.filter(c=>c.status==='unverified').length;
requireThat(passed+failed+unverified===checks.length,'검증 상태를 누락할 수 없습니다.');
const result={evaluatedAt:new Date().toISOString(),commit:git('rev-parse','HEAD'),automated:{passed,failed,unverified,total:checks.length,rate:Math.round(passed/checks.length*1000)/10},checks,
 manualUnverified:['현재 guided 서버/Prompt의 실제 모델 과업 품질 (크레딧 소진으로 미검증; 과거12과업과 별도)','전체 운영 데이터 API·최신성·전체 원자료 재배포 조건 (허브계보4종 최소 사실은 실제 사용)','실제 전화·기관 접수·공단 기록 연계·의료진 참여','Terra·일반 과업 품질·실제 휴대폰 키보드/마이크·보호자 참여 평가 (Sol12개 합성 과업과 별도)','임상 유효성·실서비스 개인정보 처리·정책 검토','최종 공지/발표·영상/권리 확인·대회 업로드 및 센터 실기기 실행'],submissionReady:false};
await mkdir(resolve(root,'orchestration/runs'),{recursive:true});
await writeFile(resolve(root,'orchestration/runs/latest-eval.json'),JSON.stringify(result,null,2)+'\n');
for(const item of checks) console.log(`${item.status==='pass'?'PASS':item.status==='unverified'?'UNVERIFIED':'FAIL'} ${item.id} · ${item.evidence}`);
console.log(`\n자동 검증 규칙 준수율: ${passed}/${checks.length} (${result.automated.rate}%) · 실패${failed} · 미검증${unverified}\n별도 미검증 요건: ${result.manualUnverified.length}개 · 최종 제출 준비 완료: 아니오\n기록: orchestration/runs/latest-eval.json`);
if(failed>0) process.exitCode=1;

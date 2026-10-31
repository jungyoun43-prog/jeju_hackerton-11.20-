import test from 'node:test';
import assert from 'node:assert/strict';
import { PUBLIC_DATA_TOOLS, PUBLIC_DATA_SOURCE_URLS, createPublicDataToolExecutor, executePublicDataTool } from '../agent/public-data-tools.mjs';
import { createToolDispatcher } from '../agent/tools.mjs';
import { createDemoCase } from '../app/domain.js';
import { getSupportCandidates, validateSupportRegistry } from '../app/support-data.js';
import hospitals from '../app/data/hospital-candidates.json' with {type:'json'};
import supportData from '../app/data/visit-support-providers.json' with {type:'json'};

const HOSPITAL_SOURCE='https://jejudatahub.net/data/view/data/859';
const registry=validateSupportRegistry(supportData);
const sources=new Set(PUBLIC_DATA_SOURCE_URLS.map(value => new URL(value).href));
const argumentError=error => error.code === 'INVALID_TOOL_ARGUMENTS';
const freeze=value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
};
const emptyAnalysis=(analysis='support_candidates') => ({version:1,analysis,status:'ok',datasetRefs:[],rows:[],metrics:{},candidates:[],preparationActions:[],limitations:[],missingData:[],caseMutation:false,actualCallPlaced:false,reservationConfirmed:false,clinicalAcceptanceConfirmed:false});

test('공공데이터 도구 두 개는 읽기 전용이며 경로·URL·SQL·원자료 주입 필드를 열지 않는다',() => {
  assert.deepEqual(PUBLIC_DATA_TOOLS.map(spec => spec.name),['search_public_data','analyze_public_data']);
  for (const spec of PUBLIC_DATA_TOOLS) {
    assert.equal(spec.readOnly,true);
    assert.equal(spec.inputSchema.additionalProperties,false);
    for (const key of ['path','url','sql','rows','source','now','patient','records','state']) assert.equal(Object.hasOwn(spec.inputSchema.properties,key),false);
  }
  const search=PUBLIC_DATA_TOOLS[0].inputSchema;
  assert.equal(search.properties.query.maxLength,200);
  assert.equal(search.properties.limit.maximum,8);
  const areas=PUBLIC_DATA_TOOLS[1].inputSchema.properties.areas;
  assert.equal(areas.minItems,2);assert.equal(areas.maxItems,2);
});

test('직접 실행도 형식·길이·분석별 필수/허용 인자를 검사하고 잘못된 입력을 backend에 넘기지 않는다',() => {
  let calls=0;
  const execute=createPublicDataToolExecutor({search:() => {calls++;},analyze:() => {calls++;}});
  const searchInvalid=[null,[],{}, {purpose:'other'}, {purpose:'taxi',limit:0}, {purpose:'taxi',limit:9}, {purpose:'taxi',limit:1.5}, {purpose:'taxi',query:'가'.repeat(201)}, {purpose:'taxi',query:'\u0000'},
    ...['path','url','sql','rows','source','now','patient','records','state'].map(key => ({purpose:'taxi',[key]:'injected'}))];
  for (const input of searchInvalid) assert.throws(() => execute({name:'search_public_data',input,state:{}}),argumentError);
  const analysisInvalid=[{}, {analysis:'other'}, {analysis:'facility_compare'}, {analysis:'facility_compare',areas:['제주시']}, {analysis:'facility_compare',areas:['제주시','서귀포시','애월읍']},
    {analysis:'facility_compare',areas:['제주시',' 제주시 ']}, {analysis:'facility_compare',areas:['','서귀포시']}, {analysis:'facility_compare',areas:['  ','서귀포시']}, {analysis:'facility_compare',areas:[1,2]},
    {analysis:'facility_compare',areas:['제주시','서귀포시'],area:'애월읍'}, {analysis:'support_candidates',supportKind:'hospital'}, {analysis:'support_candidates',supportKind:'taxi',wheelchair:'yes'},
    {analysis:'support_candidates',supportKind:'taxi',area:' '}, {analysis:'support_candidates',supportKind:'taxi',areas:['제주시','서귀포시']}, {analysis:'travel_time',wheelchair:true}, {analysis:'travel_time',supportKind:'taxi'}, {analysis:'travel_time',url:'https://evil.test'}];
  for (const input of analysisInvalid) assert.throws(() => execute({name:'analyze_public_data',input,state:{}}),argumentError);
  assert.throws(() => execute({name:'run_sql',input:{},state:{}}),error => error.code === 'UNKNOWN_TOOL');
  assert.equal(calls,0);
});

test('분석 context는 행정지역·휠체어·공개 목적기관명만 복사하고 환자명·개인 기록은 읽지 않는다',() => {
  const guarded=(values,allowed) => new Proxy(values,{get(target,key) {assert.ok(allowed.includes(key),`허용하지 않은 필드 조회: ${String(key)}`);return target[key];}});
  const patient=guarded({area:'제주시 애월읍',localHospital:'제주 문의기관'},['area','localHospital']);
  const requirements=guarded({wheelchair:true},['wheelchair']);
  const state=guarded({patient,visitSupport:guarded({requirements},['requirements']),selectedHospital:{companyName:'제주우리병원'}},['patient','visitSupport','selectedHospital']);
  let received;
  const execute=createPublicDataToolExecutor({analyze:(input,context) => {received={input,context};return emptyAnalysis(input.analysis);}});
  const result=execute({name:'analyze_public_data',input:{analysis:'support_candidates',supportKind:'taxi'},state});
  assert.strictEqual(result.state,state);
  assert.deepEqual(received.context,{area:'제주시 애월읍',wheelchair:true,hospitalName:'제주우리병원'});
  assert.equal(Object.isFrozen(received.context),true);
  assert.deepEqual(received.input,{analysis:'support_candidates',supportKind:'taxi'});
  assert.deepEqual(result.pendingActions,[]);
});

test('목록 검색은 사례를 읽지 않고 원문 query를 event·pendingActions·state에 저장하지 않는다',() => {
  const query='private-query-token SELECT * FROM records /tmp/secret https://evil.test';
  const state=new Proxy({}, {get() {throw new Error('목록 검색은 사례를 읽지 않아야 합니다.');}});
  let received;
  const execute=createPublicDataToolExecutor({search:input => {received=input;return {version:1,purpose:input.purpose,query:input.query,results:[{sourceUrl:HOSPITAL_SOURCE}]};}});
  const result=execute({name:'search_public_data',input:{purpose:'hospital',query,limit:1},state});
  assert.strictEqual(result.state,state);
  assert.equal(received.query,query);
  assert.equal(result.data.query,query);
  assert.equal(JSON.stringify({events:result.events,pendingActions:result.pendingActions}).includes(query),false);
  assert.equal(result.events[0].source,HOSPITAL_SOURCE);
  assert.equal(result.events[0].isSimulation,false);
});

test('출처는 정확한 공식 allowlist URL만 사용하며 backend의 미등록 출처도 거부한다',() => {
  for (const sourceUrl of ['http://jejudatahub.net/data/view/data/859','https://user:secret@jejudatahub.net/data/view/data/859','https://jejudatahub.net:8443/data/view/data/859','https://jejudatahub.net.evil.test/data/view/data/859','https://jejudatahub.net/data/view/data/859?redirect=evil','javascript:alert(1)']) {
    const search=createPublicDataToolExecutor({search:() => ({results:[{sourceUrl}]})});
    assert.throws(() => search({name:'search_public_data',input:{purpose:'hospital'},state:{}}),error => error.code === 'INVALID_SOURCE');
    const analyze=createPublicDataToolExecutor({analyze:() => ({...emptyAnalysis(),candidates:[{source:{url:sourceUrl}}]})});
    assert.throws(() => analyze({name:'analyze_public_data',input:{analysis:'support_candidates',supportKind:'taxi'},state:{}}),error => error.code === 'INVALID_SOURCE');
  }
});

test('실제 검색은 메타데이터 전체와 계산 가능한 snapshot을 구분하고 요청한 topK를 지킨다',() => {
  const state=freeze(createDemoCase()),before=JSON.stringify(state);
  for (const [purpose,query,expectedId] of [['hospital','병원','hub:859'],['taxi','콜택시','hub:327'],['companion','돌봄','hub:254'],['travel','일/시간대별 교통량','center:10']]) {
    const result=executePublicDataTool({name:'search_public_data',input:{purpose,query,limit:3},state});
    assert.strictEqual(result.state,state);
    assert.equal(result.data.indexedMetadataCount,1329);
    assert.ok(result.data.results.length > 0 && result.data.results.length <= 3);
    assert.ok(result.data.results.some(item => item.id === expectedId),`${purpose} 관련 자료가 topK 안에 있어야 합니다.`);
    for (const item of result.data.results) {
      assert.ok(sources.has(new URL(item.sourceUrl).href));
      assert.ok(item.folder && Array.isArray(item.tags));
      assert.ok(Object.hasOwn(item.coverage,'asOf') && Object.hasOwn(item.coverage,'rowCount'));
      if (!result.data.usableSnapshotIds.includes(item.id)) {
        assert.equal(item.coverage.asOf,null);assert.equal(item.coverage.rowCount,null);
      }
    }
    for (const event of result.events) if (event.source) assert.ok(sources.has(event.source));
  }
  assert.equal(JSON.stringify(state),before);
});

test('지역 비교 수치는 snapshot 주소에서 독립 계산한 의료13/0·돌봄10/9와 같고 별도 분모·시점을 보존한다',() => {
  const state=freeze(createDemoCase()),before=JSON.stringify(state);
  const areas=['제주시','서귀포시'];
  const result=executePublicDataTool({name:'analyze_public_data',input:{analysis:'facility_compare',areas},state});
  const {data}=result;
  assert.equal(data.rows.length,4);assert.equal(data.metrics.length,2);
  for (const [kind,id,records,nameKey,sourceRows,closed] of [
    ['hospital','hub:859',hospitals.records,'companyName',20,7],
    ['companion','hub:254',supportData.providers.filter(item => item.source.datasetId === '254'),'name',19,0],
  ]) {
    // 분석 모듈·분류 함수를 재사용하지 않고 제공 snapshot의 등록 주소에서 독립 집계한다.
    const unique=new Map(records.filter(item => kind !== 'hospital' || !/폐업|휴업|취소|말소/.test(item.openStatus))
      .map(item => [`${item[nameKey].trim().toLowerCase()}\u0000${item.address.trim().toLowerCase()}`,item]));
    const located=[...unique.values()].filter(item => areas.some(area => item.address.includes(area)));
    const metric=data.metrics.find(item => item.datasetId === id);
    assert.equal(metric.sourceRows,sourceRows);assert.equal(metric.loadedRows,records.length);
    assert.equal(metric.denominator,located.length);assert.equal(metric.eligibleRows,unique.size);
    assert.equal(metric.duplicateRows,records.length-unique.size);assert.equal(metric.excludedClosedRows,closed);
    assert.equal(metric.addressMissingRows,0);assert.equal(metric.unlocatedRows,0);
    for (const area of areas) {
      const count=located.filter(item => item.address.includes(area)).length;
      const row=data.rows.find(item => item.area === area && item.kind === kind);
      assert.equal(row.observedCount,count);assert.equal(row.denominator,located.length);
      assert.equal(row.shareOfLocatedSnapshot,Number((count/located.length*100).toFixed(2)));
      assert.equal(row.shareUnit,'percent');assert.ok(row.denominatorLabel);
      assert.equal(row.asOf,kind === 'hospital' ? null : '2020-04-17');
    }
  }
  assert.deepEqual(data.rows.filter(row => row.kind === 'hospital').map(row => row.observedCount),[13,0]);
  assert.deepEqual(data.rows.filter(row => row.kind === 'companion').map(row => row.observedCount),[10,9]);
  assert.match(data.datasetRefs.find(item => item.id === 'hub:859').coverage.label,/2024-10-17 13:53/);
  assert.match(data.limitations.join(' '),/전체|표본/);
  assert.equal(data.caseMutation,false);assert.strictEqual(result.state,state);assert.equal(JSON.stringify(state),before);
  assert.equal(result.state.patient.area,'제주시 애월읍');
  for (const action of data.preparationActions) {
    const ids=new Set(getSupportCandidates(registry,{kind:action.tool.input.kind,area:state.patient.area,wheelchair:state.visitSupport.requirements.wheelchair}).map(item => item.id));
    assert.ok(ids.has(action.tool.input.providerId),'비교 지역을 새 환자 출발지로 적용하지 않아야 합니다.');
  }
});

test('지원 종류 생략은 이동과 동행을 함께 조회하며 반환 후보는 최대5개다',() => {
  const state=freeze(createDemoCase());
  const {data}=executePublicDataTool({name:'analyze_public_data',input:{analysis:'support_candidates'},state});
  assert.equal(data.inputs.supportKind,'both');
  assert.ok(data.candidates.length > 0 && data.candidates.length <= 5);
  assert.deepEqual(new Set(data.candidates.map(item => item.kind)),new Set(['taxi','companion']));
  assert.deepEqual(new Set(data.preparationActions.map(action => action.tool.input.kind)),new Set(['taxi','companion']));
});

test('다른 지역 조회는 그 지역 후보만 읽고 현재 출발지용 문의 도구를 잘못 제안하지 않는다',() => {
  const state=freeze(createDemoCase()),before=JSON.stringify(state),area='서귀포시 성산읍';
  const {data}=executePublicDataTool({name:'analyze_public_data',input:{analysis:'support_candidates',area,supportKind:'taxi'},state});
  const expected=getSupportCandidates(registry,{kind:'taxi',area,wheelchair:false});
  assert.deepEqual(data.candidates.map(item => item.id),expected.slice(0,data.candidates.length).map(item => item.id));
  assert.deepEqual(data.preparationActions,[]);
  assert.match([...data.limitations,...data.missingData].join(' '),/출발.*지역|지역.*출발/);
  const travel=executePublicDataTool({name:'analyze_public_data',input:{analysis:'travel_time',area},state});
  assert.deepEqual(travel.data.preparationActions,[]);
  assert.equal(travel.data.status,'unavailable');
  assert.equal(JSON.stringify(state),before);
});

test('지원 후보 분석은 기존 registry와 같은 지역·휠체어 ID를 사용하고 사례를 변경하지 않는다',() => {
  for (const [area,wheelchair] of [['제주시 애월읍',false],['서귀포시 성산읍',false],['제주시 애월읍',true]]) {
    const mutable=createDemoCase();mutable.patient.area=area;mutable.visitSupport.requirements.wheelchair=wheelchair;
    mutable.patient.name='개인 이름 사용 금지';mutable.documents[0].content='개인 의무기록 사용 금지';
    const state=freeze(mutable),before=JSON.stringify(state);
    for (const supportKind of ['taxi','companion']) {
      const {data,state:after,events,pendingActions}=executePublicDataTool({name:'analyze_public_data',input:{analysis:'support_candidates',supportKind},state});
      const expected=getSupportCandidates(registry,{kind:supportKind,area,wheelchair});
      assert.strictEqual(after,state);assert.equal(JSON.stringify(state),before);
      assert.ok(data.candidates.length > 0);
      assert.deepEqual(data.candidates.map(item => item.id),expected.slice(0,data.candidates.length).map(item => item.id));
      if (supportKind === 'taxi' && wheelchair) assert.equal(data.candidates[0].id,'jeju-accessible-transport');
      for (const flag of ['actualCallPlaced','reservationConfirmed','clinicalAcceptanceConfirmed','caseMutation']) assert.equal(data[flag],false);
      const visible=JSON.stringify({data,events,pendingActions});
      assert.equal(visible.includes('개인 이름 사용 금지'),false);assert.equal(visible.includes('개인 의무기록 사용 금지'),false);
    }
  }
});

test('후보 분석의 준비 제안은 유효한 기존 prepare_inquiries ID와 질문으로 이어진다',async () => {
  const state=createDemoCase();state.visitSupport.requirements.wheelchair=true;
  const dispatch=createToolDispatcher({phoneAdapter:null});
  for (const supportKind of ['taxi','companion']) {
    const {data}=executePublicDataTool({name:'analyze_public_data',input:{analysis:'support_candidates',supportKind},state});
    const validIds=new Set(getSupportCandidates(registry,{kind:supportKind,area:state.patient.area,wheelchair:true}).map(item => item.id));
    assert.ok(data.preparationActions.length > 0);
    for (const action of data.preparationActions) {
      assert.equal(action.tool.name,'prepare_inquiries');
      assert.equal(action.tool.input.kind,supportKind);
      assert.ok(validIds.has(action.tool.input.providerId));
      assert.ok(action.requestDraft.trim());
      const prepared=await dispatch({name:action.tool.name,input:action.tool.input,state,userMessage:action.requestDraft});
      assert.equal(prepared.state.visitSupport[supportKind].status,'prepared');
      assert.equal(prepared.data.provider.id,action.tool.input.providerId);
      assert.match(prepared.data.draft,/확인|문의/);
      assert.equal(prepared.data.actualCallPlaced,false);assert.equal(prepared.data.reservationConfirmed,false);
    }
  }
});

test('이동시간은 센터 명세를 찾되 원자료가 없어 ETA·평균·시간 수치를 생성하지 않는다',() => {
  const state=freeze(createDemoCase()),before=JSON.stringify(state);
  const result=executePublicDataTool({name:'analyze_public_data',input:{analysis:'travel_time'},state});
  const {data}=result;
  assert.equal(data.status,'unavailable');
  assert.deepEqual(data.rows,[]);
  assert.ok(data.missingData.length > 0);
  assert.ok(data.datasetRefs.some(item => /^center:(7|8|10)$/.test(item.id)));
  const numericPaths=[];
  const walk=(value,path) => {
    if (typeof value === 'number') numericPaths.push(path);
    else if (value && typeof value === 'object') for (const [key,child] of Object.entries(value)) walk(child,`${path}.${key}`);
  };
  walk(data.metrics,'metrics');walk(data.rows,'rows');
  assert.deepEqual(numericPaths,[]);
  for (const key of ['eta','durationMinutes','travelTimeMinutes','averageMinutes']) assert.equal(data[key] ?? null,null);
  assert.equal(result.events[0].status,'needs_input');
  assert.equal(JSON.stringify(state),before);assert.strictEqual(result.state,state);
});

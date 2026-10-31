import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { formatMessage } from '../app/message-format.js';

test('빈 제목과 잘못된 제목 뒤에도 진행하며 회귀 시 하위 프로세스만 제한 시간 내 종료한다',()=>{
  const inputs=['# ','### \t','###','####### malformed','#   \n\n## 정상 제목\n\n- **판독문**'];
  const moduleUrl=new URL('../app/message-format.js',import.meta.url).href;
  const script=`import { formatMessage } from ${JSON.stringify(moduleUrl)};process.stdout.write(JSON.stringify(${JSON.stringify(inputs)}.map(formatMessage)));`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',script],{timeout:2000,killSignal:'SIGKILL',encoding:'utf8',maxBuffer:1024*1024});
  assert.ifError(result.error);
  assert.equal(result.status,0,result.stderr);
  assert.deepEqual(JSON.parse(result.stdout),[
    '<p># </p>',
    '<p>### \t</p>',
    '<p>###</p>',
    '<p>####### malformed</p>',
    '<p>#   </p><h4>정상 제목</h4><ul><li><strong>판독문</strong></li></ul>',
  ]);
});

test('진료 준비 제목·강조·목록과 다음 문단을 각각 읽을 수 있다',()=>{
  const html=formatMessage('## 준비할 자료\n\n- **판독문**을 챙겨 주세요.\n- 검사 영상\n\n병원에서 발급 방법을 확인해 주세요.');
  assert.match(html,/<h4>준비할 자료<\/h4>/);
  assert.match(html,/<ul><li><strong>판독문<\/strong>을 챙겨 주세요\.<\/li><li>검사 영상<\/li><\/ul><p>병원에서/);
});

test('번호와 중첩 목록을 유지하고 목록 뒤 문단을 삼키지 않는다',()=>{
  const html=formatMessage('3. 병원에 문의\n   - 접수 절차\n   - 자료 발급\n4. 이동 확인\n\n예약은 아직 확정되지 않았습니다.');
  assert.match(html,/<ol start="3"><li>병원에 문의<ul><li>접수 절차<\/li><li>자료 발급<\/li><\/ul><\/li><li>이동 확인<\/li><\/ol>/);
  assert.ok(html.endsWith('<p>예약은 아직 확정되지 않았습니다.</p>'));
});

test('원문 HTML과 강조 안의 실행 코드는 실행 가능한 요소가 되지 않는다',()=>{
  const html=formatMessage('<img src=x onerror=alert(1)>\n**<script>alert(2)</script>**\n\n- </li><svg onload=alert(3)>');
  assert.doesNotMatch(html,/<(?:img|script|svg)\b/i);
  assert.match(html,/&lt;img/);
  assert.match(html,/<strong>&lt;script&gt;alert\(2\)&lt;\/script&gt;<\/strong>/);
  assert.match(html,/<li>&lt;\/li&gt;&lt;svg/);
});

test('HTTPS 링크만 만들고 스크립트·데이터·인증 포함 URL은 문자로 남긴다',()=>{
  const html=formatMessage('[출처](https://example.org/help?a=1&b=2) [실행](javascript:alert%281%29) [자료](data:text/html,x) [인증](https://user:secret@example.org/)');
  assert.equal((html.match(/<a /g)||[]).length,1);
  assert.match(html,/href="https:\/\/example.org\/help\?a=1&amp;b=2"/);
  assert.match(html,/rel="noopener noreferrer"/);
  assert.doesNotMatch(html,/href="(?:javascript|data):|href="https:\/\/user:/);
});

test('링크 라벨·속성을 이스케이프하고 CRLF 줄바꿈을 표시한다',()=>{
  const html=formatMessage('[<img>](https://example.org/\"onmouseover=\"x)\r\n다음 줄\r\n\r\n**확인 필요**');
  assert.doesNotMatch(html,/<img|\sonmouseover=/i);
  assert.match(html,/&lt;img&gt;/);
  assert.match(html,/<br>다음 줄<\/p><p><strong>확인 필요<\/strong><\/p>/);
});

test('비교 표는 열 머리글·본문과 구분선의 왼쪽·가운데·오른쪽 정렬을 갖는다',()=>{
  const html=formatMessage('| **지역** | 시설 수 | 출처 |\n| :--- | ---: | :---: |\n| 제주시 | 12 | [공개 자료](https://example.org/data?a=1&b=2) |\n| 서귀포시 | 7 | 확인 필요 |');
  assert.match(html,/<div class="message-table-scroll" role="region" aria-label="[^"]+" tabindex="0"><table aria-label="대화 표"><thead><tr>/);
  assert.match(html,/<th scope="col" class="message-table-align-left"><strong>지역<\/strong><\/th>/);
  assert.match(html,/<th scope="col" class="message-table-align-right">시설 수<\/th>/);
  assert.match(html,/<th scope="col" class="message-table-align-center">출처<\/th>/);
  assert.match(html,/<tbody><tr><td class="message-table-align-left">제주시<\/td>/);
  assert.match(html,/<td class="message-table-align-right">12<\/td>/);
  assert.match(html,/<a href="https:\/\/example.org\/data\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">공개 자료<\/a>/);
  assert.equal((html.match(/<tr>/g)||[]).length,3);
  assert.ok(html.endsWith('</tbody></table></div>'));
});

test('바깥 pipe 없이도 표를 읽고 escaped pipe와 역슬래시 짝수·홀수 경계를 구분한다',()=>{
  const html=formatMessage(String.raw`기관 | 표시
--- | ---
동부\|서부 | 한 셀
두 개\\ | 경계
세 개\\\|유지 | 한 셀`);
  assert.match(html,/<td class="message-table-align-left">동부\|서부<\/td>/);
  assert.ok(html.includes('<td class="message-table-align-left">두 개\\\\</td>'));
  assert.ok(html.includes('<td class="message-table-align-left">세 개\\\\|유지</td>'));
  assert.equal((html.match(/<td /g)||[]).length,6);
});

test('표 전후 문단·제목·목록과 다음 표를 잃지 않는다',()=>{
  const html=formatMessage('분모와 자료 시점이 다릅니다.\n지역 | 시설 수\n--- | ---:\n제주시 | 12\n서귀포시 | 7\n실시간 수용 여부는 미확인입니다.\n## 다음 확인\n- 기관에 문의\n\n| 항목 | 상태 |\n| --- | --- |\n| 예약 | 미확정 |\n\n끝 문단');
  assert.ok(html.startsWith('<p>분모와 자료 시점이 다릅니다.</p><p class="message-table-hint">'));
  assert.match(html,/<\/table><\/div><p>실시간 수용 여부는 미확인입니다\.<\/p><h4>다음 확인<\/h4><ul><li>기관에 문의<\/li><\/ul>/);
  assert.equal((html.match(/<table /g)||[]).length,2);
  assert.ok(html.endsWith('</table></div><p>끝 문단</p>'));
});

test('표 안의 HTML·강조·링크에도 같은 이스케이프와 HTTPS 제한을 적용한다',()=>{
  const html=formatMessage('| <img src=x onerror=alert(1)> | 출처 |\n| --- | --- |\n| **</td><svg onload=alert(2)>** | [<script>](https://example.org/data) |\n| & " \' | [실행](javascript:alert%281%29) |\n| 원문 | [자료](data:text/html,x) [인증](https://user:secret@example.org/) [HTTP](http://example.org/) |');
  assert.doesNotMatch(html,/<(?:img|svg|script)\b|href="(?:javascript|data|http):|href="https:\/\/user:/i);
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html,/<strong>&lt;\/td&gt;&lt;svg onload=alert\(2\)&gt;<\/strong>/);
  assert.match(html,/<a [^>]+>&lt;script&gt;<\/a>/);
  assert.match(html,/&amp; &quot; &#39;/);
  assert.equal((html.match(/<a /g)||[]).length,1);
});

test('깨진 표는 부족하거나 남는 셀을 버리지 않고 원문으로 표시한다',()=>{
  const cases=[
    '지역 | 기관\n--- | ---\n제주시 | 1 | 초과\n서귀포시 | 2',
    '| 지역 | 기관 |\n| --- | --- |\n| 빠진 셀 |',
    '지역 | 기관\n-- | ---\n제주시 | 1',
    '지역 | 기관\n--- | --- | ---\n제주시 | 1',
    '지역 \\| 기관\n--- | ---\n제주시 | 1',
    '| | |\n| --- | --- |\n| 자료 | 1 |',
    '    지역 | 기관\n    --- | ---\n    제주시 | 1',
  ];
  for(const input of cases) {
    const html=formatMessage(input+'\n\n마지막 문장');
    assert.doesNotMatch(html,/<table\b/);
    assert.equal(html,'<p>'+input.split('\n').join('<br>')+'</p><p>마지막 문장</p>');
  }
});

test('8열·본문 40행까지 표시하며 더 큰 표도 모든 입력을 남긴다',()=>{
  const table=(columns,rows)=>[
    '| '+Array.from({length:columns},(_,col)=>`열${col}`).join(' | ')+' |',
    '| '+Array(columns).fill('---').join(' | ')+' |',
    ...Array.from({length:rows},(_,row)=>'| '+Array.from({length:columns},(_,col)=>`자료${row}-${col}`).join(' | ')+' |'),
  ].join('\n');
  const boundary=formatMessage(table(8,40));
  assert.equal((boundary.match(/<th /g)||[]).length,8);
  assert.equal((boundary.match(/<td /g)||[]).length,320);
  for(const input of [table(9,2),table(2,41)]) {
    const html=formatMessage(input+'\n\n마지막 문장');
    assert.doesNotMatch(html,/<table\b/);
    assert.equal(html,'<p>'+input.split('\n').join('<br>')+'</p><p>마지막 문장</p>');
  }
  const markers='항목 | 값\n--- | ---\n'+Array(41).fill('--- | ---').join('\n');
  assert.equal(formatMessage(markers),'<p>'+markers.split('\n').join('<br>')+'</p>');
});

test('한 열·빈 셀과 머리글만 있는 표를 보존하고 코드 문법은 원문으로 남긴다',()=>{
  const html=formatMessage('| 항목 |\n| --- |\n| `원문` |\n\n| 항목 | 값 |\n| --- | --- |\n|  | 미상 |\n\n| 머리글 |\n| --- |');
  assert.equal((html.match(/<table /g)||[]).length,3);
  assert.match(html,/<td class="message-table-align-left">`원문`<\/td>/);
  assert.match(html,/<td class="message-table-align-left"><\/td><td class="message-table-align-left">미상<\/td>/);
  assert.ok(html.endsWith('</thead><tbody></tbody></table></div>'));
});

test('깨진 pipe 입력도 종료하고 목록 안의 들여쓴 표는 기존 목록 텍스트로 남긴다',()=>{
  for(const input of ['|','||','| --- |','--- | ---','| :--: | --- |','| \\|']) {
    const html=formatMessage(input+'\n다음 문장');
    assert.doesNotMatch(html,/<table\b/);
    assert.ok(html.endsWith('<br>다음 문장</p>'));
  }
  const html=formatMessage('- 문의 자료\n  지역 | 기관\n  --- | ---\n  제주시 | 1\n\n번호 | 항목\n--- | ---\n1 | 후속 확인');
  assert.ok(html.startsWith('<ul><li>문의 자료<br>지역 | 기관<br>--- | ---<br>제주시 | 1</li></ul>'));
  assert.equal((html.match(/<table /g)||[]).length,1);
});

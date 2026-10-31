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

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function inline(text) {
  const token = /\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)/g;
  let html = '', cursor = 0;
  for (const match of text.matchAll(token)) {
    html += escapeHtml(text.slice(cursor,match.index));
    if (match[1] !== undefined) html += `<strong>${escapeHtml(match[1])}</strong>`;
    else {
      let url;
      try {
        const parsed = new URL(match[3]);
        if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && !/[\u0000-\u0020\u007f]/.test(match[3])) url = parsed.href;
      } catch { /* 잘못된 링크도 원문을 안전하게 읽을 수 있게 남긴다. */ }
      html += url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[2])}</a>` : escapeHtml(match[0]);
    }
    cursor = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(cursor));
}

function listItem(line) {
  const match = /^(\s*)([-+*]|\d{1,4}[.)])\s+(.+)$/.exec(line);
  return match ? {indent:match[1].replace(/\t/g,'  ').length,type:/\d/.test(match[2])?'ol':'ul',start:parseInt(match[2],10),text:match[3]} : null;
}

function headingItem(line) {
  const match = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  return match && match[2].trim() ? {level:Math.min(6,match[1].length+2),text:match[2]} : null;
}

const MAX_TABLE_COLUMNS = 8;
const MAX_TABLE_ROWS = 40;

function tableCells(line) {
  // 최상위 표만 지원한다. 홀수 개의 역슬래시 뒤의 pipe는 셀 내용으로 남긴다.
  if (!/^ {0,3}\S/.test(line)) return null;
  const text = line.trim(), cells = [];
  let cell = '', slashes = 0, separators = 0;
  for (const char of text) {
    if (char === '|' && slashes % 2 === 0) {
      cells.push(cell.trim());cell = '';separators++;
    } else if (char === '|') cell = cell.slice(0,-1) + '|';
    else cell += char;
    slashes = char === '\\' ? slashes + 1 : 0;
  }
  cells.push(cell.trim());
  if (!separators) return null;
  if (text.startsWith('|')) cells.shift();
  if (cells.at(-1) === '' && text.endsWith('|')) cells.pop();
  return cells.length ? cells : null;
}

function tableItem(lines,start) {
  if (headingItem(lines[start]) || listItem(lines[start])) return null;
  const markers = tableCells(lines[start+1] || '');
  if (!markers || markers.some(cell => !/^:?-{3,}:?$/.test(cell))) return null;
  const headers = tableCells(lines[start]);
  if (!headers) return null;
  let valid = headers.length === markers.length && headers.length <= MAX_TABLE_COLUMNS && headers.some(Boolean);
  const alignments = markers.map(cell => cell.endsWith(':') ? cell.startsWith(':') ? 'center' : 'right' : 'left');
  const rows = [];
  let next = start+2, rowCount = 0;
  while (next < lines.length && lines[next].trim() && !headingItem(lines[next]) && !listItem(lines[next])) {
    const cells = tableCells(lines[next]);
    if (!cells) break;
    rowCount++;
    if (cells.length !== headers.length || rowCount > MAX_TABLE_ROWS) valid = false;
    if (valid) rows.push(cells);
    next++;
  }
  // 깨진/초과한 표의 뒤쪽 구분선을 새 표로 해석하지 않도록 같은 범위를 소비한다.
  return valid ? {headers,alignments,rows,next} : {raw:true,next};
}

function renderTable(table) {
  const cells = (row,tag) => row.map((text,index) => `<${tag}${tag==='th'?' scope="col"':''} class="message-table-align-${table.alignments[index]}">${inline(text)}</${tag}>`).join('');
  return '<p class="message-table-hint">잘린 열은 표를 좌우로 이동해 확인할 수 있어요.</p>' +
    '<div class="message-table-scroll" role="region" aria-label="표 영역, 넘치는 내용은 좌우 방향키로 이동" tabindex="0"><table aria-label="대화 표">' +
    `<thead><tr>${cells(table.headers,'th')}</tr></thead><tbody>` +
    table.rows.map(row => `<tr>${cells(row,'td')}</tr>`).join('') + '</tbody></table></div>';
}

function renderList(lines,start) {
  const first = listItem(lines[start]);
  let index = start, html = `<${first.type}${first.type==='ol' && first.start!==1?` start="${first.start}"`:''}>`;
  while (index < lines.length) {
    const item = listItem(lines[index]);
    if (!item || item.indent!==first.indent || item.type!==first.type) break;
    html += `<li>${inline(item.text)}`;
    index++;
    while (index < lines.length) {
      const child = listItem(lines[index]);
      if (child && child.indent>first.indent) {
        const nested = renderList(lines,index);html += nested.html;index = nested.next;
      } else if (!child && lines[index].trim() && /^\s+/.test(lines[index]) && lines[index].length-lines[index].trimStart().length>first.indent) {
        html += `<br>${inline(lines[index].trim())}`;index++;
      } else break;
    }
    html += '</li>';
    if (!lines[index]?.trim() && listItem(lines[index+1] || '')?.indent===first.indent) index++;
  }
  return {html:html+`</${first.type}>`,next:index};
}

/**
 * 모델의 작은 Markdown 부분집합만 표시하며 원문 HTML은 항상 이스케이프한다.
 * 표는 최상위 머리글+3개 이상 hyphen 구분선, 선택적 바깥 pipe, \|, 열 정렬을 지원한다.
 * 최대 8열·본문 40행이며 모든 행의 열 수가 같아야 한다. 초과/깨진 표는 원문으로 남긴다.
 * 병합 셀·블록/중첩 표·코드 문법 등 전체 GFM은 지원하지 않는다.
 */
export function formatMessage(value) {
  const lines = String(value ?? '').replace(/\r\n?/g,'\n').split('\n');
  let html = '', index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {index++;continue;}
    const heading = headingItem(line);
    if (heading) {
      html += `<h${heading.level}>${inline(heading.text)}</h${heading.level}>`;index++;continue;
    }
    if (listItem(line)) {const list=renderList(lines,index);html+=list.html;index=list.next;continue;}
    const table = tableItem(lines,index);
    if (table) {
      html += table.raw ? `<p>${lines.slice(index,table.next).map(inline).join('<br>')}</p>` : renderTable(table);
      index=table.next;continue;
    }
    // 문단도 첫 줄을 반드시 소비하고, 제목 분기와 같은 조건으로 다음 줄을 판별한다.
    const paragraph = [inline(lines[index++])];
    while (index<lines.length && lines[index].trim() && !listItem(lines[index]) && !headingItem(lines[index]) && !tableItem(lines,index)) paragraph.push(inline(lines[index++]));
    html += `<p>${paragraph.join('<br>')}</p>`;
  }
  return html;
}

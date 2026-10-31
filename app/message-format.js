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

/** 모델의 작은 Markdown 부분집합만 표시한다. 원문 HTML은 항상 문자로 이스케이프한다. */
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
    // 문단도 첫 줄을 반드시 소비하고, 제목 분기와 같은 조건으로 다음 줄을 판별한다.
    const paragraph = [inline(lines[index++])];
    while (index<lines.length && lines[index].trim() && !listItem(lines[index]) && !headingItem(lines[index])) paragraph.push(inline(lines[index++]));
    html += `<p>${paragraph.join('<br>')}</p>`;
  }
  return html;
}

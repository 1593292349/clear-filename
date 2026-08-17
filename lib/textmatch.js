// 文本匹配工具：收集匹配片段，供大文本文件来源复用
// 必须克隆带 g 的正则（原 re 无 g 时 exec 会死循环），并限制匹配数量防止内存膨胀

function matchAll(text, re, max = 50, half = 60) {
  const g = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g');
  const hits = [];
  let m;
  while (hits.length < max && (m = g.exec(text)) !== null) {
    const start = Math.max(0, m.index - half);
    const end = Math.min(text.length, m.index + half);
    hits.push(text.slice(start, end).replace(/\s+/g, ' '));
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return hits;
}

module.exports = { matchAll };

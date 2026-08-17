// 应用层最近记录：VSCode（storage.json / state.vscdb）、Notepad++（session/config）
// 均为文本或可宽松解码的二进制，直接按正则匹配内容片段；
// 删除粒度是编辑应用配置文件，风险高，标记为手动处理。
const fs = require('fs');
const os = require('os');
const path = require('path');

const FILES = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'storage.json'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Code', 'User', 'globalStorage', 'state.vscdb'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Notepad++', 'session.xml'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Notepad++', 'config.xml'),
];

function decodeContent(data) {
  // 先按 UTF-8 宽松解码；若含 NUL 再按 UTF-16 宽松解码
  let s = data.toString('utf8');
  if (s.includes('\u0000')) {
    s = data.toString('utf16le', 0, Math.floor(data.length / 2) * 2).replace(/\u0000+/g, '');
  }
  return s;
}

function contextAround(text, idx, half = 60) {
  const start = Math.max(0, idx - half);
  const end = Math.min(text.length, idx + half);
  return text.slice(start, end).replace(/\s+/g, ' ');
}

// 收集匹配片段：克隆带 g 的正则（原 re 无 g 时 exec 会死循环），限制数量
function matchAll(text, re, max = 50) {
  const g = new RegExp(re.source, re.flags.includes('i') ? 'gi' : 'g');
  const hits = [];
  let m;
  while (hits.length < max && (m = g.exec(text)) !== null) {
    hits.push(contextAround(text, m.index));
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  return hits;
}

function search(re) {
  const out = [];
  for (const fp of FILES) {
    if (!fs.existsSync(fp)) continue;
    let text;
    try {
      text = decodeContent(fs.readFileSync(fp));
    } catch {
      continue;
    }
    const hits = matchAll(text, re);
    if (!hits.length) continue;
    out.push({
      source: 'appmru',
      kind: 'appmru',
      name: path.basename(fp),
      location: fp,
      match: hits.join(' … '),
      deletable: false,
      deleteHint: '应用配置文件，需手动编辑删除对应条目（工具不自动改写，避免破坏配置）',
    });
  }
  return out;
}

module.exports = { search };

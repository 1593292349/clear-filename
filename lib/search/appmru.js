// 应用层最近记录：VSCode（storage.json / state.vscdb）、Notepad++（session/config）
// 均为文本或可宽松解码的二进制，直接按正则匹配内容片段；
// 删除粒度是编辑应用配置文件，风险高，标记为手动处理。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchAll } = require('../textmatch');

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

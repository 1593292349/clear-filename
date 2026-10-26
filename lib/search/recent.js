// 最近使用记录：Recent 目录下的 .lnk 快捷方式
// 匹配 .lnk 文件名（不含 .lnk 后缀也参与匹配，因为文件名即痕迹）；
// 顺带从 .lnk 二进制中提取目标路径用于展示。
const fs = require('fs');
const os = require('os');
const path = require('path');
const jumplist = require('./jumplist');

const RECENT_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Recent');

// 从 .lnk 二进制中宽松提取 UTF-16 字符串片段（目标路径等）
function extractUtf16Strings(data) {
  const s = data.toString('utf16le', 0, Math.floor(data.length / 2) * 2)
    .replace(/\u0000+/g, '\n');
  return s.split('\n').filter((x) => x.length >= 4);
}

function search(re) {
  const out = [];
  let files;
  try {
    files = fs.readdirSync(RECENT_DIR, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith('.lnk')) continue;
    if (!re.test(f.name)) continue;
    const fp = path.join(RECENT_DIR, f.name);
    let target = '';
    try {
      const data = fs.readFileSync(fp);
      const frags = extractUtf16Strings(data);
      // 优先找含 \ 的完整路径片段，并清洗尾部控制字符/反引号
      target = frags.find((x) => x.includes('\\') && x.includes(':')) || '';
      target = target.replace(/^[`\u0000-\u001f\u007f]+/, '').replace(/[`\u0000-\u001f\u007f]+$/, '');
    } catch { /* 读不到就只展示文件名 */ }
    out.push({
      source: 'recent',
      kind: 'lnk',
      name: f.name,
      location: fp,
      match: f.name,
      deletable: true,
      deleteHint: '删除最近使用快捷方式（.lnk），不影响目标文件',
      extra: { target },
    });
  }
  // 合并跳转列表（同属 Recent 目录的历史记录）
  for (const it of jumplist.search(re)) out.push({ ...it, source: 'recent' });
  return out;
}

module.exports = { search };

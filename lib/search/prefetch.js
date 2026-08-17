// Prefetch 预读取：C:\Windows\Prefetch\*.pf
// .pf 文件名本身是"可执行名-哈希.pf"，且文件内嵌 UTF-16 字符串（加载的文件路径）。
// 仅当目标是 .exe 且被执行过才会命中；删除可能需要管理员权限。
const fs = require('fs');
const path = require('path');

const PF_DIR = 'C:\\Windows\\Prefetch';

function search(re) {
  const out = [];
  let files;
  try {
    files = fs.readdirSync(PF_DIR, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const f of files) {
    if (!f.isFile() || !f.name.toLowerCase().endsWith('.pf')) continue;
    const fp = path.join(PF_DIR, f.name);
    const nameMatch = re.test(f.name);
    let fragHits = [];
    try {
      const data = fs.readFileSync(fp);
      const s = data.toString('utf16le', 0, Math.floor(data.length / 2) * 2)
        .replace(/\u0000+/g, '\n');
      fragHits = s.split('\n').filter((x) => x.length >= 5 && re.test(x));
    } catch { /* 读取失败则只按文件名匹配 */ }
    if (!nameMatch && !fragHits.length) continue;
    out.push({
      source: 'prefetch',
      kind: 'file',
      name: f.name,
      location: fp,
      match: nameMatch ? f.name : fragHits.join(' | '),
      deletable: true,
      deleteHint: '删除 Prefetch 记录文件（可能需要管理员权限）',
    });
  }
  return out;
}

module.exports = { search };

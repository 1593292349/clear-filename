// JetBrains IDE 最近记录（WebStorm/IDEA/GoLand 等）：
// %APPDATA%\JetBrains 与 %LOCALAPPDATA%\JetBrains 下的 XML 配置（recentProjects.xml 等）
// 递归扫描 xml 文件内容匹配正则；配置文件不自动改写，标记手动处理。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchAll } = require('../textmatch');

const ROOTS = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'JetBrains'),
  path.join(os.homedir(), 'AppData', 'Local', 'JetBrains'),
];
const MAX_FILES = 3000;      // 最多扫描的文件数（缓存目录 xml 可能很多）
const MAX_FILE_SIZE = 2 * 1024 * 1024;

function walkXml(dir, re, out, seen) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (seen.count >= MAX_FILES) return;
    const fp = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        walkXml(fp, re, out, seen);
      } else if (e.isFile() && e.name.toLowerCase().endsWith('.xml')) {
        seen.count++;
        const st = fs.statSync(fp);
        if (st.size > MAX_FILE_SIZE) continue;
        const text = fs.readFileSync(fp, 'utf8');
        const hits = matchAll(text, re);
        if (!hits.length) continue;
        out.push({
          source: 'jetbrains',
          kind: 'appmru',
          name: e.name,
          location: fp,
          match: hits.join(' … '),
          deletable: false,
          deleteHint: 'IDE 配置文件，需手动编辑删除对应条目（工具不自动改写）',
        });
      }
    } catch { /* 单个文件失败跳过 */ }
  }
}

function search(re) {
  const out = [];
  const seen = { count: 0 };
  for (const root of ROOTS) {
    if (!fs.existsSync(root)) continue;
    walkXml(root, re, out, seen);
    if (seen.count >= MAX_FILES) break;
  }
  return out;
}

module.exports = { search };

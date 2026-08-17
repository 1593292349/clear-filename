// 跳转列表（Jump List）：AutomaticDestinations / CustomDestinations
// 复合文档内嵌 UTF-16 字符串，按正则匹配片段；
// 删除粒度是整个跳转列表文件（单条记录无法安全剥离）。
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEST_DIRS = [
  path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Recent', 'AutomaticDestinations'),
  path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Recent', 'CustomDestinations'),
];

function extractUtf16Strings(data) {
  const s = data.toString('utf16le', 0, Math.floor(data.length / 2) * 2)
    .replace(/\u0000+/g, '\n');
  return s.split('\n').filter((x) => x.length >= 4);
}

function search(re) {
  const out = [];
  for (const dir of DEST_DIRS) {
    let files;
    try {
      files = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const fn of files) {
      const fp = path.join(dir, fn);
      let data;
      try {
        data = fs.readFileSync(fp);
      } catch {
        continue;
      }
      const hits = extractUtf16Strings(data).filter((x) => re.test(x));
      if (!hits.length) continue;
      out.push({
        source: 'jumplist',
        kind: 'jumplist',
        name: fn,
        location: fp,
        match: hits.join(' | '),
        deletable: true,
        deleteHint: '删除整个跳转列表文件（会清掉该应用的全部最近记录）',
      });
    }
  }
  return out;
}

module.exports = { search };

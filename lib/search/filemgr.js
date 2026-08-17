// Total Commander 历史：%APPDATA%\ghisler\wincmd.ini 中的目录/文件访问历史
// 文本配置文件，按正则匹配内容；不自动改写，标记手动处理。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchAll } = require('../textmatch');

const FILES = [
  { name: 'Total Commander', file: path.join(os.homedir(), 'AppData', 'Roaming', 'ghisler', 'wincmd.ini') },
];

function search(re) {
  const out = [];
  for (const { name, file } of FILES) {
    if (!fs.existsSync(file)) continue;
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    const hits = matchAll(text, re);
    if (!hits.length) continue;
    out.push({
      source: 'filemgr',
      kind: 'appmru',
      name: name + ' 历史',
      location: file,
      match: hits.join(' … '),
      deletable: false,
      deleteHint: '配置文件，需手动编辑删除对应历史条目（工具不自动改写）',
    });
  }
  return out;
}

module.exports = { search };

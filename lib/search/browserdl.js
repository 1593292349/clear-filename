// 浏览器下载历史：Chrome / Edge 的 History（SQLite）文件
// 下载目标路径以 UTF-8 明文存于库文件中，宽松解码后按正则匹配；
// 删除：数据库被浏览器独占且改写风险高，标记手动处理。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchAll } = require('../textmatch');

const HISTORY_FILES = [
  { name: 'Chrome', file: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data', 'Default', 'History') },
  { name: 'Edge', file: path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data', 'Default', 'History') },
];

function search(re) {
  const out = [];
  for (const { name, file } of HISTORY_FILES) {
    if (!fs.existsSync(file)) continue;
    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      continue; // 被浏览器独占锁定时跳过
    }
    const text = data.toString('utf8'); // sqlite 中字符串为 UTF-8
    const hits = matchAll(text, re);
    if (!hits.length) continue;
    out.push({
      source: 'browserdl',
      kind: 'browserdl',
      name: name + ' 下载历史',
      location: file,
      match: hits.join(' … '),
      deletable: false,
      deleteHint: '数据库被浏览器占用且改写有风险，请在浏览器下载管理器中逐条清除记录',
    });
  }
  return out;
}

module.exports = { search };

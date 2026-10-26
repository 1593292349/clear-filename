// 浏览器历史：Chrome / Edge 的 History（SQLite）文件。
// 覆盖 User Data 下所有 Profile（Default / Profile N / Guest Profile），
// 下载目标路径与访问过的 URL 都以 UTF-8 明文存于库文件中，宽松解码后按正则匹配；
// 删除：数据库被浏览器独占且改写风险高，标记手动处理。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { matchAll } = require('../textmatch');

// 枚举各浏览器 User Data 下所有含 History 的 Profile
function listHistoryFiles() {
  const out = [];
  const browsers = [
    { name: 'Chrome', dir: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data') },
    { name: 'Edge', dir: path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data') },
  ];
  for (const b of browsers) {
    let entries;
    try {
      entries = fs.readdirSync(b.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const file = path.join(b.dir, e.name, 'History');
      if (fs.existsSync(file)) out.push({ browser: b.name, profile: e.name, file });
    }
  }
  return out;
}

// History 是 SQLite 二进制，解码后混有控制字符，清洗成可读片段
function clean(s) {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\ufffd]/g, ' ').replace(/\s+/g, ' ').trim();
}

function search(re) {
  const out = [];
  for (const { browser, profile, file } of listHistoryFiles()) {
    let data;
    try {
      data = fs.readFileSync(file);
    } catch {
      continue; // 被浏览器独占锁定时跳过
    }
    const hits = matchAll(data.toString('utf8'), re, 20, 80);
    if (!hits.length) continue;
    out.push({
      source: 'browserdl',
      kind: 'browserdl',
      name: browser + ' · ' + profile,
      location: file,
      match: hits.slice(0, 5).map(clean).join(' … '),
      deletable: false,
      deleteHint: '数据库被浏览器占用且改写有风险，请在浏览器历史/下载管理器中逐条清除记录',
    });
  }
  return out;
}

module.exports = { search };

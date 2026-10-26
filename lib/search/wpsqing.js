// WPS 云同步映射库：%LOCALAPPDATA%\kingsoft\WPS Cloud Files\userdata\qing\qing.db
// SQLite 数据库（文本按 UTF-16LE 存储），记录本地路径与云端路径的映射。
// 从映射表删除的记录可能残留在数据库空闲页里（SQL 查不到），只能扫库发现；
// 清理方式为删除整个库文件（WPS 会重建映射）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stringsFrom, pathRuns, trimPath } = require('../binscan');

const QING = path.join(os.homedir(), 'AppData', 'Local', 'kingsoft', 'WPS Cloud Files', 'userdata', 'qing', 'qing.db');
const MAX = 30;

function clean(s) {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\ufffd]/g, ' ').replace(/\s+/g, ' ').trim();
}

function search(re) {
  let buf;
  try {
    buf = fs.readFileSync(QING);
  } catch {
    return [];
  }
  const out = [];
  const seen = new Set();
  for (const off of [0, 1]) {
    for (const s of stringsFrom(buf, 'utf16le', 4, off)) {
      if (out.length >= MAX || !re.test(s)) continue;
      const runs = pathRuns(s);
      const hitRun = runs.find((x) => re.test(x));
      const shown = runs.length ? trimPath(hitRun || runs[0]) : clean(s).slice(0, 200);
      if (!shown || seen.has(shown)) continue;
      seen.add(shown);
      out.push({
        source: 'wpsqing',
        kind: 'wpsqing',
        name: path.basename(shown) || shown.slice(0, 80),
        location: QING,
        match: shown,
        deletable: true,
        deleteHint: '删除整个 WPS 云同步映射库（WPS 会重建；未同步完的任务可能重新扫描）',
      });
    }
  }
  return out;
}

module.exports = { search, QING };

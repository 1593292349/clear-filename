// Chrome / Edge 下载记录库（shared_proto_db，LevelDB）残留：
// User Data/<Profile>/shared_proto_db/*.log|*.ldb 以 protobuf 保存下载项的完整路径，
// 浏览器里删除下载记录后，LevelDB 仍可能残留字符串（界面不显示，只有扫库才能看到）。
// 字符串多为 UTF-16LE，另做一遍 UTF-8 兜底；清理只能删除库文件。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { stringsFrom, pathRuns, trimPath } = require('../binscan');

const BROWSERS = [
  { name: 'Chrome', dir: path.join(os.homedir(), 'AppData', 'Local', 'Google', 'Chrome', 'User Data') },
  { name: 'Edge', dir: path.join(os.homedir(), 'AppData', 'Local', 'Microsoft', 'Edge', 'User Data') },
];
const MAX_PER_DB = 30;
const MAX_FILE = 100 * 1024 * 1024;

function listDbs() {
  const out = [];
  for (const b of BROWSERS) {
    let profiles;
    try {
      profiles = fs.readdirSync(b.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const p of profiles) {
      if (!p.isDirectory()) continue;
      const dir = path.join(b.dir, p.name, 'shared_proto_db');
      let files;
      try {
        files = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !/\.(log|ldb)$/i.test(f.name)) continue;
        out.push({ browser: b.name, profile: p.name, file: path.join(dir, f.name) });
      }
    }
  }
  return out;
}

function clean(s) {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\ufffd]/g, ' ').replace(/\s+/g, ' ').trim();
}

function search(re) {
  const out = [];
  for (const { browser, profile, file } of listDbs()) {
    let buf;
    try {
      if (fs.statSync(file).size > MAX_FILE) continue;
      buf = fs.readFileSync(file);
    } catch {
      continue; // 被浏览器占用时跳过
    }
    const seen = new Set();
    let count = 0;
    for (const enc of ['utf16le', 'utf8']) {
      const offsets = enc === 'utf16le' ? [0, 1] : [0];
      for (const off of offsets) {
        for (const s of stringsFrom(buf, enc, 4, off)) {
          if (count >= MAX_PER_DB) break;
          if (s.length > 2000 || !re.test(s)) continue;
          const runs = pathRuns(s);
          const hitRun = runs.find((x) => re.test(x));
          const shown = runs.length ? trimPath(hitRun || runs[0]) : clean(s).slice(0, 200);
          if (!shown || seen.has(shown)) continue;
          seen.add(shown);
          out.push({
            source: 'chromedl',
            kind: 'chromedl',
            name: path.basename(shown) || shown.slice(0, 80),
            location: file,
            match: `${browser} · ${profile} · ${shown}`,
            deletable: true,
            deleteHint: '删除整个下载记录库文件（需先关闭浏览器；同一库内其他下载记录会一并清除）',
            extra: { browser, profile },
          });
          count += 1;
        }
      }
    }
  }
  return out;
}

module.exports = { search, listDbs };

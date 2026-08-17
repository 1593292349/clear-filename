// 全盘文件系统扫描：按文件名正则匹配
const fs = require('fs');
const path = require('path');

// 跳过无业务意义/无权限/巨量的目录
const SKIP_DIRS = new Set([
  '$Recycle.Bin', 'System Volume Information', 'WinSxS', 'Recovery',
  'node_modules', '.git', '$RECYCLE.BIN',
]);

function listDrives() {
  const drives = [];
  for (let c = 65; c <= 90; c++) {
    const root = String.fromCharCode(c) + ':\\';
    try {
      if (fs.existsSync(root)) drives.push(root);
    } catch { /* 不可访问的盘符忽略 */ }
  }
  return drives;
}

function scanDrive(root, re, out) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // 无权限等，跳过
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isDirectory()) {
          if (SKIP_DIRS.has(e.name)) continue;
          stack.push(full);
        } else if (e.isFile() && re.test(e.name)) {
          out.push({
            source: 'filesystem',
            kind: 'file',
            name: e.name,
            location: full,
            match: e.name,
            deletable: true,
            deleteHint: '直接删除文件（不可恢复）',
          });
        }
      } catch { /* 继续 */ }
    }
  }
}

async function search(re) {
  const out = [];
  const drives = listDrives();
  await Promise.all(drives.map(async (root) => {
    // 异步化避免阻塞事件循环过久：分块让出
    await new Promise((r) => setImmediate(r));
    scanDrive(root, re, out);
  }));
  return out;
}

module.exports = { search, listDrives };

// 全盘扫描 worker：每个盘一个 worker，多核并行遍历目录树
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

const { root, source, flags } = workerData;
const re = new RegExp(source, flags);

const SKIP_DIRS = new Set([
  '$Recycle.Bin', 'System Volume Information', 'WinSxS', 'Recovery',
  'node_modules', '.git', '$RECYCLE.BIN',
]);

function isRecentDir(full) {
  return full.toLowerCase().includes('\\appdata\\roaming\\microsoft\\windows\\recent');
}

const out = [];
const stack = [root];
while (stack.length) {
  const dir = stack.pop();
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    continue;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    try {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || isRecentDir(full)) continue;
        stack.push(full);
      } else if (e.isFile() && re.test(e.name)) {
        out.push({ name: e.name, location: full });
      }
    } catch { /* 继续 */ }
  }
}

parentPort.postMessage(out);

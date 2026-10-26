// 全盘文件系统扫描：按文件名正则匹配。
// 每个盘交给一个 worker_threads 线程并行遍历，避免单线程串行阻塞事件循环。
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');

const WORKER = path.join(__dirname, '..', 'workers', 'fs-scan.js');

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

// 单个盘在独立线程里扫描，返回该盘的命中项
function scanDrive(root, re) {
  return new Promise((resolve) => {
    let settled = false;
    const w = new Worker(WORKER, {
      workerData: { root, source: re.source, flags: re.flags },
    });
    const finish = (val) => {
      if (settled) return;
      settled = true;
      w.terminate().catch(() => {});
      resolve(val);
    };
    w.on('message', finish);
    w.on('error', () => finish([]));
    w.on('exit', (code) => {
      if (code !== 0) finish([]);
    });
  });
}

async function search(re) {
  const drives = listDrives();
  const groups = await Promise.all(drives.map((root) => scanDrive(root, re)));
  const out = [];
  for (const list of groups) {
    for (const it of list) {
      out.push({
        source: 'filesystem',
        kind: 'file',
        name: it.name,
        location: it.location,
        match: it.name,
        deletable: true,
        deleteHint: '直接删除文件（不可恢复）',
      });
    }
  }
  return out;
}

module.exports = { search, listDrives };

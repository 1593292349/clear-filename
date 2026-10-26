// USN Journal 痕迹：NTFS 变更日志逐条记录文件操作的名称/原因/时间（创建、删除、改名等）
// 读取需管理员权限（fsutil 普通用户返回 Access denied）；记录无法单条删除，只能整体清空
const { spawn } = require('child_process');
const { listDrives } = require('./filesystem');

// fsutil 的 CSV 行：字段可能含逗号并用双引号包裹，引号内以双写转义
function parseCsv(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      let s = '';
      i += 1;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') { s += '"'; i += 2; continue; }
          i += 1;
          break;
        }
        s += line[i];
        i += 1;
      }
      out.push(s);
      if (line[i] === ',') i += 1;
    } else {
      const j = line.indexOf(',', i);
      if (j < 0) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, j));
      i = j + 1;
    }
  }
  return out;
}

// 逐行流式读取单个磁盘的 USN 日志，避免把整份 CSV（可达数百 MB）读进内存
function readDrive(drive, re, out) {
  return new Promise((resolve, reject) => {
    // listDrives 返回 'C:\'，fsutil 只接受 'C:'，带上反斜杠会报 Error 3
    const vol = drive.replace(/\\+$/, '');
    const child = spawn('cmd.exe', ['/c', 'chcp 65001 >nul & fsutil usn readjournal ' + vol + ' csv'], { windowsHide: true });
    let buf = '';
    let errText = '';
    let lastOut = '';
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      try { child.kill(); } catch { /* 已退出 */ }
      if (err) reject(err); else resolve();
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, '');
        buf = buf.slice(idx + 1);
        if (!line) continue;
        lastOut = line;
        const f = parseCsv(line);
        if (f.length < 10) continue;
        const name = f[1];
        if (!name || !re.test(name)) continue;
        out.push({
          source: 'usn',
          kind: 'usn',
          name,
          location: drive + ' USN Journal | USN ' + f[0] + ' | FileId ' + f[8],
          match: (f[4] || '') + ' | ' + (f[5] || ''),
          deletable: false,
          deleteHint: 'USN 记录无法单条删除；清空整个日志请用系统操作"清空 USN Journal"（需管理员）',
          extra: {
            drive,
            usn: f[0],
            reason: f[3],
            reasonText: f[4],
            time: f[5],
            fileId: f[8],
            parentFileId: f[9],
          },
        });
      }
    });
    child.stderr.on('data', (d) => { errText += d.toString(); });
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      if (code !== 0) {
        const msg = (errText || lastOut || ('fsutil 退出码 ' + code)).trim();
        // 该卷从未启用或已清空 USN 日志时 fsutil 返回 Error 1179，视为无记录
        if (/1179|not active|未激活/i.test(msg)) { finish(); return; }
        finish(new Error(msg.slice(0, 200)));
      } else finish();
    });
  });
}

async function search(re) {
  const drives = listDrives();
  const out = [];
  const errors = [];
  for (const d of drives) {
    try {
      await readDrive(d, re, out);
    } catch (e) {
      errors.push(d + ' ' + e.message);
    }
  }
  if (!out.length && errors.length) {
    return [{
      source: 'usn',
      kind: 'error',
      name: 'USN Journal 不可读',
      location: 'NTFS 变更日志',
      match: '',
      deletable: false,
      deleteHint: errors.join('; ').slice(0, 150) + '（读取 USN Journal 需要管理员权限，请以管理员身份运行本服务）',
    }];
  }
  return out;
}

module.exports = { search, parseCsv };

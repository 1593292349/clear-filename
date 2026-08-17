// 系统级清理操作：清空 USN Journal、删除卷影副本、覆盖磁盘空闲空间
// 均需管理员权限；输出经 chcp 65001 转 UTF-8 后返回
const { execFile } = require('child_process');

function runCmd(cmdline, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      'cmd.exe',
      ['/c', 'chcp 65001 >nul & ' + cmdline],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout, stderr) => {
        if (err) {
          const msg = (stderr || stdout || '').trim() || err.message;
          reject(new Error(msg.slice(0, 2000) || '执行失败（可能拒绝访问）'));
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}

async function runSystem(op, drive) {
  const d = (drive || 'C:').replace(/:$/, '') + ':';
  switch (op) {
    case 'usn':
      // 清空 NTFS 变更日志（Everything 等工具的数据源）；清后需全量重建索引
      return runCmd('fsutil usn deletejournal /d ' + d, 60000);
    case 'vss':
      // 删除卷影副本（还原点/备份快照中的旧文件）
      return runCmd('vssadmin delete shadows /for=' + d + ' /all /quiet', 60000);
    case 'cipher':
      // 覆盖磁盘空闲空间，擦除已删除文件的数据残留（极耗时，按盘大小可达数小时）
      return runCmd('cipher /w:' + d + '\\', 600000);
    case 'eventlog':
      // 清空安全事件日志（含全部文件系统审计记录）
      return runCmd('wevtutil cl Security', 60000);
    default:
      throw new Error('未知操作: ' + op);
  }
}

module.exports = { runSystem };

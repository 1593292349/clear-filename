// 系统级清理操作：清空 USN Journal、删除卷影副本、覆盖磁盘空闲空间、清空事件日志、清理 WPS 最近列表
// 除 WPS 列表（当前用户数据）外均需管理员权限；输出经 chcp 65001 转 UTF-8 后返回
const { execFile } = require('child_process');
const { invalidateCache } = require('./search/registry_full');

// WPS 表格的最近使用文件列表；HKCU 与 HKU\<当前用户 SID> 是同一个键，删一次即可
const WPS_RECENT_KEY = 'HKCU\\Software\\kingsoft\\Office\\6.0\\et\\RecentFiles';

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
      // 日志本就不存在时 fsutil 返回 Error 1179，视为已是清空状态
      return runCmd('fsutil usn deletejournal /d ' + d, 60000).catch((e) => {
        if (/1179|not active|未激活/i.test(e.message)) return 'USN Journal 不存在（已是清空状态）';
        throw e;
      });
    case 'vss':
      // 删除卷影副本（还原点/备份快照中的旧文件）
      return runCmd('vssadmin delete shadows /for=' + d + ' /all /quiet', 60000);
    case 'cipher':
      // 覆盖磁盘空闲空间，擦除已删除文件的数据残留（极耗时，按盘大小可达数小时）
      return runCmd('cipher /w:' + d + '\\', 600000);
    case 'eventlog':
      // 清空安全事件日志（含全部文件系统审计记录）
      return runCmd('wevtutil cl Security', 60000);
    case 'wpsrecent': {
      // 整键删除 WPS 表格的最近使用文件列表（连同 files / files_bak / Sequence 子键）。
      // 注意 reg delete 删「含子键的键」时会误报 unable to find 且退出码为 1（实测键已删除），
      // 所以成败以删除后的 reg query 复核为准；删除后清空导出缓存，否则 5 分钟内搜索仍命中已删条目。
      const verifyGone = () =>
        runCmd('reg query "' + WPS_RECENT_KEY + '"', 30000).then(
          (out) => {
            throw new Error('删除后键仍存在: ' + out.trim().slice(0, 300));
          },
          (e) => {
            if (!/unable to find|找不到/i.test(e.message)) throw new Error('复核注册表失败: ' + e.message);
            invalidateCache();
            return 'WPS 最近使用文件列表已删除（注册表中已无该键）';
          }
        );
      return runCmd('reg delete "' + WPS_RECENT_KEY + '" /f', 60000).then(verifyGone, verifyGone);
    }
    default:
      throw new Error('未知操作: ' + op);
  }
}

module.exports = { runSystem };

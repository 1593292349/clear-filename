// Amcache：程序兼容性缓存（注册表 hive 文件），记录 exe 的完整路径与文件名。
// 直接以二进制读取 hive，按 UTF-16LE 解码扫描（注册表字符串均为 UTF-16），不加载 hive。
// 读取需要管理员权限；删除需清理整个 hive，标记手动处理。
const fs = require('fs');
const { matchAll } = require('../textmatch');

const HIVE = 'C:\\Windows\\AppCompat\\Programs\\Amcache.hve';

// hive 是二进制结构，UTF-16 解码后大量伪字符，只保留 ASCII 可打印 + 中文 + 路径符号
function clean(s) {
  return s.replace(/[^\x20-\x7E\u4e00-\u9fff\\/:._\-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function search(re) {
  const out = [];
  let data;
  try {
    data = fs.readFileSync(HIVE);
  } catch (e) {
    if (e && (e.code === 'EPERM' || e.code === 'EACCES')) {
      return [{
        source: 'amcache',
        kind: 'error',
        name: 'Amcache',
        location: HIVE,
        match: '',
        deletable: false,
        deleteHint: '读取 Amcache 需要管理员权限，请以管理员身份启动本服务后重试',
      }];
    }
    return out;
  }
  if (!data.length) return out;
  const hits = matchAll(data.toString('utf16le'), re, 20, 80);
  if (!hits.length) return out;
  out.push({
    source: 'amcache',
    kind: 'amcache',
    name: 'Amcache.hve',
    location: HIVE,
    match: hits.slice(0, 5).map(clean).join(' … '),
    deletable: false,
    deleteHint: 'Amcache 为系统程序缓存，无法按条目删除；如需清理需整体重置该 hive（需管理员）',
  });
  return out;
}

module.exports = { search };

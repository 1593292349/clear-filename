// 回收站记录：解析 $I 文件中的原始文件名，配对 $R 数据文件
const fs = require('fs');
const path = require('path');
const { listDrives } = require('./filesystem');

function parseRecycleBin(re) {
  const out = [];
  for (const drive of listDrives()) {
    const rb = path.join(drive, '$Recycle.Bin');
    let sids;
    try {
      sids = fs.readdirSync(rb, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sid of sids) {
      if (!sid.isDirectory()) continue;
      const dir = path.join(rb, sid.name);
      let files;
      try {
        files = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile() || !f.name.startsWith('$I')) continue;
        const ip = path.join(dir, f.name);
        let data;
        try {
          data = fs.readFileSync(ip);
        } catch {
          continue;
        }
        // $I 结构：8B 版本 + 8B 大小 + 8B 删除时间 + 原始文件名(UTF-16, ≤260 字符)
        const name = data.toString('utf16le', 24, 24 + 520).split('\0')[0];
        if (!name || !re.test(name)) continue;
        const rPath = path.join(dir, '$R' + f.name.slice(2));
        const rExists = fs.existsSync(rPath);
        out.push({
          source: 'recyclebin',
          kind: 'recycle',
          name,
          location: ip,
          match: name,
          deletable: true,
          deleteHint: rExists
            ? '从回收站永久删除（$I 索引 + $R 数据一并删除）'
            : '删除回收站索引记录 $I（对应 $R 数据已不存在）',
          extra: { dataPath: rExists ? rPath : null },
        });
      }
    }
  }
  return out;
}

module.exports = { search: parseRecycleBin };

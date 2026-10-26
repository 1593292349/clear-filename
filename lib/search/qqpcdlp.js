// 腾讯电脑管家文件扫描记录：C:\ProgramData\Tencent\QQPCMgr\QMDLPList.xml
// DLPList 保存扫描过的文件完整路径（含 MD5 / 时间 / 威胁类型），文件删除后记录仍保留。
// 清理方式：从 XML 中移除对应的 <DLPElement> 块（需先退出电脑管家，否则其保存时会重写）。
const fs = require('fs');
const path = require('path');

const LIST = 'C:\\ProgramData\\Tencent\\QQPCMgr\\QMDLPList.xml';
const PATH_ATTR = /<File path="([^"]*)"/;
const TIME_ATTR = /<File\b[^>]*\bTime="([^"]*)"/;

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function search(re) {
  let xml;
  try {
    xml = fs.readFileSync(LIST, 'utf8');
  } catch {
    return []; // 未安装电脑管家或文件不可读
  }
  const block = /<DLPElement\b[^>]*>[\s\S]*?<\/DLPElement>/g;
  const out = [];
  const counts = new Map();
  let m;
  while ((m = block.exec(xml))) {
    const p = PATH_ATTR.exec(m[0]);
    if (!p) continue;
    const file = decodeXml(p[1]);
    if (!re.test(file)) continue;
    counts.set(file, (counts.get(file) || 0) + 1);
    if (out.some((x) => x.location === file)) continue; // 同一路径的多次扫描只列一条
    const t = TIME_ATTR.exec(m[0]);
    out.push({
      source: 'qqpcdlp',
      kind: 'qqpcdlp',
      name: path.basename(file),
      location: file,
      match: (t ? '扫描时间 ' + t[1] + ' · ' : '') + file,
      deletable: true,
      deleteHint: '从电脑管家文件扫描记录移除该条（同一路径的多条记录一并移除；需先退出电脑管家）',
      extra: { listFile: LIST },
    });
  }
  for (const it of out) {
    const n = counts.get(it.location);
    if (n > 1) it.match = '共 ' + n + ' 条扫描记录 · ' + it.match;
  }
  return out;
}

module.exports = { search, decodeXml, LIST };

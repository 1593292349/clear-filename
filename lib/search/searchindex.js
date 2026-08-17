// Windows 搜索索引（SYSTEMINDEX）：从正则提取最长字面片段做 LIKE 预筛，
// 结果再经 JS 正则二次确认（LIKE 只支持子串匹配）。
const path = require('path');
const { psScript } = require('../ps');

// 提取正则源码中最长的连续字面字符序列（用于 LIKE 预筛）
function longestLiteral(re) {
  const src = re.source;
  let best = '', cur = '';
  for (let i = 0; i < src.length; i++) {
    if (/[\\\.\*\?\+\(\)\[\]\{\}\|\^\$]/.test(src[i])) {
      if (cur.length > best.length) best = cur;
      cur = '';
    } else {
      cur += src[i];
    }
  }
  if (cur.length > best.length) best = cur;
  return best;
}

// LIKE 通配符转义：% _ [ 用方括号字面化
function escapeLike(s) {
  return s.replace(/[%_\[\]]/g, (m) => '[' + m + ']');
}

function parseJsonSafe(s) {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return []; }
}

async function search(re) {
  const lit = longestLiteral(re);
  if (!lit) return []; // 纯元字符正则无法预筛，跳过索引源
  const esc = escapeLike(lit);
  const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows'")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT System.ItemPathDisplay FROM SYSTEMINDEX WHERE System.FileName LIKE '%${esc}%'"
$r = $cmd.ExecuteReader()
$out = @()
while ($r.Read()) { $out += $r.GetValue(0).ToString() }
$conn.Close()
if ($out.Count -eq 0) { '[]' } else { $out | ConvertTo-Json -Compress }
`;
  const raw = await psScript(script, 60000);
  const rows = parseJsonSafe(raw);
  const out = [];
  rows.forEach((full, i) => {
    const base = path.basename(full);
    if (!re.test(base)) return;
    out.push({
      source: 'searchindex',
      kind: 'index',
      name: base,
      location: full,
      match: base,
      deletable: false,
      deleteHint: '索引条目随文件删除自动清除，无法直接删除；如残留可重建索引（设置→搜索→索引选项→高级→重建）',
    });
  });
  return out;
}

module.exports = { search };

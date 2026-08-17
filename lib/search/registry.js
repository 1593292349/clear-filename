// 注册表 MRU 痕迹：RecentDocs（最近访问）、WordWheelQuery（资源管理器搜索历史）、
// RunMRU（运行历史）、Notepad（记事本最近文件）
const { psScript } = require('../ps');

const SCRIPT = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$results = @()
function Add-Hit($regPath, $valueName, $text) {
  $script:results += [PSCustomObject]@{ RegPath = $regPath; Name = $valueName; Text = $text }
}
$targets = @(
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RecentDocs',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\WordWheelQuery',
  'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\RunMRU',
  'HKCU:\\Software\\Microsoft\\Notepad'
)
foreach ($t in $targets) {
  if (-not (Test-Path $t)) { continue }
  Get-ChildItem $t -Recurse | ForEach-Object {
    $k = $_
    $k.GetValueNames() | ForEach-Object {
      $vn = $_
      $v = $k.GetValue($vn)
      if ($v -is [byte[]]) {
        $text = [System.Text.Encoding]::Unicode.GetString($v) -replace "\\x00", "\`n"
        if ($text.Length -gt 2000) { $text = $text.Substring(0, 2000) }
        Add-Hit $k.Name $vn $text
      } elseif ($v -is [string]) {
        Add-Hit $k.Name $vn $v
      }
    }
  }
}
if ($results.Count -eq 0) { '[]' } else { $results | ConvertTo-Json -Compress }
`;

function parseJsonSafe(s) {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return []; }
}

async function search(re) {
  const raw = await psScript(SCRIPT);
  const rows = parseJsonSafe(raw);
  const out = [];
  rows.forEach((r, i) => {
    const text = String(r.Text || '');
    const fragments = text.split('\n').filter((x) => x.length >= 2);
    const matched = fragments.filter((x) => re.test(x));
    if (!matched.length) return;
    out.push({
      source: 'registry',
      kind: 'registry',
      name: r.Name,
      location: r.RegPath,
      match: matched.join(' | '),
      deletable: true,
      deleteHint: '删除注册表值（含 MRUListEx 排序表同步清理）',
      extra: { regPath: r.RegPath, valueName: String(r.Name) },
    });
  });
  return out;
}

module.exports = { search };

// 注册表扩展痕迹：打开/保存对话框 MRU、地址栏历史、WPS 最近文档、
// Office 最近文档、压缩软件历史（WinRAR/7-Zip）
// 一次 PowerShell 递归枚举所有根键的值（二进制按 UTF-16 提取），Node 端正则过滤
const { psScript } = require('../ps');

const SCRIPT = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$results = @()
$script:done = $false
$maxText = 500
$maxPerRoot = 500
$roots = @(
  @{ L = '打开/保存对话框'; K = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\ComDlg32' },
  @{ L = '地址栏历史'; K = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\TypedPaths' },
  @{ L = 'WPS 最近文档'; K = 'HKCU:\\Software\\Kingsoft' },
  @{ L = 'Office 最近文档'; K = 'HKCU:\\Software\\Microsoft\\Office' },
  @{ L = '压缩软件历史'; K = 'HKCU:\\Software\\WinRAR' },
  @{ L = '7-Zip 历史'; K = 'HKCU:\\Software\\7-Zip' },
  @{ L = '微信/QQ'; K = 'HKCU:\\Software\\Tencent' },
  @{ L = '迅雷'; K = 'HKCU:\\Software\\Thunder Network' },
  @{ L = 'IDM'; K = 'HKCU:\\Software\\DownloadManager' },
  @{ L = 'Bandizip'; K = 'HKCU:\\Software\\Bandizip' },
  @{ L = 'PotPlayer'; K = 'HKCU:\\Software\\Daum' },
  @{ L = 'UltraEdit'; K = 'HKCU:\\Software\\IDM Computer Solutions' },
  @{ L = 'Foxit'; K = 'HKCU:\\Software\\Foxit Software' },
  @{ L = 'Adobe'; K = 'HKCU:\\Software\\Adobe' },
  @{ L = 'HoneyView'; K = 'HKCU:\\Software\\HoneyView' },
  @{ L = 'XnView'; K = 'HKCU:\\Software\\XnView' },
  @{ L = 'ACDSee'; K = 'HKCU:\\Software\\ACD Systems' },
  @{ L = '暴风影音'; K = 'HKCU:\\Software\\StormPlayer' }
)
foreach ($root in $roots) {
  if ($script:done -or -not (Test-Path $root.K)) { continue }
  $script:rootCount = 0
  Get-ChildItem $root.K -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
    if ($script:done -or $script:rootCount -ge $maxPerRoot) { return }
    $k = $_
    $k.GetValueNames() | ForEach-Object {
      if ($script:done -or $script:rootCount -ge $maxPerRoot) { return }
      $vn = $_
      $v = $k.GetValue($vn)
      if ($v -is [byte[]]) {
        $text = [System.Text.Encoding]::Unicode.GetString($v) -replace "\\x00", "\`n"
        if ($text.Length -gt $maxText) { $text = $text.Substring(0, $maxText) }
        $script:results += [PSCustomObject]@{ L = $root.L; P = $k.Name; N = $vn; T = $text }
      } elseif ($v -is [string]) {
        $t = $v
        if ($t.Length -gt $maxText) { $t = $t.Substring(0, $maxText) }
        $script:results += [PSCustomObject]@{ L = $root.L; P = $k.Name; N = $vn; T = $t }
      }
      $script:rootCount++
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
  const raw = await psScript(SCRIPT, 180000);
  const rows = parseJsonSafe(raw);
  const out = [];
  rows.forEach((r, i) => {
    const text = String(r.T || '');
    const fragments = text.split('\n').filter((x) => x.length >= 2);
    const matched = fragments.filter((x) => re.test(x));
    if (!matched.length) return;
    out.push({
      source: 'registry_extra',
      kind: 'registry',
      name: r.N,
      location: (r.L || '注册表') + ' | ' + r.P,
      match: matched.join(' | '),
      deletable: true,
      deleteHint: '删除注册表值（' + (r.L || '') + '）',
      extra: { regPath: r.P, valueName: String(r.N) },
    });
  });
  return out;
}

module.exports = { search };

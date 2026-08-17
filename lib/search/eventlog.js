// 事件日志痕迹：
// - Security 日志：文件系统审计事件 4656（请求句柄）、4660（对象删除）、4663（访问对象），ObjectName 含完整路径
// - Application 日志：崩溃/错误事件（Event 1000 等）的消息文本常含程序路径
// 默认未开启审计时 Security 无记录；读取 Security 需管理员权限；记录无法单条删除。
const { psScript } = require('../ps');
const { matchAll } = require('../textmatch');

const SCRIPT = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$out = @()
$secErr = $null
$appErr = $null
try {
  $sec = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4656,4660,4663 } -MaxEvents 2000 -ErrorAction Stop
  foreach ($e in $sec) {
    try {
      $xml = [xml]$e.ToXml()
      $data = @{}
      $xml.Event.EventData.Data | ForEach-Object { $data[$_.Name] = $_.'#text' }
      $obj = $data['ObjectName']
      if ($obj) {
        $out += [PSCustomObject]@{ Log = 'Security'; Id = $e.Id; Time = $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'); Text = $obj; User = $data['SubjectUserName'] }
      }
    } catch { }
  }
} catch { $secErr = $_.Exception.Message }
try {
  $app = Get-WinEvent -FilterHashtable @{ LogName = 'Application' } -MaxEvents 3000 -ErrorAction Stop
  foreach ($e in $app) {
    try {
      $t = $e.Message
      if ($t) {
        if ($t.Length -gt 500) { $t = $t.Substring(0, 500) }
        $out += [PSCustomObject]@{ Log = 'Application'; Id = $e.Id; Time = $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'); Text = $t -replace "\\r\\n", ' | '; User = '' }
      }
    } catch { }
  }
} catch { $appErr = $_.Exception.Message }
if ($out.Count -eq 0) {
  $denied = ($secErr -and $secErr -notmatch 'No events|找不到|does not exist') -or
            ($appErr -and $appErr -notmatch 'No events|找不到|does not exist')
  if ($denied) { [PSCustomObject]@{ Error = ($secErr + ' ' + $appErr).Trim() } | ConvertTo-Json -Compress }
  else { '[]' }
} else { $out | ConvertTo-Json -Compress }
`;

function parseJsonSafe(s) {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

async function search(re) {
  const raw = await psScript(SCRIPT, 120000);
  const rows = parseJsonSafe(raw);
  if (rows === null) {
    const m = raw.match(/\{.*\}/s);
    let errMsg = '事件日志读取失败';
    if (m) {
      try {
        const o = JSON.parse(m[0]);
        if (o.Error) errMsg = o.Error;
      } catch { /* 忽略 */ }
    }
    return [{
      source: 'eventlog',
      kind: 'error',
      name: '事件日志不可读',
      location: 'Security/Application 日志',
      match: '',
      deletable: false,
      deleteHint: errMsg.slice(0, 200) + '（读取安全日志需要管理员权限，请以管理员身份运行本服务）',
    }];
  }
  const out = [];
  rows.forEach((r, i) => {
    const text = String(r.Text || '');
    const hits = matchAll(text, re, 10);
    if (!hits.length) return;
    out.push({
      source: 'eventlog',
      kind: 'eventlog',
      name: (r.Log === 'Security' ? '审计事件 ' : '应用日志事件 ') + r.Id,
      location: r.Log + ' 事件日志 | ' + r.Time,
      match: hits.join(' … '),
      deletable: false,
      deleteHint: '事件日志无法单条删除；清空整个安全日志请用系统操作"清空安全事件日志"（需管理员）',
    });
  });
  return out;
}

module.exports = { search };

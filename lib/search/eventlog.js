// 事件日志痕迹：
// - Security 日志：文件系统审计事件 4656（请求句柄）、4660（对象删除）、4663（访问对象），ObjectName 含完整路径
// - Application 日志：崩溃/错误事件（Event 1000 等）的消息文本常含程序路径
// 默认未开启审计时 Security 无记录；读取 Security 需管理员权限；记录无法单条删除。
// 两个日志拆成两个 PowerShell 进程并行执行；内部用 List 收集，避免数组 += 的 O(n²) 开销。
const { psScript } = require('../ps');
const { matchAll } = require('../textmatch');

const HEAD = `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$list = [System.Collections.Generic.List[object]]::new()
`;

const SEC_SCRIPT = HEAD + `
try {
  $sec = Get-WinEvent -FilterHashtable @{ LogName = 'Security'; Id = 4656,4660,4663 } -ErrorAction Stop
  foreach ($e in $sec) {
    try {
      $xml = [xml]$e.ToXml()
      $data = @{}
      $xml.Event.EventData.Data | ForEach-Object { $data[$_.Name] = $_.'#text' }
      $obj = $data['ObjectName']
      if ($obj) {
        $list.Add([PSCustomObject]@{ Log = 'Security'; Id = $e.Id; Time = $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'); Text = $obj; User = $data['SubjectUserName'] })
      }
    } catch { }
  }
} catch { $err = $_.Exception.Message }
if ($list.Count -eq 0) {
  if ($err -and $err -notmatch 'No events|找不到|does not exist') { [PSCustomObject]@{ Error = $err } | ConvertTo-Json -Compress }
  else { '[]' }
} else { $list | ConvertTo-Json -Compress }
`;

const APP_SCRIPT = HEAD + `
try {
  $app = Get-WinEvent -FilterHashtable @{ LogName = 'Application' } -ErrorAction Stop
  foreach ($e in $app) {
    try {
      $t = $e.Message
      if ($t) {
        $list.Add([PSCustomObject]@{ Log = 'Application'; Id = $e.Id; Time = $e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'); Text = ($t -replace "\\r\\n", ' | '); User = '' })
      }
    } catch { }
  }
} catch { $err = $_.Exception.Message }
if ($list.Count -eq 0) {
  if ($err -and $err -notmatch 'No events|找不到|does not exist') { [PSCustomObject]@{ Error = $err } | ConvertTo-Json -Compress }
  else { '[]' }
} else { $list | ConvertTo-Json -Compress }
`;

function parseJsonSafe(s) {
  const start = s.indexOf('[');
  const end = s.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(s.slice(start, end + 1)); } catch { return null; }
}

function errorOf(raw) {
  const m = String(raw).match(/\{.*\}/s);
  if (!m) return '';
  try {
    const o = JSON.parse(m[0]);
    return o.Error || '';
  } catch {
    return '';
  }
}

async function search(re) {
  const [secRaw, appRaw] = await Promise.all([
    psScript(SEC_SCRIPT, 180000).catch(() => ''),
    psScript(APP_SCRIPT, 180000).catch(() => ''),
  ]);
  const rows = [...(parseJsonSafe(secRaw) || []), ...(parseJsonSafe(appRaw) || [])];
  if (!rows.length) {
    const errMsg = (errorOf(secRaw) + ' ' + errorOf(appRaw)).trim();
    if (!errMsg) return [];
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
  rows.forEach((r) => {
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

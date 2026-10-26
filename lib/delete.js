// 删除逻辑：按 kind 分发到对应删除方式
const fs = require('fs');
const path = require('path');
const { psScript } = require('./ps');
const { invalidateCache } = require('./search/registry_full');
const { firstField, HISTORY } = require('./search/evrun');
const { decodeXml, LIST: QMDLP } = require('./search/qqpcdlp');

// 从 Everything 运行历史 CSV 里按完整路径移除对应行
function deleteEvrunRow(item) {
  if (!item.location) throw new Error('缺少文件路径');
  const file = (item.extra && item.extra.historyFile) || HISTORY;
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error('读取 Everything 运行历史失败: ' + e.message);
  }
  const lines = raw.split(/\r?\n/);
  const kept = lines.filter((line) => !line.trim() || firstField(line) !== item.location);
  if (kept.length === lines.length) throw new Error('记录已不存在（Everything 可能已重写历史文件）');
  try {
    fs.writeFileSync(file, kept.join('\r\n'));
  } catch (e) {
    throw new Error('写入 Everything 运行历史失败（请先退出 Everything 再重试）: ' + e.message);
  }
  return '已从 Everything 运行历史移除: ' + item.location;
}

// 从电脑管家文件扫描记录 XML 中移除对应条目
function deleteQqpcdlpRow(item) {
  if (!item.location) throw new Error('缺少文件路径');
  const file = (item.extra && item.extra.listFile) || QMDLP;
  let xml;
  try {
    xml = fs.readFileSync(file, 'utf8');
  } catch (e) {
    throw new Error('读取电脑管家记录失败: ' + e.message);
  }
  const block = /<DLPElement\b[^>]*>[\s\S]*?<\/DLPElement>\r?\n?/g;
  const out = xml.replace(block, (b) => {
    const p = /<File path="([^"]*)"/.exec(b);
    return p && decodeXml(p[1]) === item.location ? '' : b;
  });
  if (out === xml) throw new Error('记录已不存在（电脑管家可能已重写列表）');
  try {
    fs.writeFileSync(file, out);
  } catch (e) {
    throw new Error('写入电脑管家记录失败（请先退出电脑管家再重试）: ' + e.message);
  }
  return '已从电脑管家文件扫描记录移除: ' + item.location;
}

// 删除应用私有库文件（下载记录 LevelDB / WPS 云同步映射库）
function deleteTraceDb(item, what) {
  if (!item.location) throw new Error('缺少数据库文件路径');
  try {
    fs.unlinkSync(item.location);
  } catch (e) {
    throw new Error('删除' + what + '失败（请先关闭对应程序）: ' + (e.code || e.message));
  }
  return '已删除' + what + ': ' + path.basename(item.location);
}

// 删除注册表值 + 清理 MRUListEx（若存在，值为 DWORD 数组，移除已删序号）
function deleteRegistryValue(item) {
  const { regPath, valueName } = item.extra || {};
  if (!regPath || valueName === undefined) throw new Error('注册表条目缺少定位信息');
  const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'Stop'
$regPath = 'Registry::${regPath}'
$valueName = '${String(valueName).replace(/'/g, "''")}'
Remove-ItemProperty -Path $regPath -Name $valueName -ErrorAction SilentlyContinue
# 清理 MRUListEx：移除已删除的序号
try {
  $v = (Get-ItemProperty -Path $regPath -Name MRUListEx).MRUListEx
  if ($v -is [byte[]]) {
    $nums = New-Object System.Collections.Generic.List[int]
    for ($i = 0; $i -lt $v.Length - 4; $i += 4) {
      $n = [BitConverter]::ToInt32($v, $i)
      if ($n -ne -1 -and $n.ToString() -ne $valueName) { $nums.Add($n) }
    }
    $nums.Add(-1)
    $bytes = New-Object byte[] ($nums.Count * 4)
    for ($i = 0; $i -lt $nums.Count; $i++) {
      [BitConverter]::GetBytes($nums[$i]).CopyTo($bytes, $i * 4)
    }
    Set-ItemProperty -Path $regPath -Name MRUListEx -Value $bytes
  }
} catch { }
'ok'
`;
  return psScript(script, 30000);
}

async function doDelete(item) {
  switch (item.kind) {
    case 'file':
    case 'lnk':
    case 'jumplist': {
      if (!item.location) throw new Error('缺少文件路径');
      fs.unlinkSync(item.location);
      return '已删除: ' + item.location;
    }
    case 'recycle': {
      if (!item.location) throw new Error('缺少回收站记录路径');
      fs.unlinkSync(item.location); // $I 索引
      const dataPath = item.extra && item.extra.dataPath;
      if (dataPath && fs.existsSync(dataPath)) fs.unlinkSync(dataPath); // $R 数据
      return '已从回收站永久删除: ' + item.name;
    }
    case 'registry': {
      await deleteRegistryValue(item);
      invalidateCache();
      return '已删除注册表值: ' + (item.extra && item.extra.regPath) + ' \\ ' + item.name;
    }
    case 'evrun':
      return deleteEvrunRow(item);
    case 'chromedl':
      return deleteTraceDb(item, '下载记录库文件');
    case 'wpsqing':
      return deleteTraceDb(item, 'WPS 云同步映射库');
    case 'qqpcdlp':
      return deleteQqpcdlpRow(item);
    default:
      throw new Error('该类型不支持直接删除: ' + (item.kind || 'unknown'));
  }
}

module.exports = { doDelete };

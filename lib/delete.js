// 删除逻辑：按 kind 分发到对应删除方式
const fs = require('fs');
const { psScript } = require('./ps');

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
      return '已删除注册表值: ' + (item.extra && item.extra.regPath) + ' \\ ' + item.name;
    }
    default:
      throw new Error('该类型不支持直接删除: ' + (item.kind || 'unknown'));
  }
}

module.exports = { doDelete };

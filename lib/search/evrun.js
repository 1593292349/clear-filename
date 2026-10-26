// Everything 运行历史：%APPDATA%\Everything\Run History.csv
// 每行 "完整路径",运行次数,最后运行时间，记录用户通过 Everything 打开过的文件。
// 记录只存在于该 CSV，文件删除后仍会保留；清理方式是按路径移除对应行。
const fs = require('fs');
const os = require('os');
const path = require('path');

const HISTORY = path.join(os.homedir(), 'AppData', 'Roaming', 'Everything', 'Run History.csv');
const HEADER = 'Filename,Run Count,Last Run Date';

// 取 CSV 第一列：双引号包裹，内部用 "" 转义
function firstField(line) {
  if (!line.startsWith('"')) {
    const i = line.indexOf(',');
    return i < 0 ? line : line.slice(0, i);
  }
  let s = '';
  for (let i = 1; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (line[i + 1] === '"') { s += '"'; i++; continue; }
      break;
    }
    s += c;
  }
  return s;
}

function search(re) {
  let text;
  try {
    text = fs.readFileSync(HISTORY, 'utf8');
  } catch {
    return []; // 文件不存在或不可读时视为无记录
  }
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line === HEADER) continue;
    const file = firstField(line);
    if (!file || !re.test(file)) continue;
    out.push({
      source: 'evrun',
      kind: 'evrun',
      name: path.basename(file),
      location: file,
      match: file,
      deletable: true,
      deleteHint: '从 Everything 运行历史移除该行（需先退出 Everything，否则其退出时会用内存数据覆盖）',
      extra: { historyFile: HISTORY },
    });
  }
  return out;
}

module.exports = { search, firstField, HISTORY };

// Windows 搜索索引（SYSTEMINDEX）：从正则提取字面片段做 LIKE 预筛，
// 多分支（|）用 OR 组合；无法提取字面（纯元字符正则）时退化为全量遍历（慢但完整）。
// 结果再经 JS 正则二次确认（LIKE 只支持子串匹配）。
const path = require('path');
const { psStream } = require('../ps');

// 按顶层 | 分割分支（跳过字符类和分组内部的 |）
function splitBranches(src) {
  const out = [];
  let cur = '';
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      cur += c + (src[i + 1] || '');
      i++;
      continue;
    }
    if (c === '[') { inClass = true; cur += c; continue; }
    if (c === ']') { inClass = false; cur += c; continue; }
    if (!inClass) {
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (c === '|' && depth === 0) { out.push(cur); cur = ''; continue; }
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

// 整串被一对括号完整包裹时剥掉这层，让顶层 | 能被 splitBranches 拆开（如 (a|b) → a|b）；
// 只处理 (...) 与 (?:...)，其他 (?=...) 等分组原样返回
function stripOuterGroup(src) {
  let s = src;
  while (s.length > 3 && s[0] === '(') {
    const open = s[1] === '?' ? (s[2] === ':' ? 3 : -1) : 1;
    if (open < 0) return s;
    let depth = 0;
    let inClass = false;
    let closed = -1;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === '\\') { i++; continue; }
      if (c === '[') { inClass = true; continue; }
      if (c === ']') { inClass = false; continue; }
      if (inClass) continue;
      if (c === '(') depth++;
      else if (c === ')') { depth--; if (depth === 0) { closed = i; break; } }
    }
    if (closed !== s.length - 1) return s;
    s = s.slice(open, -1);
  }
  return s;
}

// 跳过 open 处的分组（open 指向 '('），返回配对 ')' 的下标
function skipGroup(src, open) {
  let depth = 0;
  let inClass = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { inClass = true; continue; }
    if (c === ']') { inClass = false; continue; }
    if (inClass) continue;
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return i; }
  }
  return src.length - 1;
}

// 从 from 起找 ch（用于跳过 \u{...} \p{...} \k<...> 的整段），找不到返回末尾
function jumpTo(src, from, ch) {
  const j = src.indexOf(ch, from);
  return j < 0 ? src.length - 1 : j;
}

// 提取单个分支中「所有匹配文本都必然包含」的最长连续字面；任何一处不能保证就丢弃该段，
// 宁可退化为全量遍历也不能漏匹配：
// - 分支内的 |（分组内 alternation）：组内字面全部作废，只保留组外字面
// - ? * {0,n}：前一个字符可选，丢弃；+ {n>=1}：至少出现一次，保留
// - 断言 (?= (?! (?<= (?<!：零宽，跳过内部不计字面
// - 字符类、\d\w\s 等类转义、\x \u \c \p \k 等字母/数字转义：断开（\d 不是字面 d）
// - 分组被 ? * {0,n} 修饰（如 (abc)?）：组内字面丢弃
function longestLiteral(src) {
  let best = '';
  let cur = '';
  let prevQuant = false;
  const stack = [];
  const settle = () => {
    if (cur.length > best.length) best = cur;
    cur = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1] || '';
      i++;
      if (/[A-Za-z0-9]/.test(n)) {
        // 类元字符 / 编码转义 / 反向引用：跳过整段，不能当字面（\x41 是 A，不是 41）
        if (n === 'u' && src[i + 1] === '{') i = jumpTo(src, i, '}');
        else if (n === 'u') i += 4;
        else if (n === 'x') i += 2;
        else if (n === 'c') i += 1;
        else if (n === 'k' && src[i + 1] === '<') i = jumpTo(src, i, '>');
        else if ((n === 'p' || n === 'P') && src[i + 1] === '{') i = jumpTo(src, i, '}');
        else if (/\d/.test(n)) while (/\d/.test(src[i + 1] || '')) i++;
        settle();
        prevQuant = false;
        continue;
      }
      cur += n;
      prevQuant = false;
      continue;
    }
    if (c === '[') {
      settle();
      let j = i + 1;
      if (src[j] === '^') j++;
      if (src[j] === ']') j++;
      while (j < src.length && src[j] !== ']') {
        if (src[j] === '\\') j++;
        j++;
      }
      i = j;
      prevQuant = false;
      continue;
    }
    if (c === '(') {
      settle();
      // (?:...) 是普通分组；其余 (?...) 是断言/命名组，内部字面不能外借
      if (src[i + 1] === '?' && src[i + 2] !== ':') {
        i = skipGroup(src, i);
        prevQuant = false;
        continue;
      }
      stack.push({ best, hasAlt: false });
      prevQuant = false;
      continue;
    }
    if (c === ')') {
      const snap = stack.pop();
      settle();
      const next = src[i + 1] || '';
      const optional = next === '?' || next === '*' || /^\{0[,}]/.test(src.slice(i + 1, i + 5));
      if (snap && (snap.hasAlt || optional)) best = snap.best;
      prevQuant = false;
      continue;
    }
    if (c === '|') {
      // 顶层 | 已由 splitBranches 拆开，这里只剩分组内 alternation
      if (!stack.length) return '';
      const top = stack[stack.length - 1];
      top.hasAlt = true;
      best = top.best;
      cur = '';
      prevQuant = false;
      continue;
    }
    if (c === '?' || c === '*') {
      if (prevQuant) continue; // 惰性量词的第二个字符
      if (cur) cur = cur.slice(0, -1);
      settle();
      prevQuant = true;
      continue;
    }
    if (c === '+') { prevQuant = true; continue; }
    if (c === '{') {
      const m = /^\{(\d+)(?:,\d*)?\}/.exec(src.slice(i));
      if (m) {
        i += m[0].length - 1;
        if (Number(m[1]) === 0) {
          if (cur) cur = cur.slice(0, -1);
          settle();
        }
        prevQuant = true;
        continue;
      }
      settle();
      prevQuant = false;
      continue;
    }
    if (/[.^$}\]]/.test(c)) { settle(); prevQuant = false; continue; }
    cur += c;
    prevQuant = false;
  }
  settle();
  return best;
}

// LIKE 通配符与单引号转义，并转义 PowerShell 双引号字符串里的 ` " $
// （否则正则字面含 " ` $ 时 CommandText 被提前闭合或变量展开，静默 0 条/漏匹配）
function escapeLike(s) {
  return s
    .replace(/[%_\[]/g, (m) => '[' + m + ']')
    .replace(/'/g, "''")
    .replace(/[`"$]/g, (m) => '`' + m);
}

async function search(re) {
  const branches = splitBranches(stripOuterGroup(re.source));
  const lits = branches.map(longestLiteral);
  const canPrefilter = lits.length > 0 && lits.every((x) => x.length > 0);
  const where = canPrefilter
    ? ' WHERE (' + lits.map((l) => "System.FileName LIKE '%" + escapeLike(l) + "%'").join(' OR ') + ')'
    : '';
  const script = `
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$conn = New-Object System.Data.OleDb.OleDbConnection("Provider=Search.CollatorDSO;Extended Properties='Application=Windows'")
$conn.Open()
$cmd = $conn.CreateCommand()
$cmd.CommandText = "SELECT System.ItemPathDisplay FROM SYSTEMINDEX${where}"
$r = $cmd.ExecuteReader()
while ($r.Read()) { $r.GetValue(0).ToString() }
$conn.Close()
`;
  const out = [];
  await psStream(script, (line) => {
    const full = line.trim();
    if (!full) return;
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
  }, 300000);
  return out;
}

module.exports = { search };

// 全注册表搜索：reg export 把「计算机」下每个根键导出为 .reg 文本，
// 再全读 + 双路字面预扫（原文命中 REG_SZ，UTF-16 hex 命中 REG_BINARY），
// 命中行回溯到值块后交给正则二次确认。覆盖 HKLM / HKCU / HKU / HKCC。
//
// 导出并行化：HKLM 是绝对瓶颈（整根导出约 356MB / 20 秒，其中 SOFTWARE 一树占 275MB），
// 因此把 HKLM 按子树拆开、多个 reg export 进程并行写盘（并发上限 12），
// 实测 20.8s → 约 6s。HKCU / HKU / HKCC 体量小（50/67MB），整根导出即可。
const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { matchAll } = require('../textmatch');

const ROOTS = ['HKLM', 'HKCU', 'HKU', 'HKCC'];
const TMP_DIR = path.join(os.tmpdir(), 'clear-filename-reg');
const STAMP = path.join(TMP_DIR, '.stamp');
const CACHE_MS = 5 * 60 * 1000;
const MAX_HEX = 4 * 1024 * 1024; // 单个 hex 值上限，防止病态超长二进制拖垮解析
const HEX_CHARS = 8; // hex 预扫取字面前 8 字符（16 字节），保证落在同一 hex 行内
const EXPORT_CONCURRENCY = 12;

// 实测耗时热点：只拆两层（HKLM → 顶层，SOFTWARE → 子键），再往下拆会变成
// 几百个 reg.exe 进程争用磁盘 IO，反而比整棵导出更慢（实测 335 个文件时 26.7s）。
// 也不能拆 HKLM\SOFTWARE\Classes —— 它下面有数千个文件关联子键。
const SPLIT_KEYS = new Set([
  'HKLM',
  'HKLM\\SOFTWARE',
]);

const ROOT_FULL = {
  HKLM: 'HKEY_LOCAL_MACHINE',
  HKCU: 'HKEY_CURRENT_USER',
  HKU: 'HKEY_USERS',
  HKCC: 'HKEY_CURRENT_CONFIG',
};

function ensureDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch { /* 已存在 */ }
}

function fullName(key) {
  const parts = key.split('\\');
  const head = ROOT_FULL[parts[0]] || parts[0];
  return parts.length > 1 ? head + '\\' + parts.slice(1).join('\\') : head;
}

function fileOf(key) {
  const safe = key.replace(/[\\/:*?"<>|]/g, '_');
  return path.join(TMP_DIR, safe + '.reg');
}

// 简单并发池：限制同时在跑的 reg.exe 数量
function makeLimiter(max) {
  let active = 0;
  const queue = [];
  const pump = () => {
    if (active >= max || !queue.length) return;
    active++;
    const task = queue.shift();
    task().finally(() => {
      active--;
      pump();
    });
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push(() => fn().then(resolve, reject));
    pump();
  });
}

const limitedExport = makeLimiter(EXPORT_CONCURRENCY);

function exportOne(key) {
  const file = fileOf(key);
  return limitedExport(() => new Promise((resolve) => {
    execFile('reg', ['export', key, file, '/y'], { windowsHide: true, timeout: 180000 }, () => {
      try {
        resolve(fs.statSync(file).size > 0 ? file : null);
      } catch {
        resolve(null);
      }
    });
  }));
}

function listSubkeys(key) {
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', key],
      { windowsHide: true, timeout: 60000, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        const full = fullName(key) + '\\';
        const subs = [];
        for (const raw of String(stdout).split(/\r?\n/)) {
          const line = raw.trim();
          if (!line.startsWith(full)) continue;
          const rel = line.slice(full.length);
          if (rel && !rel.includes('\\')) subs.push(rel);
        }
        resolve(subs);
      }
    );
  });
}

// 拆分键：先列子键，递归导出每个子键；子键为空时退回整键导出
async function exportTree(key, depth) {
  if (depth < 4 && SPLIT_KEYS.has(key)) {
    const subs = await listSubkeys(key);
    if (subs.length) {
      await Promise.all(subs.map((s) => exportTree(key + '\\' + s, depth + 1)));
      return;
    }
  }
  await exportOne(key);
}

function keyFromFile(file) {
  const base = path.basename(file, '.reg');
  return base.replace(/_/g, '\\');
}

function cacheFresh() {
  try {
    return Date.now() - fs.statSync(STAMP).mtimeMs < CACHE_MS;
  } catch {
    return false;
  }
}

function listExportFiles() {
  const files = [];
  let entries;
  try {
    entries = fs.readdirSync(TMP_DIR, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.reg')) continue;
    files.push({ root: keyFromFile(e.name).split('\\')[0], file: path.join(TMP_DIR, e.name) });
  }
  return files;
}

async function ensureExports() {
  if (cacheFresh()) return;
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch { /* 忽略 */ }
  ensureDir(TMP_DIR);
  await Promise.all(ROOTS.map((root) => (root === 'HKLM' ? exportTree(root, 0) : exportOne(root))));
  try {
    fs.writeFileSync(STAMP, String(Date.now()));
  } catch { /* 忽略 */ }
}

function hexToText(hex) {
  if (hex.length > MAX_HEX * 3) return '';
  const bytes = [];
  for (const part of hex.split(',')) {
    const b = parseInt(part.trim(), 16);
    if (!Number.isNaN(b)) bytes.push(b);
  }
  if (!bytes.length) return '';
  const buf = Buffer.from(bytes);
  return buf.toString('utf16le') + '\n' + buf.toString('latin1');
}

// 值数据转可匹配文本：REG_SZ 直读；REG_BINARY 与 hex(2)/hex(7)（EXPAND_SZ / MULTI_SZ）按字节解码；
// hex(4)/hex(b) 等数值类型不是文本，不参与匹配
function valueText(data) {
  if (data.startsWith('"')) return data.slice(1, data.lastIndexOf('"'));
  const m = /^hex(?:\(([0-9a-f]+)\))?:([\s\S]*)$/.exec(data);
  if (!m) return '';
  const type = m[1] || '3';
  if (type !== '2' && type !== '3' && type !== '7') return '';
  return hexToText(m[2].replace(/[\\\s]/g, ''));
}

function decodeValueLine(line) {
  if (line.startsWith('@=')) return { name: '', data: line.slice(2) };
  if (!line.startsWith('"')) return null;
  let i = 1;
  let name = '';
  while (i < line.length) {
    const c = line[i];
    if (c === '\\' && i + 1 < line.length) {
      name += line[i + 1];
      i += 2;
      continue;
    }
    if (c === '"') break;
    name += c;
    i++;
  }
  if (line[i] !== '"' || line[i + 1] !== '=') return null;
  return { name, data: line.slice(i + 2) };
}

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
// 宁可退化为全量扫描也不能漏匹配：
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

// 字面 → .reg 中 hex 数据的匹配模式（小写、逗号分隔）
function hexNeedle(lit) {
  const chars = lit.slice(0, HEX_CHARS);
  if (chars.length < 2) return '';
  return Buffer.from(chars, 'utf16le')
    .toString('hex')
    .match(/../g)
    .join(',');
}

function keyOf(text, pos) {
  let p = pos;
  for (let i = 0; i < 500; i++) {
    if (p <= 1) return '';
    const prev = text.lastIndexOf('\n', p - 1);
    if (prev < 0) return '';
    const s = prev + 1;
    if (text.charCodeAt(s) === 0x5b) {
      const e = text.indexOf('\n', s);
      return text.slice(s + 1, e < 0 ? text.length : e).replace(/\r$/, '').replace(/\]$/, '');
    }
    p = prev;
  }
  return '';
}

// hex 值跨行，命中续行时向上找到值行并合并整块
function valueBlock(text, lineStart, lineEnd) {
  let s = lineStart;
  let found = -1;
  for (let i = 0; i < 500; i++) {
    if (s <= 1) break;
    const prev = text.lastIndexOf('\n', s - 1);
    if (prev < 0) break;
    const ls = prev + 1;
    const le = text.indexOf('\n', ls);
    const line = text.slice(ls, le < 0 ? text.length : le).replace(/\r$/, '');
    if (line.includes('=')) { found = ls; break; }
    if (text.charCodeAt(ls) === 0x5b) break;
    s = prev;
  }
  if (found < 0) return null;
  return text.slice(found, lineEnd);
}

function pushByNeedle(text, hay, needle, re, out, skipPrefix) {
  let pos = 0;
  let seenLine = -1;
  while ((pos = hay.indexOf(needle, pos)) !== -1) {
    const lineStart = text.lastIndexOf('\n', pos) + 1;
    let lineEnd = text.indexOf('\n', pos);
    if (lineEnd < 0) lineEnd = text.length;
    if (lineStart === seenLine) {
      pos = lineEnd + 1;
      continue;
    }
    seenLine = lineStart;
    const rawLine = text.slice(lineStart, lineEnd).replace(/\r$/, '');
    const isKeyLine = rawLine.charCodeAt(0) === 0x5b;
    const key = isKeyLine ? rawLine.slice(1, -1) : keyOf(text, lineStart);
    let name = '';
    let hitText = '';
    if (isKeyLine) {
      hitText = key;
    } else {
      const kv = decodeValueLine(rawLine);
      if (kv) {
        name = kv.name;
        const vt = valueText(kv.data);
        hitText = name ? name + '\n' + vt : vt;
      } else {
        const block = valueBlock(text, lineStart, lineEnd);
        if (!block) {
          pos = lineEnd + 1;
          continue;
        }
        const nl = block.indexOf('\n');
        const firstLine = (nl < 0 ? block : block.slice(0, nl)).replace(/\r$/, '');
        const kv2 = decodeValueLine(firstLine);
        if (!kv2) {
          pos = lineEnd + 1;
          continue;
        }
        name = kv2.name;
        const eq = block.indexOf('=');
        const vt2 = valueText(block.slice(eq + 1));
        hitText = name ? name + '\n' + vt2 : vt2;
      }
    }
    pos = lineEnd + 1;
    if (!hitText) continue;
    if (skipPrefix && key.startsWith(skipPrefix)) continue;
    if (!re.test(hitText)) continue;
    if (isKeyLine) {
      out.push({
        source: 'registry',
        kind: 'registry_key',
        name: key.split('\\').pop() || key,
        location: key,
        match: key,
        deletable: false,
        deleteHint: '匹配到注册表键名，需手动用注册表编辑器删除该子键',
      });
    } else {
      out.push({
        source: 'registry',
        kind: 'registry',
        name: name || '(默认值)',
        location: key,
        match: matchAll(hitText, re, 3, 60).join(' | ') || hitText.slice(0, 120),
        deletable: true,
        deleteHint: '删除该注册表值（属于 MRU 列表时会同步更新 MRUListEx）',
        extra: { regPath: key, valueName: name },
      });
    }
  }
}

async function slowScan(file, re, out, skipPrefix) {
  await new Promise((resolve) => {
    const rl = readline.createInterface({
      input: fs.createReadStream(file, { encoding: 'utf16le' }),
      crlfDelay: Infinity,
    });
    let curKey = '';
    let skip = false;
    let pending = '';
    rl.on('line', (raw) => {
      let line = raw.replace(/^\ufeff/, '');
      if (pending) {
        line = pending + line;
        pending = '';
      }
      if (!line) return;
      if (line.endsWith('\\')) {
        pending = line.slice(0, -1);
        return;
      }
      if (line[0] === '[') {
        const end = line.lastIndexOf(']');
        curKey = line.slice(1, end < 0 ? line.length : end);
        skip = Boolean(skipPrefix && curKey.startsWith(skipPrefix));
        if (!skip && curKey && re.test(curKey)) {
          out.push({
            source: 'registry',
            kind: 'registry_key',
            name: curKey.split('\\').pop() || curKey,
            location: curKey,
            match: curKey,
            deletable: false,
            deleteHint: '匹配到注册表键名，需手动用注册表编辑器删除该子键',
          });
        }
        return;
      }
      if (skip) return;
      const kv = decodeValueLine(line);
      if (!kv) return;
      const vt = valueText(kv.data);
      const text = kv.name ? kv.name + '\n' + vt : vt;
      if (!text || !re.test(text)) return;
      out.push({
        source: 'registry',
        kind: 'registry',
        name: kv.name || '(默认值)',
        location: curKey,
        match: matchAll(text, re, 3, 60).join(' | ') || text.slice(0, 120),
        deletable: true,
        deleteHint: '删除该注册表值（属于 MRU 列表时会同步更新 MRUListEx）',
        extra: { regPath: curKey, valueName: kv.name },
      });
    });
    rl.on('close', resolve);
    rl.on('error', resolve);
  });
}

let sidCache;
function currentSid() {
  if (sidCache !== undefined) return Promise.resolve(sidCache);
  return new Promise((resolve) => {
    // 用完整路径避开 MSYS 自带的 GNU whoami（不支持 /user）
    const exe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'whoami.exe');
    execFile(exe, ['/user'], { windowsHide: true }, (err, stdout) => {
      const m = err ? null : String(stdout).match(/(S-1-[\d-]+)/);
      sidCache = m ? m[1] : '';
      resolve(sidCache);
    });
  });
}

function invalidateCache() {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch { /* 忽略 */ }
}

async function search(re) {
  ensureDir(TMP_DIR);
  await ensureExports();
  const files = listExportFiles();
  const sid = files.some((x) => x.root === 'HKU') ? await currentSid() : '';
  const skipPrefix = sid ? 'HKEY_USERS\\' + sid : '';
  const branches = splitBranches(stripOuterGroup(re.source));
  const literals = branches.map(longestLiteral);
  const canFast = literals.length > 0 && literals.every((x) => x.length > 0);
  const ignoreCase = re.flags.includes('i');
  const out = [];
  for (const { file } of files) {
    if (!canFast) {
      await slowScan(file, re, out, skipPrefix);
      continue;
    }
    const text = fs.readFileSync(file).toString('utf16le');
    const lowerText = ignoreCase ? text.toLowerCase() : text;
    for (const lit of literals) {
      pushByNeedle(text, ignoreCase ? lowerText : text, ignoreCase ? lit.toLowerCase() : lit, re, out, skipPrefix);
      const hxVariants = ignoreCase
        ? new Set([lit, lit.toLowerCase(), lit.toUpperCase(), lit.charAt(0).toUpperCase() + lit.slice(1).toLowerCase()])
        : new Set([lit]);
      for (const v of hxVariants) {
        const hx = hexNeedle(v);
        if (hx) pushByNeedle(text, text, hx, re, out, skipPrefix);
      }
    }
  }
  // hex 扫描会按大小写变体重复命中同一值，这里按「键 + 值名 + 片段」去重
  const seen = new Set();
  const dedup = [];
  for (const x of out) {
    const k = x.kind + '|' + x.location + '|' + (x.extra ? x.extra.valueName : '') + '|' + x.match;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(x);
  }
  return dedup;
}

module.exports = { search, invalidateCache };

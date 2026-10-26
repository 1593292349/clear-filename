// 二进制残留扫描工具：从 LevelDB / SQLite 等私有库文件中提取可读字符串，
// 供「应用私有库」类搜索来源复用（这些库的文本不以明文行存储，无法按行扫描）。
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]+/;

// 按控制字符切分文本，返回长度 >= min 的候选片段。
// offset 用于处理未按 2 字节对齐的 UTF-16 文本（SQLite 页内残留可能从奇数偏移开始）。
function stringsFrom(buf, encoding, min = 4, offset = 0) {
  const b = offset ? buf.subarray(offset) : buf;
  const end = encoding === 'utf16le' ? Math.floor(b.length / 2) * 2 : b.length;
  return b.toString(encoding, 0, end).split(CTRL).filter((s) => s.length >= min);
}

// 提取片段中的 Windows 路径（遇到文件名字符集外的字符即断开）。
// 先按盘符前缀切段，避免前一段把下一条路径的盘符字母吞进自己的结尾。
function pathRuns(s) {
  const out = [];
  const re = /[A-Za-z]:\\(?:[^\\/:*?"<>|\u0000-\u001f]+\\)*[^\\/:*?"<>|\u0000-\u001f]*/;
  for (const part of s.split(/(?=[A-Za-z]:\\)/)) {
    const m = re.exec(part);
    if (m && m[0].length >= 4) out.push(m[0]);
  }
  return out;
}

// 截断路径末尾的二进制乱码：扩展名后紧跟非 ASCII 字符时，截到扩展名结束
function trimPath(s) {
  const m = /\.[A-Za-z]{1,5}(?=[0-9]{6,}|[^\x00-\x7f\\/]|$)/.exec(s);
  return m ? s.slice(0, m.index + m[0].length) : s;
}

module.exports = { stringsFrom, pathRuns, trimPath };

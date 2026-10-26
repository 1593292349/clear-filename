// PowerShell 封装：用 -EncodedCommand (UTF-16LE Base64) 传脚本，
// 规避 Windows 命令行中文编码问题；脚本内设置 UTF-8 输出。
// 脚本前不能加 BOM：BOM 会粘住第一条语句使其静默失败（退出码仍为 0），
// 曾导致 eventlog 首行的编码赋值失效、中文全部变成乱码。
const { execFile } = require('child_process');

function psScript(script, timeoutMs = 120000) {
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, windowsHide: true, timeout: timeoutMs },
      (err, stdout, stderr) => {
        if (err) reject(new Error((stderr || err.message || '').trim() || 'powershell 执行失败'));
        else resolve(stdout);
      }
    );
  });
}

// 流式版本：PowerShell 逐行输出，Node 边读边处理，内存与结果总量无关
function psStream(script, onLine, timeoutMs = 120000) {
  const { spawn } = require('child_process');
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', b64],
      { windowsHide: true }
    );
    let buf = '';
    let errText = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* ignore */ }
      reject(new Error('powershell 执行超时'));
    }, timeoutMs);
    const flushLine = (line) => {
      try { onLine(line); } catch { /* 单行解析失败不影响整体 */ }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      buf += d;
      let idx;
      while ((idx = buf.indexOf('\n')) >= 0) {
        flushLine(buf.slice(0, idx));
        buf = buf.slice(idx + 1);
      }
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { errText += d; });
    child.on('error', (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (buf.trim()) flushLine(buf);
      if (code !== 0 && !errText) reject(new Error('powershell 退出码 ' + code));
      else resolve();
    });
  });
}

module.exports = { psScript, psStream };

// PowerShell 封装：用 -EncodedCommand (UTF-16LE Base64) 传脚本，
// 规避 Windows 命令行中文编码问题；脚本内设置 UTF-8 输出。
const { execFile } = require('child_process');

function psScript(script, timeoutMs = 120000) {
  const b64 = Buffer.from('\ufeff' + script, 'utf16le').toString('base64');
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

module.exports = { psScript };

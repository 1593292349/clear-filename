const express = require('express');
const path = require('path');
const { doDelete } = require('./lib/delete');
const { runSystem } = require('./lib/system');
const { listDrives } = require('./lib/search/filesystem');

const SEARCHERS = {
  filesystem: require('./lib/search/filesystem'),
  usn: require('./lib/search/usn'),
  recyclebin: require('./lib/search/recyclebin'),
  recent: require('./lib/search/recent'),
  registry: require('./lib/search/registry_full'),
  searchindex: require('./lib/search/searchindex'),
  appmru: require('./lib/search/appmru'),
  browserdl: require('./lib/search/browserdl'),
  amcache: require('./lib/search/amcache'),
  prefetch: require('./lib/search/prefetch'),
  eventlog: require('./lib/search/eventlog'),
  filemgr: require('./lib/search/filemgr'),
  evrun: require('./lib/search/evrun'),
  chromedl: require('./lib/search/chromedl'),
  wpsqing: require('./lib/search/wpsqing'),
  qqpcdlp: require('./lib/search/qqpcdlp'),
};

const SOURCE_LABELS = {
  filesystem: '文件系统',
  usn: 'USN',
  recyclebin: '回收站',
  recent: '最近访问',
  registry: '注册表',
  searchindex: '搜索索引',
  appmru: 'IDE',
  browserdl: '浏览器',
  amcache: 'Amcache',
  prefetch: 'Prefetch',
  eventlog: '事件日志',
  filemgr: '文件管理器',
  evrun: 'Everything 历史',
  chromedl: '下载记录库',
  wpsqing: 'WPS 云同步',
  qqpcdlp: '电脑管家记录',
};

const PORT = process.env.PORT || 8300;
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 系统级清理的盘符下拉：返回本机实际存在的盘符（不带反斜杠）
app.get('/api/drives', (req, res) => {
  res.json({ drives: listDrives().map((d) => d.replace(/\\+$/, '')) });
});

// 极端保护：仅当匹配条数超过 10 万时截断并明确告知前端；正常搜索全部返回，不做每源配额
const MAX_RESULTS = 100000;

// 搜索：按正则匹配各来源
app.post('/api/search', async (req, res) => {
  const { regex, sources, ignoreCase } = req.body || {};
  if (typeof regex !== 'string' || !regex.trim()) {
    return res.status(400).json({ error: '请输入正则表达式' });
  }
  let re;
  try {
    re = new RegExp(regex, ignoreCase === false ? '' : 'i');
  } catch (e) {
    return res.status(400).json({ error: '正则无效: ' + e.message });
  }
  const selected = Array.isArray(sources) && sources.length
    ? sources
    : Object.keys(SEARCHERS);
  const tasks = selected
    .filter((s) => SEARCHERS[s])
    .map(async (s) => {
      try {
        const items = await SEARCHERS[s].search(re);
        return items.map((it, i) => ({ ...it, id: s + ':' + i, sourceLabel: SOURCE_LABELS[s] || s }));
      } catch (e) {
        return [{
          id: s + ':error', source: s, sourceLabel: SOURCE_LABELS[s] || s,
          kind: 'error', name: '来源搜索失败', location: '',
          match: '', deletable: false, deleteHint: String(e.message || e),
        }];
      }
    });
  const groups = await Promise.all(tasks);
  const all = groups.flat();
  // 不做每源配额：所有命中全部返回，避免静默漏报（仅在极端数量下整体截断并告知前端）
  const total = all.length;
  const truncated = all.length > MAX_RESULTS;
  const results = truncated ? all.slice(0, MAX_RESULTS) : all;
  res.json({ results, truncated, total });
});

// 删除：按条目逐项删除
app.post('/api/delete', async (req, res) => {
  const { items } = req.body || {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: '未选择要删除的记录' });
  }
  const results = [];
  for (const it of items) {
    try {
      const message = await doDelete(it);
      results.push({ id: it.id, ok: true, message });
    } catch (e) {
      results.push({ id: it.id, ok: false, message: e.message });
    }
  }
  res.json({ results });
});

// 系统级清理（需管理员权限）
app.post('/api/system/:op', async (req, res) => {
  const { op } = req.params;
  const { drive } = req.body || {};
  try {
    const output = await runSystem(op, drive);
    res.json({ ok: true, output });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('clear-filename 已启动: http://localhost:' + PORT);
});

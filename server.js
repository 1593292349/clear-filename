const express = require('express');
const path = require('path');
const { doDelete } = require('./lib/delete');
const { runSystem } = require('./lib/system');

const SEARCHERS = {
  filesystem: require('./lib/search/filesystem'),
  recyclebin: require('./lib/search/recyclebin'),
  recent: require('./lib/search/recent'),
  registry: require('./lib/search/registry'),
  registry_extra: require('./lib/search/registry_extra'),
  jumplist: require('./lib/search/jumplist'),
  searchindex: require('./lib/search/searchindex'),
  appmru: require('./lib/search/appmru'),
  browserdl: require('./lib/search/browserdl'),
  prefetch: require('./lib/search/prefetch'),
  jetbrains: require('./lib/search/jetbrains'),
  eventlog: require('./lib/search/eventlog'),
  filemgr: require('./lib/search/filemgr'),
};

const SOURCE_LABELS = {
  filesystem: '文件系统（全盘）',
  recyclebin: '回收站记录',
  recent: '最近使用 .lnk',
  registry: '注册表 MRU',
  registry_extra: '注册表扩展',
  jumplist: '跳转列表',
  searchindex: '搜索索引',
  appmru: '应用 MRU',
  browserdl: '浏览器下载历史',
  prefetch: 'Prefetch',
  jetbrains: 'JetBrains IDE',
  eventlog: '安全事件日志',
  filemgr: '文件管理器(TC)',
};

const PORT = process.env.PORT || 8300;
const app = express();
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// 归一化条目：截断超长文本，防止前端渲染卡死
const MAX_RESULTS = 2000;
const MAX_PER_SOURCE = 500;
const MAX_TEXT = 300;

function truncate(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function normalize(item) {
  return {
    ...item,
    name: truncate(item.name, 120),
    location: truncate(item.location, 300),
    match: truncate(item.match, 300),
    deleteHint: truncate(item.deleteHint, 200),
  };
}

// 搜索：按正则匹配各来源
app.post('/api/search', async (req, res) => {
  const { regex, sources } = req.body || {};
  if (typeof regex !== 'string' || !regex.trim()) {
    return res.status(400).json({ error: '请输入正则表达式' });
  }
  let re;
  try {
    re = new RegExp(regex);
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
  const all = groups.flat().map(normalize);
  // 每源限流，避免单个来源（如全盘文件）淹没其他来源的命中
  const perSource = new Map();
  const capped = [];
  for (const it of all) {
    const c = perSource.get(it.source) || 0;
    if (c >= MAX_PER_SOURCE) continue;
    perSource.set(it.source, c + 1);
    capped.push(it);
  }
  const total = all.length;
  const truncated = capped.length > MAX_RESULTS;
  const results = truncated ? capped.slice(0, MAX_RESULTS) : capped;
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

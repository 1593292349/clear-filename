// clear-filename 前端逻辑
(() => {
  const $ = (sel) => document.querySelector(sel);

  const state = { items: [], running: false };

  const $regex = $('#regex');
  const $btnSearch = $('#btn-search');
  const $btnDelete = $('#btn-delete');
  const $checkAll = $('#check-all');
  const $tbody = $('#result-body');
  const $stat = $('#stat');
  const $toast = $('#toast');

  let toastTimer = null;
  function toast(msg, ms = 4000) {
    $toast.textContent = msg;
    $toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $toast.classList.add('hidden'), ms);
  }

  function selectedSources() {
    return Array.from(document.querySelectorAll('.sources input[type=checkbox]'))
      .filter((c) => c.checked)
      .map((c) => c.dataset.source);
  }

  function buildRow(it) {
    const tr = document.createElement('tr');
    tr.dataset.id = it.id;

    const tdCheck = document.createElement('td');
    tdCheck.className = 'col-check';
    if (it.deletable) {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.className = 'row-check';
      cb.dataset.id = it.id;
      tdCheck.appendChild(cb);
    }
    tr.appendChild(tdCheck);

    const tdSource = document.createElement('td');
    tdSource.className = 'col-source';
    tdSource.textContent = it.sourceLabel || it.source || '';
    tr.appendChild(tdSource);

    const tdName = document.createElement('td');
    tdName.className = 'col-name';
    tdName.textContent = it.name || '';
    tdName.title = it.name || '';
    tr.appendChild(tdName);

    const tdLoc = document.createElement('td');
    tdLoc.className = 'col-loc';
    tdLoc.textContent = it.location || '';
    tdLoc.title = it.location || '';
    tr.appendChild(tdLoc);

    const tdMatch = document.createElement('td');
    tdMatch.className = 'col-match';
    tdMatch.textContent = it.match || '';
    tdMatch.title = it.match || '';
    tr.appendChild(tdMatch);

    const tdHint = document.createElement('td');
    tdHint.className = 'col-hint';
    tdHint.textContent = it.deleteHint || '';
    tdHint.title = it.deleteHint || '';
    tr.appendChild(tdHint);

    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const badge = document.createElement('span');
    badge.className = 'badge' + (it.deletable ? '' : it.kind === 'error' ? ' err' : ' manual');
    badge.textContent = it.kind === 'error' ? '失败' : it.deletable ? '可删除' : '手动处理';
    tdStatus.appendChild(badge);
    tr.appendChild(tdStatus);

    return tr;
  }

  // 分批渲染，避免结果多时一次性插入阻塞主线程
  const RENDER_BATCH = 200;
  let renderTimer = null;

  function render() {
    clearTimeout(renderTimer);
    $tbody.innerHTML = '';
    const items = state.items;
    if (!items.length) {
      $tbody.innerHTML = '<tr><td colspan="7" class="empty">无结果</td></tr>';
      $stat.textContent = '未搜索';
      return;
    }
    const deletable = items.filter((i) => i.deletable).length;
    const extra = state.truncated ? `（结果过多，仅显示前 ${items.length} 条，请用更精确的正则）` : '';
    $stat.textContent = `共 ${state.total} 条（可删除 ${deletable} 条）${extra}`;
    let i = 0;
    const next = () => {
      const end = Math.min(i + RENDER_BATCH, items.length);
      const frag = document.createDocumentFragment();
      for (; i < end; i++) frag.appendChild(buildRow(items[i]));
      $tbody.appendChild(frag);
      if (i < items.length) renderTimer = setTimeout(next, 0);
    };
    next();
  }

  function updateCheckAll() {
    const boxes = Array.from($tbody.querySelectorAll('.row-check'));
    $checkAll.checked = boxes.length > 0 && boxes.every((b) => b.checked);
    $checkAll.indeterminate = boxes.some((b) => b.checked) && !$checkAll.checked;
  }

  $btnSearch.addEventListener('click', async () => {
    const regex = $regex.value.trim();
    if (!regex) { toast('请输入正则表达式'); return; }
    let testRe;
    try { testRe = new RegExp(regex); } catch (e) { toast('正则无效: ' + e.message); return; }
    state.running = true;
    $btnSearch.disabled = true;
    $stat.textContent = '搜索中…（全盘扫描可能需要几分钟）';
    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regex, sources: selectedSources() }),
      });
      const data = await resp.json();
      if (!resp.ok) { toast(data.error || '搜索失败'); return; }
      state.items = data.results;
      state.total = data.total;
      state.truncated = !!data.truncated;
      render();
      updateCheckAll();
      toast(`搜索完成：共 ${data.total} 条${state.truncated ? '（已截断显示）' : ''}`);
    } catch (e) {
      toast('搜索请求失败: ' + e.message);
    } finally {
      state.running = false;
      $btnSearch.disabled = false;
    }
  });

  $regex.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $btnSearch.click();
  });

  // 系统级清理操作
  const $sysOutput = $('#sys-output');
  const SYS_OPS = [
    ['#btn-usn', 'usn', '确认清空 USN Journal？\nEverything 等工具需全量重建索引；此操作影响整个盘。'],
    ['#btn-vss', 'vss', '确认删除该盘全部卷影副本？\n系统还原点和备份快照将全部清除。'],
    ['#btn-cipher', 'cipher', '确认覆盖磁盘空闲空间？\n耗时极长（视盘大小可达数小时），期间请勿关机。'],
    ['#btn-evtx', 'eventlog', '确认清空安全事件日志？\n全部安全审计记录（含文件系统审计）将清除，不可恢复。'],
  ];
  for (const [sel, op, tip] of SYS_OPS) {
    document.querySelector(sel).addEventListener('click', async () => {
      if (!confirm(tip)) return;
      const drive = $('#sys-drive').value.trim().toUpperCase();
      const btn = document.querySelector(sel);
      btn.disabled = true;
      $sysOutput.textContent = '执行中…';
      try {
        const resp = await fetch('/api/system/' + op, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ drive }),
        });
        const data = await resp.json();
        $sysOutput.textContent = data.ok
          ? (data.output || '执行完成')
          : '执行失败：' + data.error + '\n提示：请以管理员身份运行本服务后重试';
      } catch (e) {
        $sysOutput.textContent = '请求失败：' + e.message;
      } finally {
        btn.disabled = false;
      }
    });
  }

  $checkAll.addEventListener('change', () => {
    $tbody.querySelectorAll('.row-check').forEach((b) => { b.checked = $checkAll.checked; });
  });

  $tbody.addEventListener('change', (e) => {
    if (e.target.classList.contains('row-check')) updateCheckAll();
  });

  $btnDelete.addEventListener('click', async () => {
    const ids = new Set(
      Array.from($tbody.querySelectorAll('.row-check:checked')).map((b) => b.dataset.id)
    );
    if (!ids.size) { toast('请先勾选要删除的记录'); return; }
    const items = state.items.filter((i) => ids.has(i.id));
    const deletable = items.filter((i) => i.deletable);
    if (!deletable.length) { toast('选中的条目都不可直接删除'); return; }
    if (!confirm(`确认删除 ${deletable.length} 条记录？\n${items.filter((i) => !i.deletable).length ? '另有不可直接删除的条目会被跳过。' : ''}\n此操作不可恢复！`)) return;

    $btnDelete.disabled = true;
    try {
      const resp = await fetch('/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: deletable }),
      });
      const data = await resp.json();
      if (!resp.ok) { toast(data.error || '删除失败'); return; }
      const okCount = data.results.filter((r) => r.ok).length;
      const lines = data.results.map((r) => (r.ok ? '✓ ' : '✗ ') + r.message).slice(0, 8);
      toast(`删除完成：成功 ${okCount}/${data.results.length}\n` + lines.join('\n') + (data.results.length > 8 ? '\n…' : ''), 8000);
      // 从列表移除已删除项
      const removed = new Set(data.results.filter((r) => r.ok).map((r) => r.id));
      state.items = state.items.filter((i) => !removed.has(i.id));
      state.total = state.items.length;
      state.truncated = false;
      render();
      updateCheckAll();
    } catch (e) {
      toast('删除请求失败: ' + e.message);
    } finally {
      $btnDelete.disabled = false;
    }
  });
})();

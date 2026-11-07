/* X3P WebDAV 客户端前端逻辑 —— 多服务器 + 批量下载 + 传输列表 */
(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const el = {
    // 顶部菜单
    navHome: $('#nav-home'),
    navSettings: $('#nav-settings'),
    navDownloads: $('#nav-downloads'),
    btnAdd: $('#btn-add'),
    appVersion: $('#app-version'),
    // 首页
    homePanel: $('#home-panel'),
    serverList: $('#server-list'),
    serverEmpty: $('#server-empty'),
    serverLoading: $('#server-loading'),
    // 编辑表单
    editPanel: $('#edit-panel'),
    editTitle: $('#edit-title'),
    serverForm: $('#server-form'),
    srvName: $('#srv-name'),
    srvUrl: $('#srv-url'),
    srvUser: $('#srv-user'),
    srvPass: $('#srv-pass'),
    btnTest: $('#btn-test'),
    btnSave: $('#btn-save'),
    btnCancelEdit: $('#btn-cancel-edit'),
    configMsg: $('#config-msg'),
    // 下载设置
    settingsPanel: $('#settings-panel'),
    setDir: $('#set-dir'),
    btnBrowseSetDir: $('#btn-browse-set-dir'),
    btnSaveDir: $('#btn-save-dir'),
    settingsMsg: $('#settings-msg'),
    // 传输列表页
    downloadsPanel: $('#downloads-panel'),
    activeDownloads: $('#active-downloads'),
    activeList: $('#active-list'),
    historyList: $('#history-list'),
    historyEmpty: $('#history-empty'),
    historyLoading: $('#history-loading'),
    btnClearHistory: $('#btn-clear-history'),
    // 浏览
    browserPanel: $('#browser-panel'),
    breadcrumb: $('#breadcrumb-path'),
    btnHome: $('#btn-home'),
    btnUp: $('#btn-up'),
    btnRefresh: $('#btn-refresh'),
    fileList: $('#file-list'),
    listEmpty: $('#list-empty'),
    listLoading: $('#list-loading'),
    // 批量操作
    batchBar: $('#batch-bar'),
    selectAll: $('#select-all'),
    batchCount: $('#batch-count'),
    btnBatchDownload: $('#btn-batch-download'),
    btnClearSelect: $('#btn-clear-select'),
    // 目录选择弹窗
    dirModal: $('#dir-modal'),
    dirClose: $('#dir-close'),
    dirTabPublic: $('#dir-tab-public'),
    dirTabHome: $('#dir-tab-home'),
    dirRoot: $('#dir-root'),
    dirCrumb: $('#dir-crumb'),
    dirList: $('#dir-list'),
    dirCurrent: $('#dir-current'),
    dirCancel: $('#dir-cancel'),
    dirOk: $('#dir-ok'),
    // 批量确认弹窗
    batchModal: $('#batch-modal'),
    batchClose: $('#batch-close'),
    batchNum: $('#batch-num'),
    batchFileList: $('#batch-file-list'),
    batchDir: $('#batch-dir'),
    btnBrowseBatchDir: $('#btn-browse-batch-dir'),
    batchCancel: $('#batch-cancel'),
    batchOk: $('#batch-ok'),
    // toast
    toast: $('#toast'),
  };

  // 状态
  let servers = [];
  let currentServer = null;
  let editingId = null;
  let currentPath = '';
  let configuredDownloadDir = ''; // 用户配置的下载目录（空表示未设置）
  let defaultDownloadDir = '';    // 后端默认下载目录（仅兜底提示用）
  let dirBrowsePath = '';         // 目录选择器当前相对路径
  let dirRootType = 'public';     // 目录选择器当前根：public | home
  let dirRootAbs = '/sata/public'; // 目录选择器当前根绝对路径
  let dirPickerTarget = null;     // 'set' | 'batch'
  let selectedItems = new Set();
  let currentItems = [];
  let batchQueue = [];
  let downloadHistory = [];       // 下载历史记录（用于标记已下载文件）
  // 进行中的下载任务（前端内存）：{ id, name, percent, received, total, status, message }
  const activeJobs = [];
  let activeTimer = null;

  // ---------------------------------------------------------------------
  // 工具
  // ---------------------------------------------------------------------
  function api(path, method, body) {
    const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opts.body = JSON.stringify(body);
    return fetch(path, opts).then(async (res) => {
      let data = null;
      try { data = await res.json(); } catch (e) { /* ignore */ }
      if (!res.ok) {
        const err = new Error((data && data.error) || ('请求失败 HTTP ' + res.status));
        err.code = data && data.code;
        err.status = res.status;
        throw err;
      }
      return data;
    });
  }

  function toast(msg, type) {
    el.toast.textContent = msg;
    el.toast.className = 'toast ' + (type || 'info');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.toast.classList.add('hidden'), 3000);
  }

  function showConfigMsg(msg, type) {
    el.configMsg.textContent = msg;
    el.configMsg.className = 'msg show ' + (type || 'info');
  }
  function hideConfigMsg() { el.configMsg.className = 'msg'; }

  function showSettingsMsg(msg, type) {
    el.settingsMsg.textContent = msg;
    el.settingsMsg.className = 'msg show ' + (type || 'info');
  }
  function hideSettingsMsg() { el.settingsMsg.className = 'msg'; }

  function fmtSize(bytes) {
    if (!bytes || bytes === 0) return '-';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0, n = bytes;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return n.toFixed(n >= 100 || i === 0 ? 0 : 1) + ' ' + units[i];
  }

  function fmtDate(s) {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    const pad = (x) => (x < 10 ? '0' + x : x);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function fmtDuration(ms) {
    if (ms === null || ms === undefined || isNaN(ms)) return '-';
    if (ms < 1000) return ms + ' 毫秒';
    const sec = Math.floor(ms / 1000);
    if (sec < 60) return sec + ' 秒';
    const min = Math.floor(sec / 60);
    const remainSec = sec % 60;
    if (min < 60) return min + ' 分 ' + remainSec + ' 秒';
    const hour = Math.floor(min / 60);
    return hour + ' 时 ' + (min % 60) + ' 分';
  }

  function friendlyError(err) {
    switch (err.code) {
      case 'auth_failed': return '认证失败：账号或密码错误';
      case 'forbidden': return '访问被拒绝：没有权限或防盗链/签名失效（HTTP 403）';
      case 'timeout': return '连接超时，请检查网络或服务器地址';
      case 'dns': return '无法解析服务器地址';
      case 'connection': return '连接失败：' + err.message.replace(/^连接失败[：:]/, '');
      case 'not_found': return '路径不存在';
      case 'no_config': return '尚未保存连接配置';
      default: return err.message || '未知错误';
    }
  }

  // ---------------------------------------------------------------------
  // 页面切换
  // ---------------------------------------------------------------------
  const PANELS = { home: 'homePanel', settings: 'settingsPanel', downloads: 'downloadsPanel', edit: 'editPanel', browser: 'browserPanel' };
  const NAVS = { home: 'navHome', settings: 'navSettings', downloads: 'navDownloads' };

  function showPanel(name) {
    Object.keys(PANELS).forEach((k) => el[PANELS[k]].classList.add('hidden'));
    el[PANELS[name]].classList.remove('hidden');
    Object.keys(NAVS).forEach((k) => el[NAVS[k]].classList.toggle('active', k === name));
    el.btnAdd.classList.toggle('hidden', name === 'edit');
  }

  function showHome() { showPanel('home'); loadServers(); }
  function showSettings() { showPanel('settings'); loadDownloadDir(); }
  function showDownloads() { showPanel('downloads'); renderActiveJobs(); loadHistory(); }
  function showEdit() { showPanel('edit'); }
  function showBrowser() { showPanel('browser'); }

  // ---------------------------------------------------------------------
  // 服务器列表
  // ---------------------------------------------------------------------
  async function loadServers() {
    el.serverEmpty.classList.add('hidden');
    el.serverLoading.classList.remove('hidden');
    try {
      const data = await api('/api/servers');
      servers = data.servers || [];
      renderServers();
    } catch (e) {
      el.serverLoading.classList.add('hidden');
      el.serverEmpty.textContent = '加载服务器列表失败：' + e.message;
      el.serverEmpty.classList.remove('hidden');
    }
  }

  function renderServers() {
    el.serverLoading.classList.add('hidden');
    el.serverList.innerHTML = '';
    if (!servers.length) {
      el.serverEmpty.classList.remove('hidden');
      return;
    }
    el.serverEmpty.classList.add('hidden');
    servers.forEach((srv) => {
      const card = document.createElement('div');
      card.className = 'server-card';
      const icon = document.createElement('div');
      icon.className = 'server-icon';
      icon.textContent = '☁️';
      const info = document.createElement('div');
      info.className = 'server-info';
      const name = document.createElement('div');
      name.className = 'server-name';
      name.textContent = srv.name || srv.baseUrl;
      const url = document.createElement('div');
      url.className = 'server-url';
      url.textContent = srv.baseUrl;
      url.title = srv.baseUrl;
      info.appendChild(name);
      info.appendChild(url);
      const actions = document.createElement('div');
      actions.className = 'server-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'btn btn-outline btn-sm';
      editBtn.textContent = '编辑';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openEdit(srv.id); });
      const delBtn = document.createElement('button');
      delBtn.className = 'btn btn-outline btn-sm danger';
      delBtn.textContent = '删除';
      delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteServer(srv); });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      card.appendChild(icon);
      card.appendChild(info);
      card.appendChild(actions);
      card.addEventListener('click', () => enterServer(srv));
      el.serverList.appendChild(card);
    });
  }

  async function enterServer(srv) {
    currentServer = srv;
    currentPath = '';
    selectedItems.clear();
    showBrowser();
    await loadList('');
  }

  async function deleteServer(srv) {
    if (!confirm(`确定删除服务器「${srv.name}」吗？`)) return;
    try {
      await api('/api/server/delete', 'POST', { id: srv.id });
      toast('已删除', 'ok');
      loadServers();
    } catch (e) {
      toast('删除失败：' + e.message, 'err');
    }
  }

  // ---------------------------------------------------------------------
  // 编辑/添加服务器
  // ---------------------------------------------------------------------
  el.btnAdd.addEventListener('click', () => openEdit(null));
  el.navHome.addEventListener('click', showHome);
  el.navSettings.addEventListener('click', showSettings);
  el.navDownloads.addEventListener('click', showDownloads);
  el.btnCancelEdit.addEventListener('click', () => showHome());

  function openEdit(id) {
    editingId = id;
    hideConfigMsg();
    el.serverForm.reset();
    el.srvPass.placeholder = 'WebDAV 密码';
    if (id) {
      el.editTitle.textContent = '编辑服务器';
      el.btnSave.textContent = '保存修改';
      api('/api/server?id=' + id).then((data) => {
        const s = data.server;
        el.srvName.value = s.name || '';
        el.srvUrl.value = s.baseUrl || '';
        el.srvUser.value = s.username || '';
        el.srvPass.value = '';
        el.srvPass.placeholder = '已保存（留空则不修改）';
      }).catch((e) => toast('加载失败：' + e.message, 'err'));
    } else {
      el.editTitle.textContent = '添加服务器';
      el.btnSave.textContent = '保存';
    }
    showEdit();
  }

  el.serverForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const baseUrl = el.srvUrl.value.trim();
    if (!baseUrl) { showConfigMsg('请填写服务器地址', 'err'); return; }
    const payload = { baseUrl, name: el.srvName.value.trim(), username: el.srvUser.value.trim(), password: el.srvPass.value };
    el.btnSave.disabled = true;
    el.btnSave.textContent = '保存中…';
    hideConfigMsg();
    try {
      if (editingId) {
        await api('/api/server/update', 'POST', Object.assign({ id: editingId }, payload));
        toast('已保存修改', 'ok');
      } else {
        await api('/api/server/add', 'POST', payload);
        toast('已添加服务器', 'ok');
      }
      showHome();
    } catch (err) {
      showConfigMsg(err.message, 'err');
    } finally {
      el.btnSave.disabled = false;
      el.btnSave.textContent = editingId ? '保存修改' : '保存';
    }
  });

  el.btnTest.addEventListener('click', async () => {
    const baseUrl = el.srvUrl.value.trim();
    if (!baseUrl) { showConfigMsg('请先填写服务器地址', 'err'); return; }
    el.btnTest.disabled = true;
    el.btnTest.textContent = '测试中…';
    hideConfigMsg();
    try {
      await api('/api/test', 'POST', { baseUrl, username: el.srvUser.value.trim(), password: el.srvPass.value });
      showConfigMsg('连接成功', 'ok');
      toast('连接成功', 'ok');
    } catch (err) {
      showConfigMsg(friendlyError(err), 'err');
    } finally {
      el.btnTest.disabled = false;
      el.btnTest.textContent = '测试连接';
    }
  });

  // ---------------------------------------------------------------------
  // 下载设置
  // ---------------------------------------------------------------------
  async function loadDownloadDir() {
    try {
      const data = await api('/api/config/download-dir');
      configuredDownloadDir = data.dir || '';
      defaultDownloadDir = data.defaultDir || '';
      el.setDir.value = configuredDownloadDir;
    } catch (e) { /* ignore */ }
  }

  el.btnSaveDir.addEventListener('click', async () => {
    const dir = el.setDir.value.trim();
    el.btnSaveDir.disabled = true;
    hideSettingsMsg();
    try {
      await api('/api/config/download-dir', 'POST', { dir });
      configuredDownloadDir = dir;
      showSettingsMsg('下载目录已保存', 'ok');
      toast('下载目录已保存', 'ok');
    } catch (e) {
      showSettingsMsg('保存失败：' + e.message, 'err');
    } finally {
      el.btnSaveDir.disabled = false;
    }
  });

  // 获取有效下载目录；未设置时返回空并提示
  function getDownloadDir() {
    return configuredDownloadDir || '';
  }

  // ---------------------------------------------------------------------
  // 目录浏览
  // ---------------------------------------------------------------------
  async function loadList(path) {
    currentPath = path || '';
    renderBreadcrumb(currentPath);
    el.fileList.innerHTML = '';
    el.listEmpty.classList.add('hidden');
    el.listLoading.classList.remove('hidden');
    selectedItems.clear();
    updateBatchBar();

    try {
      // 预加载下载历史，用于标记已下载文件
      if (!downloadHistory.length) {
        try { const h = await api('/api/download/history'); downloadHistory = h.history || []; } catch (e) { /* ignore */ }
      }
      const data = await api('/api/list', 'POST', { serverId: currentServer.id, path: currentPath });
      currentItems = data.items || [];
      renderList(currentItems);
    } catch (err) {
      currentItems = [];
      el.listLoading.classList.add('hidden');
      el.listEmpty.textContent = friendlyError(err);
      el.listEmpty.classList.remove('hidden');
    }
  }

  function renderList(items) {
    el.listLoading.classList.add('hidden');
    el.fileList.innerHTML = '';
    if (!items || items.length === 0) {
      el.listEmpty.textContent = '此目录为空';
      el.listEmpty.classList.remove('hidden');
      el.batchBar.classList.add('hidden');
      return;
    }
    el.listEmpty.classList.add('hidden');
    el.batchBar.classList.remove('hidden');

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'file-item';

      if (item.isDir) {
        const cbHolder = document.createElement('span');
        cbHolder.className = 'file-check disabled';
        row.appendChild(cbHolder);
      } else {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'file-check';
        cb.checked = selectedItems.has(item.name);
        cb.addEventListener('change', () => {
          if (cb.checked) selectedItems.add(item.name);
          else selectedItems.delete(item.name);
          updateBatchBar();
        });
        cb.addEventListener('click', (e) => e.stopPropagation());
        row.appendChild(cb);
      }

      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = item.isDir ? '📁' : iconForName(item.name);

      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = item.name;
      name.title = item.name;

      const size = document.createElement('span');
      size.className = 'file-size';
      size.textContent = item.isDir ? '' : fmtSize(item.size);

      const modified = document.createElement('span');
      modified.className = 'file-modified';
      modified.textContent = item.isDir ? '' : fmtDate(item.modified);

      row.appendChild(icon);
      row.appendChild(name);
      row.appendChild(size);
      row.appendChild(modified);

      // 标记已下载过的文件：高亮背景 + 显示最近一次下载时间
      if (!item.isDir) {
        const remotePath = joinPath(currentPath, item.name);
        const lastDl = findLastDownloadTime(remotePath);
        if (lastDl) {
          row.classList.add('downloaded');
          const dlTime = document.createElement('span');
          dlTime.className = 'file-dl-time';
          dlTime.textContent = '已下载 ' + fmtDate(lastDl);
          row.appendChild(dlTime);
        }
      }

      if (item.isDir) {
        row.addEventListener('click', () => loadList(joinPath(currentPath, item.name)));
      } else {
        row.addEventListener('click', () => {
          if (selectedItems.has(item.name)) selectedItems.delete(item.name);
          else selectedItems.add(item.name);
          const cb = row.querySelector('.file-check');
          if (cb) cb.checked = selectedItems.has(item.name);
          updateBatchBar();
        });
      }

      el.fileList.appendChild(row);
    });

    updateBatchBar();
  }

  function updateBatchBar() {
    const count = selectedItems.size;
    el.batchCount.textContent = '已选 ' + count + ' 项';
    el.batchBar.classList.toggle('hidden', count === 0 && !currentItems.some(i => !i.isDir));
    el.selectAll.checked = count > 0 && count === currentItems.filter(i => !i.isDir).length;
    el.btnBatchDownload.disabled = count === 0;
  }

  el.selectAll.addEventListener('change', () => {
    selectedItems.clear();
    if (el.selectAll.checked) {
      currentItems.filter(i => !i.isDir).forEach(i => selectedItems.add(i.name));
    }
    Array.from(el.fileList.querySelectorAll('input.file-check')).forEach((cb) => {
      cb.checked = selectedItems.has(cb.closest('.file-item').querySelector('.file-name').textContent);
    });
    updateBatchBar();
  });

  el.btnClearSelect.addEventListener('click', () => {
    selectedItems.clear();
    Array.from(el.fileList.querySelectorAll('input.file-check')).forEach((cb) => { cb.checked = false; });
    el.selectAll.checked = false;
    updateBatchBar();
  });

  function iconForName(name) {
    const ext = name.split('.').pop().toLowerCase();
    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) return '🖼️';
    if (['mp3', 'wav', 'flac', 'aac', 'ogg'].includes(ext)) return '🎵';
    if (['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv'].includes(ext)) return '🎬';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    if (['pdf'].includes(ext)) return '📄';
    if (['doc', 'docx'].includes(ext)) return '📝';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
    if (['ppt', 'pptx'].includes(ext)) return '📑';
    if (['txt', 'md', 'log'].includes(ext)) return '📃';
    return '📄';
  }

  function joinPath(base, name) {
    if (!base) return name;
    return base.replace(/\/+$/, '') + '/' + name;
  }

  function renderBreadcrumb(path) {
    el.breadcrumb.innerHTML = '';
    if (!path) return;
    const segs = path.split('/').filter(Boolean);
    let acc = '';
    segs.forEach((seg, i) => {
      acc = acc ? acc + '/' + seg : seg;
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = ' / ';
        el.breadcrumb.appendChild(sep);
      }
      const s = document.createElement('span');
      s.className = 'crumb-seg';
      s.textContent = seg;
      s.addEventListener('click', () => loadList(acc));
      el.breadcrumb.appendChild(s);
    });
  }

  el.btnHome.addEventListener('click', () => loadList(''));
  el.btnRefresh.addEventListener('click', () => loadList(currentPath));
  el.btnUp.addEventListener('click', () => {
    const up = parentPath(currentPath);
    if (up === null) return;
    loadList(up);
  });

  function parentPath(path) {
    if (!path) return null;
    const parts = path.split('/').filter(Boolean);
    if (parts.length === 0) return null;
    parts.pop();
    return parts.join('/');
  }

  // ---------------------------------------------------------------------
  // 下载（单个 + 批量），进度在传输列表页展示
  // ---------------------------------------------------------------------
  function addActiveJob(job) {
    activeJobs.unshift(job);
    renderActiveJobs();
  }

  function removeActiveJob(id) {
    const idx = activeJobs.findIndex(j => j.id === id);
    if (idx >= 0) activeJobs.splice(idx, 1);
    renderActiveJobs();
  }

  function renderActiveJobs() {
    el.activeList.innerHTML = '';
    if (activeJobs.length === 0) {
      el.activeDownloads.classList.add('hidden');
      return;
    }
    el.activeDownloads.classList.remove('hidden');
    activeJobs.forEach((job) => {
      const row = document.createElement('div');
      row.className = 'active-item';

      const head = document.createElement('div');
      head.className = 'active-head';
      const name = document.createElement('div');
      name.className = 'active-name';
      name.textContent = job.name;
      name.title = job.name;
      head.appendChild(name);

      // 操作按钮区（进行中：暂停/继续、取消；失败/取消：移除）
      const ops = document.createElement('div');
      ops.className = 'active-ops';
      if (job.status === 'active') {
        const pauseBtn = document.createElement('button');
        pauseBtn.className = 'btn btn-outline btn-sm';
        pauseBtn.textContent = job.paused ? '继续' : '暂停';
        pauseBtn.addEventListener('click', (e) => { e.stopPropagation(); togglePause(job); });
        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'btn btn-outline btn-sm danger';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', (e) => { e.stopPropagation(); cancelJob(job); });
        ops.appendChild(pauseBtn);
        ops.appendChild(cancelBtn);
      } else if (job.status === 'error' || job.status === 'canceled') {
        // 失败/已取消的任务可手动移除
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-outline btn-sm';
        removeBtn.textContent = '移除';
        removeBtn.addEventListener('click', (e) => { e.stopPropagation(); removeActiveJob(job.id); });
        ops.appendChild(removeBtn);
      }
      head.appendChild(ops);
      row.appendChild(head);

      const pct = document.createElement('div');
      pct.className = 'active-pct';
      if (job.paused) pct.classList.add('paused');

      const pctVal = document.createElement('span');
      pctVal.className = 'active-pct-val';
      pctVal.textContent = job.paused ? '已暂停 · ' + job.percent + '%' : job.percent + '%';
      pct.appendChild(pctVal);

      // 实时速度（紧跟百分比右侧）
      if (!job.paused && job.status === 'active' && job.speed > 0) {
        const speed = document.createElement('span');
        speed.className = 'active-speed';
        speed.textContent = fmtSize(job.speed) + '/s';
        pct.appendChild(speed);
      }

      const barWrap = document.createElement('div');
      barWrap.className = 'progress';
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = job.percent + '%';
      if (job.status === 'error') bar.classList.add('error');
      if (job.status === 'done') bar.classList.add('done');
      if (job.paused) bar.classList.add('paused');
      barWrap.appendChild(bar);
      const detail = document.createElement('div');
      detail.className = 'active-detail';
      detail.textContent = job.message || '';
      row.appendChild(pct);
      row.appendChild(barWrap);
      row.appendChild(detail);
      el.activeList.appendChild(row);
    });
  }

  // 轮询单个下载进度，更新 activeJobs 并完成后写入历史
  function pollJob(downloadId, jobName, job, onFinish) {
    let lastReceived = 0;
    let lastTime = Date.now();
    const timer = setInterval(async () => {
      try {
        const p = await api('/api/download/progress?id=' + downloadId);
        // 取消状态
        if (p.canceled) {
          clearInterval(timer);
          job.status = 'canceled';
          job.percent = 0;
          job.speed = 0;
          job.message = '已取消';
          renderActiveJobs();
          if (onFinish) onFinish(false);
          return;
        }
        if (p.error) {
          clearInterval(timer);
          job.status = 'error';
          job.percent = 0;
          job.speed = 0;
          job.message = '下载失败：' + (p.error.message || '');
          renderActiveJobs();
          toast('下载失败：' + jobName, 'err');
          if (onFinish) onFinish(false);
          return;
        }
        // 同步暂停状态（仅在后台状态变化时覆盖，避免与用户点击冲突）
        job.paused = !!p.paused;
        const total = p.total || 0;
        const received = p.received || 0;
        const percent = total > 0 ? Math.floor((received / total) * 100) : 0;
        job.percent = percent;
        // 计算实时速度（字节/秒）
        const now = Date.now();
        const dt = (now - lastTime) / 1000;
        if (dt > 0 && received >= lastReceived && !job.paused) {
          job.speed = Math.round((received - lastReceived) / dt);
        } else if (job.paused) {
          job.speed = 0;
        }
        lastReceived = received;
        lastTime = now;
        if (job.paused) {
          job.message = `已暂停（${fmtSize(received)} / ${fmtSize(total)}）`;
        } else {
          job.message = total > 0 ? `${fmtSize(received)} / ${fmtSize(total)}` : `已下载 ${fmtSize(received)}`;
        }
        renderActiveJobs();

        if (p.done) {
          clearInterval(timer);
          job.status = 'done';
          job.percent = 100;
          job.speed = 0;
          job.message = `完成（用时 ${fmtDuration(p.durationMs)}）`;
          renderActiveJobs();
          toast('下载完成：' + (p.fileName || jobName), 'ok');
          // 完成后稍后从"进行中"移除
          setTimeout(() => removeActiveJob(job.id), 3000);
          if (onFinish) onFinish(true);
        }
      } catch (err) {
        clearInterval(timer);
        job.status = 'error';
        job.message = '下载失败：' + err.message;
        renderActiveJobs();
        if (onFinish) onFinish(false);
      }
    }, 300);
  }

  // 暂停/继续（先本地立即生效，再异步同步后端）
  function togglePause(job) {
    if (job.status !== 'active') return;
    const targetPaused = !job.paused;
    // 本地立即切换状态，UI 即时反馈
    job.paused = targetPaused;
    if (targetPaused) {
      job.speed = 0;
      job.message = '正在暂停…';
    } else {
      job.message = '正在继续…';
    }
    renderActiveJobs();
    // 异步请求后端
    const endpoint = targetPaused ? '/api/download/pause' : '/api/download/resume';
    api(endpoint, 'POST', { id: job.downloadId }).then(() => {
      if (targetPaused) toast('已暂停下载：' + job.name, 'info');
      else toast('已继续下载：' + job.name, 'info');
    }).catch((err) => {
      // 失败回滚
      job.paused = !targetPaused;
      toast('操作失败：' + err.message, 'err');
      renderActiveJobs();
    });
  }

  // 取消
  async function cancelJob(job) {
    if (!confirm(`确定取消下载「${job.name}」吗？`)) return;
    try {
      await api('/api/download/cancel', 'POST', { id: job.downloadId });
      job.status = 'canceled';
      job.speed = 0;
      job.message = '已取消';
      renderActiveJobs();
    } catch (err) {
      toast('取消失败：' + err.message, 'err');
    }
  }

  // 单个文件下载
  async function downloadSingle(item) {
    const dir = getDownloadDir();
    if (!dir) {
      toast('请先在「下载设置」中设置下载目录', 'err');
      showSettings();
      return;
    }
    const job = { id: 's' + Date.now(), name: item.name, percent: 0, received: 0, total: 0, status: 'active', message: '正在发起…', paused: false, downloadId: null, speed: 0 };
    addActiveJob(job);
    toast('已开始下载，进度可在「传输列表」查看', 'info');
    try {
      const remotePath = joinPath(currentPath, item.name);
      const res = await api('/api/download', 'POST', {
        serverId: currentServer.id, path: remotePath, fileName: item.name, localDir: dir,
      });
      job.downloadId = res.downloadId;
      pollJob(res.downloadId, item.name, job);
    } catch (err) {
      job.status = 'error';
      job.message = '下载失败：' + friendlyError(err);
      renderActiveJobs();
    }
  }

  // 批量下载
  async function startBatchDownload(items, dir) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const job = { id: 'b' + Date.now() + '_' + i, name: item.name, percent: 0, received: 0, total: 0, status: 'active', message: '排队中…', paused: false, downloadId: null, speed: 0 };
      addActiveJob(job);
      const remotePath = joinPath(currentPath, item.name);
      try {
        const res = await api('/api/download', 'POST', {
          serverId: currentServer.id, path: remotePath, fileName: item.name, localDir: dir,
        });
        job.downloadId = res.downloadId;
        await new Promise((resolve) => {
          pollJob(res.downloadId, item.name, job, (ok) => resolve(ok));
        });
      } catch (err) {
        job.status = 'error';
        job.message = '下载失败：' + friendlyError(err);
        renderActiveJobs();
      }
    }
    toast('批量下载完成', 'ok');
    await loadHistory();
    // 若仍在浏览页，刷新列表以更新「已下载」标记
    if (!el.browserPanel.classList.contains('hidden') && currentItems.length) {
      renderList(currentItems);
    }
  }

  // ---------------------------------------------------------------------
  // 批量下载确认弹窗
  // ---------------------------------------------------------------------
  el.btnBatchDownload.addEventListener('click', () => {
    const items = currentItems.filter(i => !i.isDir && selectedItems.has(i.name));
    if (!items.length) { toast('请先选择要下载的文件', 'err'); return; }
    batchQueue = items;
    el.batchNum.textContent = items.length;
    el.batchFileList.innerHTML = '';
    items.forEach((item) => {
      const line = document.createElement('div');
      line.className = 'batch-file-line';
      line.textContent = item.name;
      el.batchFileList.appendChild(line);
    });
    el.batchDir.value = getDownloadDir();
    el.batchModal.classList.remove('hidden');
  });

  function closeBatchModal() { el.batchModal.classList.add('hidden'); }
  el.batchClose.addEventListener('click', closeBatchModal);
  el.batchCancel.addEventListener('click', closeBatchModal);
  el.batchModal.querySelector('.modal-mask').addEventListener('click', closeBatchModal);

  el.batchOk.addEventListener('click', async () => {
    const dir = el.batchDir.value.trim() || getDownloadDir();
    if (!dir) {
      toast('请先设置下载目录（可在「下载设置」页配置）', 'err');
      closeBatchModal();
      showSettings();
      return;
    }
    closeBatchModal();
    const items = batchQueue;
    batchQueue = [];
    selectedItems.clear();
    updateBatchBar();
    // 提醒：下载已开始，进度可在传输列表查看
    toast(`已开始下载 ${items.length} 个文件，进度可在「传输列表」查看`, 'info');
    await startBatchDownload(items, dir);
  });

  // ---------------------------------------------------------------------
  // 传输列表：历史记录
  // ---------------------------------------------------------------------
  async function loadHistory() {
    el.historyEmpty.classList.add('hidden');
    el.historyLoading.classList.remove('hidden');
    el.historyList.innerHTML = '';
    try {
      const data = await api('/api/download/history');
      downloadHistory = data.history || [];
      renderHistory(downloadHistory);
    } catch (e) {
      el.historyLoading.classList.add('hidden');
      el.historyEmpty.textContent = '加载失败：' + e.message;
      el.historyEmpty.classList.remove('hidden');
    }
  }

  // 根据远程路径查找该文件最近一次的下载时间（返回 ISO 字符串或 null）
  function findLastDownloadTime(remotePath) {
    if (!downloadHistory || !downloadHistory.length) return null;
    for (let i = 0; i < downloadHistory.length; i++) {
      const rec = downloadHistory[i];
      if (rec && rec.remotePath === remotePath && rec.finishedAt) {
        return rec.finishedAt;
      }
    }
    return null;
  }

  function renderHistory(history) {
    el.historyLoading.classList.add('hidden');
    el.historyList.innerHTML = '';
    if (!history.length) {
      el.historyEmpty.textContent = '还没有下载记录';
      el.historyEmpty.classList.remove('hidden');
      return;
    }
    el.historyEmpty.classList.add('hidden');
    history.forEach((rec) => {
      const row = document.createElement('div');
      row.className = 'history-item';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = iconForName(rec.fileName || '');
      const info = document.createElement('div');
      info.className = 'history-info';
      const name = document.createElement('div');
      name.className = 'history-name';
      name.textContent = rec.fileName || '未知文件';
      name.title = rec.fileName;
      const meta = document.createElement('div');
      meta.className = 'history-meta';
      const size = document.createElement('span');
      size.textContent = fmtSize(rec.size);
      const from = document.createElement('span');
      from.textContent = rec.sourceServer ? ('来自 ' + rec.sourceServer) : '';
      const time = document.createElement('span');
      time.textContent = rec.finishedAt ? ('完成于 ' + fmtDate(rec.finishedAt)) : '';
      const dur = document.createElement('span');
      dur.textContent = '用时 ' + fmtDuration(rec.durationMs);
      [size, from, time, dur].forEach((s) => { if (s.textContent) meta.appendChild(s); });
      // 本地保存目录
      const dir = document.createElement('span');
      dir.className = 'history-dir';
      dir.textContent = rec.destDir ? ('本地：' + rec.destDir) : '';
      dir.title = rec.destDir || '';
      if (dir.textContent) meta.appendChild(dir);
      info.appendChild(name);
      info.appendChild(meta);
      row.appendChild(icon);
      row.appendChild(info);
      el.historyList.appendChild(row);
    });
  }

  el.btnClearHistory.addEventListener('click', async () => {
    if (!confirm('确定清空下载记录列表吗？（不会删除本地文件）')) return;
    try {
      await api('/api/download/history/clear', 'POST', { deleteFiles: false });
      toast('已清空列表', 'ok');
      loadHistory();
    } catch (e) {
      toast('清空失败：' + e.message, 'err');
    }
  });

  // ---------------------------------------------------------------------
  // 目录选择器（支持公共目录 / 我的文件两个根）
  // ---------------------------------------------------------------------
  el.btnBrowseSetDir.addEventListener('click', () => openDirPicker('set'));
  el.btnBrowseBatchDir.addEventListener('click', () => openDirPicker('batch'));

  function openDirPicker(target) {
    dirPickerTarget = target;
    dirBrowsePath = '';
    dirRootType = 'public';
    dirRootAbs = '/sata/public';
    updateDirTabs();
    el.dirModal.classList.remove('hidden');
    loadDirs('');
  }

  function closeDirPicker() {
    el.dirModal.classList.add('hidden');
    dirPickerTarget = null;
  }

  function updateDirTabs() {
    el.dirTabPublic.classList.toggle('active', dirRootType === 'public');
    el.dirTabHome.classList.toggle('active', dirRootType === 'home');
  }

  el.dirTabPublic.addEventListener('click', () => { dirRootType = 'public'; dirBrowsePath = ''; updateDirTabs(); loadDirs(''); });
  el.dirTabHome.addEventListener('click', () => { dirRootType = 'home'; dirBrowsePath = ''; updateDirTabs(); loadDirs(''); });

  async function loadDirs(relPath) {
    dirBrowsePath = relPath || '';
    renderDirCrumb(dirBrowsePath);
    el.dirList.innerHTML = '<div class="loading">加载中…</div>';
    try {
      const data = await api('/api/local/dirs?root=' + dirRootType + '&path=' + encodeURIComponent(dirBrowsePath));
      if (data.root) dirRootAbs = data.root;
      renderDirList(data.dirs || []);
    } catch (e) {
      el.dirList.innerHTML = '<div class="empty">加载失败：' + e.message + '</div>';
    }
  }

  function renderDirList(dirs) {
    el.dirList.innerHTML = '';
    if (!dirs.length) {
      el.dirList.innerHTML = '<div class="empty">此目录下没有子目录</div>';
    }
    dirs.forEach((d) => {
      const row = document.createElement('div');
      row.className = 'dir-item';
      const icon = document.createElement('span');
      icon.className = 'file-icon';
      icon.textContent = '📁';
      const name = document.createElement('span');
      name.className = 'file-name';
      name.textContent = d.name;
      row.appendChild(icon);
      row.appendChild(name);
      row.addEventListener('click', () => loadDirs(d.path));
      el.dirList.appendChild(row);
    });
    el.dirCurrent.textContent = dirRootAbs + (dirBrowsePath ? '/' + dirBrowsePath : '');
  }

  function renderDirCrumb(relPath) {
    el.dirCrumb.innerHTML = '';
    const segs = relPath.split('/').filter(Boolean);
    let acc = '';
    segs.forEach((seg, i) => {
      acc = acc ? acc + '/' + seg : seg;
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = ' / ';
        el.dirCrumb.appendChild(sep);
      }
      const s = document.createElement('span');
      s.className = 'crumb-seg';
      s.textContent = seg;
      s.addEventListener('click', () => loadDirs(acc));
      el.dirCrumb.appendChild(s);
    });
  }

  el.dirRoot.addEventListener('click', () => loadDirs(''));
  el.dirClose.addEventListener('click', closeDirPicker);
  el.dirCancel.addEventListener('click', closeDirPicker);
  el.dirModal.querySelector('.modal-mask').addEventListener('click', closeDirPicker);

  el.dirOk.addEventListener('click', () => {
    const full = dirRootAbs + (dirBrowsePath ? '/' + dirBrowsePath : '');
    if (dirPickerTarget === 'set') {
      el.setDir.value = full;
    } else if (dirPickerTarget === 'batch') {
      el.batchDir.value = full;
    }
    closeDirPicker();
  });

  // ---------------------------------------------------------------------
  // 版本角标：与 X3P 应用中心同源（app/conf.js），失败时保留页面内兜底值
  // ---------------------------------------------------------------------
  async function loadVersion() {
    if (!el.appVersion) return;
    try {
      const data = await api('/api/version');
      const v = data && data.version;
      if (v && v.ver) {
        el.appVersion.textContent = 'v' + v.ver;
        el.appVersion.title = '当前应用版本 v' + v.ver +
          (v.verno ? '（内部版本号 ' + v.verno + '）' : '');
      }
    } catch (e) { /* 版本接口不可用时不打扰用户 */ }
  }

  // ---------------------------------------------------------------------
  // 初始化
  // ---------------------------------------------------------------------
  function init() {
    // 顶部版本角标
    loadVersion();
    // 预加载下载目录配置
    loadDownloadDir();
    showHome();
  }

  init();
})();

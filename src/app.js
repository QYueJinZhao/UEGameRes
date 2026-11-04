(function () {
  'use strict';

  var CORE = window.UEHUB_CORE;
  if (!CORE) {
    showFatal('数据未加载：缺少 data/core.js。请运行 node scripts/build.js，并确保 data/ 与 index.html 在同一目录。');
    return;
  }

  var META = CORE.meta || {};
  var STATS = CORE.stats || {};
  var COUNTS = CORE.counts || {};
  var SOURCES = CORE.sources || [];
  var CATS = CORE.categories || { resource: [], tool: [] };
  var CAT_MAP = {};
  CATS.resource.concat(CATS.tool).forEach(function (c) { CAT_MAP[c.id] = c; });

  var SHARDS = {
    resources: ['data/resources.js', 'UEHUB_RESOURCES'],
    tools: ['data/tools.js', 'UEHUB_TOOLS'],
    bilibili: ['data/bilibili.js', 'UEHUB_BILI'],
    pending: ['data/pending.js', 'UEHUB_PENDING'],
    github: ['data/github.js', 'UEHUB_GITHUB']
  };

  var ROUTES = {
    resourceFree: '#/resources/free',
    resourcePaid: '#/resources/paid',
    toolsFree: '#/tools/free',
    toolsPaid: '#/tools/paid',
    github: '#/github',
    githubStale: '#/github/stale',
    biliVerified: '#/bilibili/verified',
    biliPending: '#/bilibili/pending',
    biliPaid: '#/bilibili/paid',
    biliRemoved: '#/bilibili/removed',
    biliUnverifiable: '#/bilibili/unverifiable',
    listPendingImages: '#/lists/pending-images',
    listPending: '#/lists/pending',
    listRemoved: '#/lists/removed'
  };

  var BILI_STATUS_TEXT = {
    verified: '已核实', pending: '待核实', dead: '失效', paid: '已收费',
    removed: '已下架', unverifiable: '查过但无法确认'
  };
  var BILI_STATUS_CLASS = {
    verified: 'ok', pending: 'warn', dead: 'bad', paid: 'paid', removed: 'removed', unverifiable: 'unknown'
  };

  var VIEW_MODES = ['grid', 'list'];
  var VIEW_MODE_KEY = 'uehub-view';
  var viewMode = readViewMode();

  var shardCache = {};
  var shardVersion = {};
  var scrollCache = {};
  var filterCache = {};
  var currentBase = '';
  var lastLoaded = {};

  var $ = function (id) { return document.getElementById(id); };

  function readViewMode() {
    try {
      var v = localStorage.getItem(VIEW_MODE_KEY);
      return VIEW_MODES.indexOf(v) > -1 ? v : 'grid';
    } catch (e) { return 'grid'; }
  }

  function saveViewMode() {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch (e) { /* 隐私模式下忽略 */ }
  }

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function showFatal(msg) {
    var box = document.getElementById('appError');
    if (!box) { document.body.innerHTML = '<div style="padding:24px;font-family:sans-serif">' + msg + '</div>'; return; }
    box.hidden = false;
    box.innerHTML = '<b>页面数据加载失败</b><br>' + esc(msg);
  }

  function loadShard(name) {
    if (shardCache[name]) return shardCache[name];
    shardCache[name] = new Promise(function (resolve, reject) {
      var meta = SHARDS[name];
      var s = document.createElement('script');
      s.src = meta[0];
      s.async = true;
      s.onload = function () {
        var data = window[meta[1]];
        if (!data) { reject(new Error('分片 ' + meta[0] + ' 已加载但未注册 ' + meta[1])); return; }
        shardVersion[name] = data.version || '未获取';
        if (data.version && data.version !== CORE.version) {
          $('status').textContent = '提示：' + meta[0] + ' 版本 ' + data.version + '，与 core ' + CORE.version + ' 不一致，请重新运行 node scripts/build.js。';
        }
        resolve(data);
      };
      s.onerror = function () { reject(new Error('无法加载 ' + meta[0] + '（file:// 下请确认文件存在且在 index.html 同级目录）')); };
      document.head.appendChild(s);
    });
    shardCache[name].catch(function () { delete shardCache[name]; });
    return shardCache[name];
  }

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url || ''; }
  }

  function licenseGroup(license) {
    var s = (license || '').toLowerCase();
    if (s.indexOf('cc0') > -1 || s.indexOf('public domain') > -1) return 'cc0';
    if (s.indexOf('cc-by') > -1 || s.indexOf('oga-by') > -1 || s.indexOf('署名') > -1) return 'attr';
    if (s.indexOf('未获取') > -1 || s.indexOf('unknown') > -1 || s.indexOf('未声明') > -1) return 'unknown';
    if (s.indexOf('gpl') > -1 || s.indexOf('agpl') > -1) return 'copyleft';
    return 'oss';
  }

  function licenseBadge(license) {
    var g = licenseGroup(license);
    var text = { cc0: 'CC0', oss: '开源许可', attr: '需署名', unknown: '许可未获取', copyleft: 'GPL/AGPL 传染风险' }[g];
    return '<span class="badge lic-' + g + '" title="' + esc(license) + '">' + text + '</span>';
  }

  function engineBucket(engine) {
    var s = engine || '';
    if (/未获取/.test(s)) return 'unknown';
    if (/通用|可导入/.test(s)) return 'generic';
    var ue4 = /UE\s*4/.test(s);
    var ue5 = /UE\s*5/.test(s);
    if (ue4 && ue5) return 'both';
    if (ue5) return 'ue5';
    if (ue4) return 'ue4';
    return 'other';
  }

  function engineBadge(engine) {
    var b = engineBucket(engine);
    var text = { ue5: 'UE5', ue4: 'UE4', both: 'UE4–UE5', generic: '通用', unknown: '引擎未获取', other: '其他版本' }[b];
    return '<span class="badge engine" title="' + esc(engine) + '">' + text + '</span>';
  }

  function sourceName(x) {
    var host = hostOf(x.source || '').toLowerCase();
    if (host === 'github.com' || host.slice(-11) === '.github.com') return 'GitHub';
    if (host === 'fab.com' || host.slice(-8) === '.fab.com') {
      var tags = x.tags || [];
      if (tags.indexOf('Epic Games') > -1 || (x.extra && x.extra.epic)) return 'Epic 官方';
      if (tags.join('|').indexOf('Quixel') > -1) return 'Quixel';
      return 'Fab';
    }
    return (x.tags || [])[0] || '其他来源';
  }

  function fmtNum(n) {
    if (n == null || isNaN(n)) return '未获取';
    if (n >= 100000000) return (n / 100000000).toFixed(1) + ' 亿';
    if (n >= 10000) return (n / 10000).toFixed(1) + ' 万';
    return String(n);
  }

  function fmtPrice(price) {
    if (price == null || isNaN(price)) return '价格未获取';
    var n = Math.round(price * 100) / 100;
    return '¥' + n.toFixed(2).replace(/\.00$/, '');
  }

  function metaLine(x) {
    var f = x.format || '未获取';
    var s = x.size || '未获取';
    if (f === '未获取' && s === '未获取') return '格式 / 体积：未获取';
    return '格式：' + esc(f) + ' · 体积：' + esc(s);
  }

  function scoreHTML(x) {
    if (x.rating != null) {
      return '<span class="star">★</span> ' + Number(x.rating).toFixed(1) +
        (x.reviews != null ? ' <span class="rev">/ ' + x.reviews + ' 条评价</span>' : ' <span class="rev">/ 评价数未获取</span>');
    }
    if (x.extra && x.extra.stars != null) {
      return '<span class="star">★</span> ' + fmtNum(x.extra.stars) + ' <span class="rev">stars</span>' +
        (x.extra.reviews != null ? ' <span class="rev">/ ' + x.extra.reviews + ' 条评价</span>' : '');
    }
    return '<span class="none">评分未获取</span>';
  }

  function cardHTML(x) {
    var cat = CAT_MAP[x.category] || { name: x.category };
    var isFree = x.priceType === 'free';
    var priceText = isFree ? '免费' : fmtPrice(x.price);
    var img = x.image ? '<img loading="lazy" src="' + esc(x.image) + '" alt="' + esc(x.name) + ' 截图">' : '';
    var thumbClass = x.image ? 'thumb' : 'thumb broken';
    var extraBadges = '';
    if (x.extra && x.extra.archived) extraBadges += '<span class="badge archived">已归档</span>';
    if (!isFree && x.reviews != null && x.reviews < 10) extraBadges += '<span class="badge low">样本少</span>';
    var sourceLink = x.source && x.source !== x.obtain
      ? '<a class="btn btn-ghost" href="' + esc(x.source) + '" target="_blank" rel="noopener noreferrer">来源页</a>' : '';
    var gh = (x.extra && x.extra.github) ? githubMetaRow(x) : '';
    return '<article class="card" id="item-' + esc(x.id) + '">' +
      '<div class="' + thumbClass + '">' + img +
        '<span class="price-tag ' + (isFree ? 'free' : '') + '">' + esc(priceText) + '</span></div>' +
      '<div class="card-body">' +
        '<h3>' + esc(x.name) + '</h3>' +
        '<div class="brandline"><span>' + esc(cat.name) + '</span><span>·</span><span>' + esc(x.subcategory) + '</span>' +
          '<span>·</span><span>' + esc(sourceName(x)) + '</span></div>' +
        '<div class="badge-row">' + licenseBadge(x.license) + engineBadge(x.engine) + extraBadges + '</div>' +
        '<div class="score">' + scoreHTML(x) + '</div>' +
        gh +
        '<div class="meta-line">' + metaLine(x) + '</div>' +
        '<div class="notes" title="' + esc(x.notes) + '">' + esc(x.notes) + '</div>' +
        '<details class="info"><summary>完整字段</summary><dl>' +
          '<dt>许可</dt><dd>' + esc(x.license) + '</dd>' +
          '<dt>引擎</dt><dd>' + esc(x.engine) + '</dd>' +
          '<dt>格式</dt><dd>' + esc(x.format) + '</dd>' +
          '<dt>体积</dt><dd>' + esc(x.size) + '</dd>' +
          '<dt>来源</dt><dd><a href="' + esc(x.source) + '" target="_blank" rel="noopener noreferrer">' + esc(hostOf(x.source)) + '</a></dd>' +
          '<dt>抓取</dt><dd>' + esc(x.verified) + '</dd>' +
          '<dt>标签</dt><dd>' + esc((x.tags || []).join(' / ') || '未获取') + '</dd>' +
          '<dt>备注</dt><dd>' + esc(x.notes) + '</dd></dl></details>' +
        '<div class="links">' +
          '<a class="btn btn-primary" href="' + esc(x.obtain) + '" target="_blank" rel="noopener noreferrer">获取 / 下载 →</a>' +
          sourceLink +
        '</div></div></article>';
  }

  function githubMetaRow(x) {
    var e = x.extra || {};
    var bits = [];
    if (e.stars != null) bits.push('★ ' + fmtNum(e.stars) + ' stars');
    if (e.forks != null) bits.push('⑂ ' + fmtNum(e.forks) + ' forks');
    if (e.openIssues != null) bits.push('Issues ' + e.openIssues);
    if (e.lastRelease && e.lastRelease !== '未获取') bits.push('Release ' + esc(e.lastRelease));
    if (e.pushedAt) bits.push('提交 ' + esc(e.pushedAt));
    return '<div class="gh-meta">' + bits.join(' · ') + '</div>' +
      '<div class="gh-meta">安装：' + esc(e.install || '未获取') + ' · UE：' + esc(e.ueVersion || '未获取') +
      ' · 文档：' + (e.hasDocs ? '有' : '未获取') + '</div>';
  }

  function ghBadge(g) {
    var tier = g.popularityTier || '';
    var cls = tier === 'archived' ? 'archived' : tier === 'stale-popular' ? 'stale-hot' : tier === 'low-popular' ? 'low' : 'ok';
    return '<span class="badge gh-' + cls + '">' + esc(g.badge || '未获取') + '</span>';
  }

  function ghCardHTML(g) {
    var img = g.image ? '<img loading="lazy" src="' + esc(g.image) + '" alt="' + esc(g.repo) + ' 预览图">' : '';
    var risk = g.licenseRisk && g.licenseRisk !== '无'
      ? '<div class="risk">许可风险：' + esc(g.licenseRisk) + '</div>' : '';
    return '<article class="card gh-card" id="item-' + esc(g.id) + '">' +
      '<div class="' + (g.image ? 'thumb' : 'thumb broken') + '">' + img +
        '<span class="price-tag free">开源</span></div>' +
      '<div class="card-body">' +
        '<h3>' + esc(g.name || g.repo) + '</h3>' +
        '<div class="brandline"><span>' + esc(g.group) + '</span><span>·</span><span>' + esc(g.repo) + '</span></div>' +
        '<div class="badge-row">' + ghBadge(g) + licenseBadge(g.license) +
          '<span class="badge engine">' + esc(g.ueVersion || 'UE 未获取') + '</span></div>' +
        '<div class="score"><span class="star">★</span> ' + fmtNum(g.stars) + ' <span class="rev">stars</span>' +
          ' · <span class="rev">' + fmtNum(g.forks) + ' forks</span>' +
          (g.openIssues != null ? ' · <span class="rev">' + g.openIssues + ' open issues</span>' : '') + '</div>' +
        '<div class="gh-meta">最近提交 ' + esc(g.pushedAt) + ' · 最近 release ' + esc(g.lastRelease || '未获取') +
          ' · 安装 ' + esc(g.install || '未获取') + ' · 文档 ' + (g.hasDocs ? '有' : '未获取') + '</div>' +
        '<div class="notes" title="' + esc(g.description) + '">' + esc(g.description) + '</div>' +
        risk +
        '<div class="links"><a class="btn btn-primary" href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">打开 GitHub →</a></div>' +
      '</div></article>';
  }

  function biliStatusBadge(status) {
    return '<span class="bili-status ' + (BILI_STATUS_CLASS[status] || '') + '">' +
      (BILI_STATUS_TEXT[status] || esc(status)) + '</span>';
  }

  function biliKindBadge(r) {
    var freeText = r.status === 'paid' ? '已收费' : r.status === 'removed' ? '已下架'
      : r.status === 'unverifiable' ? '无法确认' : (r.free ? '免费' : '免费 / 未知');
    return '<span class="badge bili-type">' + esc(r.type || '未分类') + '</span>' +
      '<span class="badge ' + (r.free ? 'lic-cc0' : 'lic-oss') + '">' + freeText + '</span>' +
      (r.thirdParty ? '<span class="bili-third-badge">第三方链接，未核实安全</span>' : '');
  }

  function biliSourceLinks(r) {
    if (!r.videos || !r.videos.length) return '<span class="none">未获取 B 站来源</span>';
    return r.videos.map(function (v) {
      return '<a class="bili-src" href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer" title="' +
        esc(v.title) + '">' + esc(v.bvid) + ' · ' + esc(v.up || '未获取') +
        '<span class="bili-src-origin">' + esc(v.origin) + (v.ts != null ? ' @' + v.ts + 's' : '') + '</span></a>';
    }).join('');
  }

  function recheckBlock(r) {
    var rc = r.recheck;
    if (!rc) return '';
    var ch = (rc.channels || []).length ? '<div class="recheck-ch">查过渠道：' + esc(rc.channels.join(' / ')) + '</div>' : '';
    return '<div class="recheck-box"><b>复核 ' + esc(rc.at) + '</b> · ' + esc(rc.method || '') +
      (rc.priceNote ? ' · 价格：' + esc(rc.priceNote) : '') +
      (rc.evidenceUrl ? ' · <a href="' + esc(rc.evidenceUrl) + '" target="_blank" rel="noopener noreferrer">证据</a>' : '') +
      '<div class="recheck-note">' + esc(rc.note || '') + '</div>' + ch + '</div>';
  }

  function biliCardHTML(r) {
    var official = r.officialUrl
      ? '<a class="btn btn-primary" href="' + esc(r.officialUrl) + '" target="_blank" rel="noopener noreferrer">资源官方链接 →</a>'
      : '<span class="bili-nolink">未找到官方链接</span>';
    var third = (r.rawUrl && (!r.officialUrl || r.thirdParty))
      ? '<a class="bili-third-link" href="' + esc(r.rawUrl) + '" target="_blank" rel="noopener noreferrer nofollow">第三方原始链接（未核实安全性，不建议直接下载）</a>' : '';
    var notes = (r.notes || []).map(function (n) { return '<li>' + esc(n) + '</li>'; }).join('');
    var mainLink = r.resourceId
      ? '<a href="#item-' + esc(r.resourceId) + '" class="bili-main-link">已在主目录：' + esc(r.resourceId) + '</a>'
      : '<span class="none">未并入主目录（' + esc(BILI_STATUS_TEXT[r.status] || '待核实') + '）</span>';
    return '<article class="bili-card" id="item-' + esc(r.id) + '">' +
      '<div class="bili-card-top">' + biliStatusBadge(r.status) + biliKindBadge(r) + '</div>' +
      '<h4>' + esc(r.name) + '</h4>' +
      '<div class="bili-actions">' + official + third + '</div>' +
      '<div class="bili-src-row"><span class="bili-src-label">B 站溯源</span>' + biliSourceLinks(r) + '</div>' +
      (notes ? '<ul class="bili-notes">' + notes + '</ul>' : '') +
      recheckBlock(r) +
      '<div class="bili-main-row">' + mainLink +
      '<span class="bili-origins">线索来源：' + esc((r.origins || []).join(' / ') || '未获取') + '</span></div>' +
      '</article>';
  }

  function biliVideoHTML(v) {
    var mentions = (v.mentions || []).map(function (m) {
      var biliUrl = 'https://www.bilibili.com/video/' + v.bvid + (m.ts != null ? '?t=' + Math.floor(m.ts) : '');
      return '<a class="bili-mention" href="' + esc(biliUrl) + '" target="_blank" rel="noopener noreferrer">' +
        esc(m.name) + ' ' + biliStatusBadge(m.status) +
        ' <span class="badge bili-origin">' + esc(m.origin) + (m.ts != null ? ' @' + m.ts + 's' : '') + '</span></a>';
    }).join('');
    var comments = (v.comments || []).length
      ? '<details class="bili-detail"><summary>热门评论 ' + v.comments.length + ' 条 <span>' + esc(v.commentStatus || '') + '</span></summary>' +
          '<div class="bili-comments">' + v.comments.map(function (c) {
            return '<div class="bili-comment"><b>' + esc(c.user) + '</b>' +
              (c.like != null ? ' <span>赞 ' + fmtNum(c.like) + '</span>' : '') +
              (c.ctime ? ' <span>' + esc(c.ctime) + '</span>' : '') +
              '<p>' + esc(c.text) + '</p></div>';
          }).join('') + '</div></details>'
      : '<div class="bili-subline">评论：' + esc(v.commentStatus || '未获取') + '</div>';
    var subtitles = (v.subtitles || []).length
      ? v.subtitles.map(function (s) {
        return '<details class="bili-detail"><summary>字幕 · ' + esc(s.lang) + ' · ' + (s.auto ? 'AI 字幕，可能有错字' : 'UP 主字幕') +
          ' <span>' + esc(s.source) + ' · ' + esc(s.fetchedAt) + '</span></summary><pre class="bili-text">' + esc(s.text) + '</pre></details>';
      }).join('')
      : '<div class="bili-subline">字幕：' + esc(v.subtitleStatus || '未获取') + '</div>';
    return '<article class="bili-video-card" id="video-' + esc(v.bvid) + '">' +
      '<div class="bili-video-top"><h4>' + esc(v.title) + '</h4>' +
        '<a class="bili-open" href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">去 B 站核对 ↗</a></div>' +
      '<div class="bili-video-meta">UP：' + esc(v.up) + ' · 播放 ' + fmtNum(v.views) +
        ' · 点赞 ' + fmtNum(v.likes) + ' · 收藏 ' + fmtNum(v.favorites) +
        ' · 发布 ' + esc(v.publishedAt) + ' · 关键词：' + esc(v.keyword) + '</div>' +
      '<details class="bili-detail"><summary>简介原文 <span>' + esc(v.descStatus || '') + ' · 抓取 ' + esc(v.descFetchedAt) + '</span></summary>' +
        '<pre class="bili-text">' + esc(v.desc) + '</pre></details>' + comments + subtitles +
      '<div class="bili-mentions"><b>提取线索：</b>' + (mentions || '<span class="none">未获取</span>') + '</div>' +
      '</article>';
  }

  /* ---------- 路由 ---------- */
  function parseHash() {
    var raw = (location.hash || '').replace(/^#/, '');
    if (/^item-/.test(raw)) return { type: 'item', id: raw.slice(5) };
    if (/^video-/.test(raw)) return { type: 'video', id: raw.slice(6) };
    var parts = raw.split('?');
    var seg = parts[0].split('/').filter(Boolean);
    var q = {};
    (parts[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      q[decodeURIComponent(i < 0 ? kv : kv.slice(0, i))] = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1));
    });
    if (!seg.length) seg = ['resources', 'free'];
    return { type: 'view', seg: seg, q: q, base: '/' + seg.join('/') };
  }

  function filtersFromQ(q) {
    return {
      q: q.q || '', lic: q.lic || 'all', eng: q.eng || 'all', rating: q.rating || 'all',
      reviews: q.reviews || 'all', source: q.source || 'all', sort: q.sort || '',
      activity: q.activity || 'all', minStars: q.minStars || 'all',
      rec: q.rec || '', group: q.group || 'all', by: q.by || 'resource'
    };
  }

  function hashFor(base, f) {
    var qs = [];
    function put(k, v, def) { if (v && v !== def) qs.push(k + '=' + encodeURIComponent(v)); }
    put('q', f.q, '');
    put('lic', f.lic, 'all');
    put('eng', f.eng, 'all');
    put('rating', f.rating, 'all');
    put('reviews', f.reviews, 'all');
    put('source', f.source, 'all');
    put('sort', f.sort, '');
    put('activity', f.activity, 'all');
    put('minStars', f.minStars, 'all');
    put('rec', f.rec, '');
    put('group', f.group, 'all');
    put('by', f.by, 'resource');
    put('view', viewMode === 'list' ? 'list' : '', '');
    return '#' + base + (qs.length ? '?' + qs.join('&') : '');
  }

  function navigate(base, f) {
    saveScroll();
    location.hash = hashFor(base, f || {});
  }

  function saveScroll() {
    if (currentBase) scrollCache[currentBase] = window.scrollY || window.pageYOffset || 0;
  }

  function restoreScroll(base) {
    var y = scrollCache[base] || 0;
    if (y) setTimeout(function () { window.scrollTo(0, y); }, 30);
  }

  /* ---------- 顶部统计与来源 ---------- */
  function renderHero() {
    var total = STATS.total || 0;
    var cells = [
      { v: total, l: '条目总数', s: '资源 ' + (STATS.resources || 0) + ' / 工具 ' + (STATS.tools || 0) },
      { v: STATS.free || 0, l: '免费条目', s: '占比 ' + (STATS.freeRatio == null ? '未获取' : STATS.freeRatio + '%') },
      { v: STATS.paid || 0, l: '付费条目', s: 'Fab 中国区税前 CNY' },
      { v: (COUNTS.github && COUNTS.github.total) || 0, l: 'GitHub 插件', s: '活跃优先，含归档提示' },
      { v: (STATS.imageCoverage == null ? '未获取' : STATS.imageCoverage + '%'), l: '截图覆盖', s: (STATS.imageCount || 0) + ' / ' + total + ' 张' },
      { v: CORE.version || '未获取', l: '数据版本', s: META.timezone || '' }
    ];
    $('stats').innerHTML = cells.map(function (c) {
      return '<div class="stat"><b>' + esc(c.v) + '</b><span>' + esc(c.l) + ' · ' + esc(c.s) + '</span></div>';
    }).join('');
    $('siteTitle').textContent = META.siteName || 'UE 资源与工具索引';
    $('tagline').textContent = META.tagline || '';
    $('dataVersion').textContent = '数据更新于 ' + (CORE.version || '未获取');
    $('fetchPill').textContent = (STATS.resources || 0) + ' 资源 · ' + (STATS.tools || 0) + ' 工具 · ' + (COUNTS.bili ? COUNTS.bili.videos : 0) + ' 条 B 站视频';
    document.title = (META.siteName || 'UE 资源与工具索引') + ' · ' + (CORE.version || '');
    $('sourceGrid').innerHTML = SOURCES.map(function (s) {
      return '<div class="source"><b><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' + esc(s.name) + '</a></b>' +
        '<div class="lic">许可：' + esc(s.license) + '</div><div>' + esc(s.note) + '</div></div>';
    }).join('');
    $('integrity').textContent = (META.integrityNote || '') + ' ' + (META.priceNote || '');
    var steps = META.howToUpdate || [
      '只改 data/*.json（资源、工具、GitHub、B 站）',
      '运行 node scripts/build.js：校验数据并重建 data/*.js 分片，index.html 哈希不变',
      '只有改 src/ 模板/样式/渲染脚本时才运行 node scripts/build.js --page',
      '截图放 assets/img/<分类>/<id>.jpg；拿不到进「待补图」清单，不伪造'
    ];
    $('updateSteps').innerHTML = steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    $('buildInfo').innerHTML = '数据文件：<code>data/resources.json</code> / <code>data/tools.json</code> / <code>data/github.json</code> / <code>data/bilibili.json</code>；' +
      '分片：<code>data/core.js + resources.js + tools.js + bilibili.js + pending.js + github.js</code>；' +
      '仅改数据：<code>' + esc(META.buildCommand || 'node scripts/build.js') + '</code>；仅改页面：<code>' + esc(META.pageCommand || 'node scripts/build.js --page') + '</code>。';
    var byCat = STATS.byCategory || {};
    var row = function (label, cats) {
      return '<div class="cat-row"><b>' + label + '</b>' + cats.map(function (c) {
        var n = byCat[c.id] ? byCat[c.id].total : 0;
        return '<span>' + esc(c.name) + ' ' + n + '</span>';
      }).join('') + '</div>';
    };
    $('catOverview').innerHTML = row('资源', CATS.resource) + row('工具', CATS.tool);
  }

  /* ---------- 菜单 ---------- */
  function navLink(label, base, count, active, sub) {
    return '<a class="nav-item' + (active ? ' active' : '') + (sub ? ' sub' : '') + '" href="' +
      esc(hashFor(base, filterCache[base] || {})) + '" data-base="' + esc(base) + '">' +
      '<span>' + esc(label) + '</span><span class="nav-count">' + count + '</span></a>';
  }

  function renderNav(cur) {
    var res = COUNTS.resources || { free: 0, paid: 0, byCategory: {} };
    var tool = COUNTS.tools || { free: 0, paid: 0, byCategory: {} };
    var gh = COUNTS.github || { total: 0, recommended: 0, archived: 0, stalePopular: 0, lowPopular: 0, byGroup: {} };
    var bili = COUNTS.bili || {};
    var lists = COUNTS.lists || {};
    var html = '';
    var base = cur.base || '/resources/free';

    html += '<div class="nav-group-title">资源 <span>' + (STATS.resources || 0) + '</span></div>';
    html += navLink('免费资源', '/resources/free', res.free || 0, base === '/resources/free', false);
    CATS.resource.forEach(function (c) {
      var n = (res.byCategory[c.id] || {}).free || 0;
      html += navLink(c.name, '/resources/free/' + c.id, n, base === '/resources/free/' + c.id, true);
    });
    html += navLink('付费资源', '/resources/paid', res.paid || 0, base === '/resources/paid', false);
    CATS.resource.forEach(function (c) {
      var n = (res.byCategory[c.id] || {}).paid || 0;
      html += navLink(c.name, '/resources/paid/' + c.id, n, base === '/resources/paid/' + c.id, true);
    });

    html += '<div class="nav-group-title">工具插件 <span>' + (STATS.tools || 0) + '</span></div>';
    html += navLink('免费工具', '/tools/free', tool.free || 0, base === '/tools/free', false);
    CATS.tool.forEach(function (c) {
      var n = (tool.byCategory[c.id] || {}).free || 0;
      html += navLink(c.name, '/tools/free/' + c.id, n, base === '/tools/free/' + c.id, true);
    });
    html += navLink('付费工具', '/tools/paid', tool.paid || 0, base === '/tools/paid', false);
    CATS.tool.forEach(function (c) {
      var n = (tool.byCategory[c.id] || {}).paid || 0;
      html += navLink(c.name, '/tools/paid/' + c.id, n, base === '/tools/paid/' + c.id, true);
    });
    html += navLink('GitHub 插件', '/github', gh.total || 0, base === '/github' || base === '/github/stale', false);

    html += '<div class="nav-group-title">B 站信息源 <span>' + (bili.resources || 0) + '</span></div>';
    html += navLink('已核实', '/bilibili/verified', bili.verified || 0, base === '/bilibili/verified', false);
    html += navLink('待核实', '/bilibili/pending', bili.pending || 0, base === '/bilibili/pending', false);
    html += navLink('已收费', '/bilibili/paid', bili.paid || 0, base === '/bilibili/paid', false);
    html += navLink('已下架', '/bilibili/removed', bili.removed || 0, base === '/bilibili/removed', false);
    html += navLink('查过但无法确认', '/bilibili/unverifiable', bili.unverifiable || 0, base === '/bilibili/unverifiable', false);

    html += '<div class="nav-group-title">清单 <span>留档</span></div>';
    html += navLink('待补图', '/lists/pending-images', lists.pendingImages || 0, base === '/lists/pending-images', false);
    html += navLink('待核实 / 无法确认', '/lists/pending', lists.pending || 0, base === '/lists/pending', false);
    html += navLink('失效 / 已下架', '/lists/removed', lists.removed || 0, base === '/lists/removed', false);

    $('nav').innerHTML = html;
    $('sideMeta').textContent = '口径条数由 data 分片计算，不写死。数据更新于 ' + (CORE.version || '未获取') + '。';
    $('navCurrent').textContent = cur.title || '资源';
    Array.prototype.forEach.call($('nav').querySelectorAll('a[data-base]'), function (a) {
      a.addEventListener('click', function () {
        var target = a.getAttribute('data-base');
        var f = filterCache[target] || {
          q: '', lic: 'all', eng: 'all', rating: 'all', reviews: 'all', source: 'all',
          sort: '', activity: 'all', minStars: 'all', rec: '', group: 'all', by: 'resource'
        };
        saveScroll();
        location.hash = hashFor(target, f);
      });
    });
  }

  /* ---------- 通用筛选 ---------- */
  function sortList(list, sort) {
    var l = list.slice();
    var nameCmp = function (a, b) { return a.name.localeCompare(b.name, 'zh-Hans-CN'); };
    l.sort(function (a, b) {
      if (sort === 'name') return nameCmp(a, b);
      if (sort === 'rating') {
        var ra = a.rating == null ? -1 : a.rating, rb = b.rating == null ? -1 : b.rating;
        if (rb !== ra) return rb - ra;
        return ((b.reviews || 0) - (a.reviews || 0)) || nameCmp(a, b);
      }
      if (sort === 'updated') return (b.verified || '').localeCompare(a.verified || '') || nameCmp(a, b);
      if (sort === 'stars') {
        var sa = (a.extra && a.extra.stars) || 0, sb = (b.extra && b.extra.stars) || 0;
        return (sb - sa) || nameCmp(a, b);
      }
      var pa = a.priceType === 'free' ? -1 : (a.price == null ? Infinity : a.price);
      var pb = b.priceType === 'free' ? -1 : (b.price == null ? Infinity : b.price);
      if (pa !== pb) return pa - pb;
      var r1 = a.rating == null ? -1 : a.rating, r2 = b.rating == null ? -1 : b.rating;
      if (r2 !== r1) return r2 - r1;
      return nameCmp(a, b);
    });
    return l;
  }

  function sortGithub(list, sort) {
    var l = list.slice();
    var nameCmp = function (a, b) { return (a.repo || a.name).localeCompare(b.repo || b.name); };
    l.sort(function (a, b) {
      if (sort === 'stars') return (b.stars - a.stars) || nameCmp(a, b);
      if (sort === 'updated') return (b.pushedAt || '').localeCompare(a.pushedAt || '') || nameCmp(a, b);
      if (sort === 'rating') return ((b.popularityTier === 'stale-popular' ? 1 : 0) - (a.popularityTier === 'stale-popular' ? 1 : 0)) || nameCmp(a, b);
      if (sort === 'name') return nameCmp(a, b);
      // 综合热度：heat 降序，活跃度辅排，最后按名称保证可复现
      return (b.heat - a.heat) || ({ active: 4, normal: 3, stale: 2, archived: 1 }[b.activity] - { active: 4, normal: 3, stale: 2, archived: 1 }[a.activity]) || nameCmp(a, b);
    });
    return l;
  }

  function filterItems(items, f) {
    var q = (f.q || '').trim().toLowerCase();
    return items.filter(function (x) {
      if (f.lic !== 'all' && licenseGroup(x.license) !== f.lic) return false;
      if (f.eng !== 'all' && engineBucket(x.engine) !== f.eng) return false;
      if (f.source !== 'all' && sourceName(x) !== f.source) return false;
      if (f.rating !== 'all') {
        if (f.rating === 'rated' && x.rating == null) return false;
        if (f.rating === 'unrated' && x.rating != null) return false;
        if (f.rating !== 'rated' && f.rating !== 'unrated' && (x.rating == null || x.rating < parseFloat(f.rating))) return false;
      }
      if (f.reviews !== 'all' && (x.reviews == null || x.reviews < parseInt(f.reviews, 10))) return false;
      if (q) {
        var hay = [x.name, x.subcategory, x.notes, x.license, x.engine, x.format, (x.tags || []).join(' ')].join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  function toolbarHTML(type, f, items) {
    var html = '';
    if (type === 'list') return '';
    html += '<label class="tb-field">搜索<input id="tbQ" type="search" placeholder="名称 / 标签 / 备注" value="' + esc(f.q) + '"></label>';
    if (type !== 'bili') {
      html += '<label class="tb-field">许可<select id="tbLic">' +
        opt('all', '全部许可', f.lic) + opt('cc0', 'CC0', f.lic) + opt('oss', '开源 / 标准许可', f.lic) +
        opt('attr', '需署名', f.lic) + opt('copyleft', 'GPL/AGPL', f.lic) + opt('unknown', '许可未获取', f.lic) + '</select></label>';
      html += '<label class="tb-field">引擎<select id="tbEng">' +
        opt('all', '全部引擎', f.eng) + opt('ue5', 'UE5', f.eng) + opt('ue4', 'UE4', f.eng) +
        opt('both', 'UE4–UE5', f.eng) + opt('generic', '通用', f.eng) + opt('unknown', '未获取', f.eng) + '</select></label>';
      var srcs = {};
      items.forEach(function (x) { srcs[sourceName(x)] = 1; });
      html += '<label class="tb-field">来源<select id="tbSrc"><option value="all">全部来源</option>' +
        Object.keys(srcs).sort().map(function (s) { return '<option value="' + esc(s) + '"' + (f.source === s ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') + '</select></label>';
    }
    if (type === 'github') {
      var groups = {};
      items.forEach(function (g) { groups[g.group] = 1; });
      html += '<label class="tb-field">分组<select id="tbGroup"><option value="all">全部分组</option>' +
        Object.keys(groups).sort().map(function (g) { return '<option value="' + esc(g) + '"' + (f.group === g ? ' selected' : '') + '>' + esc(g) + '</option>'; }).join('') + '</select></label>';
      html += '<label class="tb-field">活跃度<select id="tbActivity">' +
        opt('all', '全部活跃度', f.activity) + opt('active', '活跃（近 6 个月）', f.activity) +
        opt('normal', '一般（6–12 个月）', f.activity) + opt('stale', '停滞（超 12 个月）', f.activity) +
        opt('archived', '归档', f.activity) + '</select></label>';
      html += '<label class="tb-field">星标下限<select id="tbStars">' +
        opt('all', '不限', f.minStars) + opt('10', '≥10', f.minStars) + opt('50', '≥50', f.minStars) +
        opt('100', '≥100', f.minStars) + opt('300', '≥300', f.minStars) + '</select></label>';
      html += '<label class="tb-check"><input id="tbRec" type="checkbox"' + (f.rec !== 'all' ? ' checked' : '') + '> 仅推荐（排除归档与低人气）</label>';
    }
    if (type === 'bili') {
      html += '<label class="tb-field">看法<select id="tbBy">' +
        '<option value="resource"' + (f.by === 'resource' ? ' selected' : '') + '>按资源</option>' +
        '<option value="video"' + (f.by === 'video' ? ' selected' : '') + '>按视频</option></select></label>';
    }
    var sortOpts = type === 'github'
      ? [['heat', '综合热度'], ['stars', '星标'], ['updated', '最近更新'], ['rating', '高人气 / 久未更新'], ['name', '名称']]
      : [['recommended', '推荐排序（免费优先）'], ['rating', '评分 / 评价数'], ['stars', '星标'], ['updated', '最近更新'], ['name', '名称'], ['price', '价格']];
    var curSort = f.sort || (type === 'github' ? 'heat' : 'recommended');
    html += '<label class="tb-field">排序<select id="tbSort">' + sortOpts.map(function (o) {
      return '<option value="' + o[0] + '"' + (curSort === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
    }).join('') + '</select></label>';
    html += '<button id="tbReset" class="btn btn-ghost" type="button">重置筛选</button>';
    html += '<span id="tbInfo" class="tb-info"></span>';
    return html;
  }

  function opt(v, label, cur) {
    return '<option value="' + esc(v) + '"' + (cur === v ? ' selected' : '') + '>' + esc(label) + '</option>';
  }

  function bindToolbar(type, base) {
    var f = filterCache[base] || filtersFromQ({});
    function upd(patch) {
      Object.keys(patch).forEach(function (k) { f[k] = patch[k]; });
      filterCache[base] = f;
      location.hash = hashFor(base, f);
    }
    var q = $('tbQ');
    if (q) {
      var t;
      q.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(function () { upd({ q: q.value }); }, 250);
      });
    }
    [['tbLic', 'lic'], ['tbEng', 'eng'], ['tbSrc', 'source'], ['tbGroup', 'group'], ['tbActivity', 'activity'], ['tbStars', 'minStars'], ['tbSort', 'sort'], ['tbBy', 'by']].forEach(function (pair) {
      var el = $(pair[0]);
      if (el) el.addEventListener('change', function () {
        var patch = {}; patch[pair[1]] = el.value; upd(patch);
      });
    });
    var rec = $('tbRec');
    if (rec) rec.addEventListener('change', function () { upd({ rec: rec.checked ? '' : 'all' }); });
    var reset = $('tbReset');
    if (reset) reset.addEventListener('click', function () {
      var def = { q: '', lic: 'all', eng: 'all', rating: 'all', reviews: 'all', source: 'all', sort: '', activity: 'all', minStars: 'all', rec: '', group: 'all', by: 'resource' };
      filterCache[base] = def;
      location.hash = hashFor(base, def);
    });
  }

  /* ---------- 视图模式：缩略图 / 列表 ---------- */
  function applyViewFromRoute(route) {
    if (route.type !== 'view') return;
    var qv = route.q.view;
    if (qv && VIEW_MODES.indexOf(qv) > -1) {
      viewMode = qv;
      saveViewMode();
    } else if (!qv) {
      viewMode = readViewMode();
    }
  }

  function syncViewSwitch(route) {
    var bar = $('viewModeBar');
    if (!bar) return;
    bar.hidden = route.type !== 'view';
    if (bar.hidden) return;
    Array.prototype.forEach.call(bar.querySelectorAll('button[data-mode]'), function (b) {
      var on = b.getAttribute('data-mode') === viewMode;
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.classList.toggle('active', on);
    });
    $('viewModeHint').textContent = viewMode === 'list'
      ? '列表：点表头复用排序状态，窄屏自动收起分类与来源'
      : '缩略图：卡片网格，图片懒加载';
  }

  function ensureViewInHash(route) {
    if (route.type !== 'view' || route.q.view || viewMode !== 'list') return;
    try {
      history.replaceState(null, '', hashFor(route.base, filtersFromQ(route.q)));
    } catch (e) { /* 老浏览器忽略 */ }
  }

  function renderCollection(list, builders) {
    if (!list.length) return '';
    if (viewMode === 'list') return builders.list(list);
    var cls = builders.gridClass || 'grid';
    return '<div class="' + cls + (builders.single ? ' single' : '') + '">' + list.map(builders.card).join('') + '</div>';
  }

  function thumbHTML(src, alt) {
    if (!src) return '<span class="row-thumb broken">缺图</span>';
    return '<span class="row-thumb"><img loading="lazy" src="' + esc(src) + '" alt="' + esc(alt) + '"></span>';
  }

  function rowNameHTML(id, name, sub) {
    return '<a class="row-name" href="#item-' + esc(id) + '" title="' + esc(name) + '">' + esc(name) + '</a>' +
      (sub ? '<span class="row-sub">' + esc(sub) + '</span>' : '');
  }

  function thHTML(label, cls, sortKey, f) {
    if (!sortKey) return '<th class="' + cls + '">' + esc(label) + '</th>';
    var active = f && f.sort === sortKey;
    return '<th class="' + cls + (active ? ' sorted' : '') + '" aria-sort="' + (active ? 'ascending' : 'none') + '">' +
      '<button type="button" data-sort="' + esc(sortKey) + '" title="按' + esc(label) + '排序">' +
      esc(label) + (active ? ' <span class="sort-mark">▲</span>' : '') + '</button></th>';
  }

  function tableHTML(head, rows) {
    return '<div class="list-wrap"><table class="list-table">' +
      '<thead><tr>' + head + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
  }

  function itemRowsHTML(list, f) {
    return list.map(function (x) {
      var cat = CAT_MAP[x.category] || { name: x.category };
      var isFree = x.priceType === 'free';
      var sourceLink = x.source && x.source !== x.obtain
        ? '<a class="row-act-link" href="' + esc(x.source) + '" target="_blank" rel="noopener noreferrer">来源</a>' : '';
      var low = !isFree && x.reviews != null && x.reviews < 10
        ? ' <span class="badge low">样本少</span>' : '';
      return '<tr id="item-' + esc(x.id) + '" data-href="#item-' + esc(x.id) + '">' +
        '<td class="c-thumb">' + thumbHTML(x.image, x.name) + '</td>' +
        '<td class="c-name">' + rowNameHTML(x.id, x.name, x.subcategory) + low + '</td>' +
        '<td class="c-cat">' + esc(cat.name) + '</td>' +
        '<td class="c-lic">' + licenseBadge(x.license) + '</td>' +
        '<td class="c-price">' + (isFree ? '<b class="row-free">免费</b>' : esc(fmtPrice(x.price))) + '</td>' +
        '<td class="c-score">' + scoreHTML(x) + '</td>' +
        '<td class="c-state">' + engineBadge(x.engine) + '</td>' +
        '<td class="c-src">' + esc(sourceName(x)) + '</td>' +
        '<td class="c-time">' + esc(x.verified) + '</td>' +
        '<td class="c-act"><a class="row-act-link primary" href="' + esc(x.obtain) + '" target="_blank" rel="noopener noreferrer">获取</a>' + sourceLink + '</td>' +
        '</tr>';
    });
  }

  function itemListHTML(list, f) {
    var head = thHTML('预览', 'c-thumb') + thHTML('名称', 'c-name', 'name', f) +
      thHTML('分类', 'c-cat') + thHTML('许可', 'c-lic') + thHTML('价格', 'c-price', 'price', f) +
      thHTML('评分 / 评价', 'c-score', 'rating', f) + thHTML('引擎 / 状态', 'c-state') +
      thHTML('来源', 'c-src') + thHTML('更新', 'c-time', 'updated', f) + thHTML('操作', 'c-act');
    return tableHTML(head, itemRowsHTML(list, f));
  }

  function ghRowsHTML(list) {
    return list.map(function (g) {
      return '<tr id="item-' + esc(g.id) + '" data-href="#item-' + esc(g.id) + '">' +
        '<td class="c-thumb">' + thumbHTML(g.image, g.repo) + '</td>' +
        '<td class="c-name">' + rowNameHTML(g.id, g.name || g.repo, g.repo) + '</td>' +
        '<td class="c-cat">' + esc(g.group) + '</td>' +
        '<td class="c-lic">' + licenseBadge(g.license) + '</td>' +
        '<td class="c-price"><b class="row-free">开源</b></td>' +
        '<td class="c-score"><span class="star">★</span> ' + fmtNum(g.stars) + ' <span class="rev">stars</span></td>' +
        '<td class="c-state">' + ghBadge(g) + '</td>' +
        '<td class="c-src">GitHub</td>' +
        '<td class="c-time">' + esc(g.pushedAt) + '</td>' +
        '<td class="c-act"><a class="row-act-link primary" href="' + esc(g.url) + '" target="_blank" rel="noopener noreferrer">GitHub</a></td>' +
        '</tr>';
    });
  }

  function ghListHTML(list, f) {
    var head = thHTML('预览', 'c-thumb') + thHTML('名称', 'c-name', 'name', f) +
      thHTML('分类', 'c-cat') + thHTML('许可', 'c-lic') + thHTML('价格', 'c-price') +
      thHTML('星标 / Fork', 'c-score', 'stars', f) + thHTML('活跃 / 人气', 'c-state') +
      thHTML('来源', 'c-src') + thHTML('最近提交', 'c-time', 'updated', f) + thHTML('操作', 'c-act');
    return tableHTML(head, ghRowsHTML(list));
  }

  function biliRowsHTML(list) {
    return list.map(function (r) {
      var first = (r.videos || [])[0];
      var up = first ? (first.up || '未获取') + ((r.videos || []).length > 1 ? ' +' + (r.videos.length - 1) : '') : '未获取';
      var priceText = r.status === 'paid' ? '已收费' : r.status === 'removed' ? '已下架'
        : r.status === 'unverifiable' ? '无法确认' : (r.free ? '免费' : '未知');
      var official = r.officialUrl
        ? '<a class="row-act-link primary" href="' + esc(r.officialUrl) + '" target="_blank" rel="noopener noreferrer">官方</a>'
        : (first ? '<a class="row-act-link" href="' + esc(first.url) + '" target="_blank" rel="noopener noreferrer">去 B 站</a>' : '');
      var main = r.resourceId
        ? '<a class="row-act-link" href="#item-' + esc(r.resourceId) + '">主目录</a>' : '';
      return '<tr id="item-' + esc(r.id) + '" data-href="#item-' + esc(r.id) + '">' +
        '<td class="c-thumb"><span class="row-thumb none">线索</span></td>' +
        '<td class="c-name">' + rowNameHTML(r.id, r.name, (r.origins || []).join(' / ')) + '</td>' +
        '<td class="c-cat">' + esc(r.type || '未分类') + '</td>' +
        '<td class="c-lic"><span class="badge lic-unknown">许可未获取</span></td>' +
        '<td class="c-price">' + esc(priceText) + '</td>' +
        '<td class="c-score"><span class="none">—</span></td>' +
        '<td class="c-state">' + biliStatusBadge(r.status) + '</td>' +
        '<td class="c-src" title="' + esc(up) + '">' + esc(up) + '</td>' +
        '<td class="c-time">' + esc(r.recheck ? r.recheck.at : '—') + '</td>' +
        '<td class="c-act">' + official + main + '</td>' +
        '</tr>';
    });
  }

  function biliListHTML(list) {
    var head = thHTML('预览', 'c-thumb') + thHTML('名称', 'c-name') +
      thHTML('分类', 'c-cat') + thHTML('许可', 'c-lic') + thHTML('价格', 'c-price') +
      thHTML('评分 / 评价', 'c-score') + thHTML('状态', 'c-state') +
      thHTML('来源', 'c-src') + thHTML('复核', 'c-time') + thHTML('操作', 'c-act');
    return tableHTML(head, biliRowsHTML(list));
  }

  function biliVideoRowsHTML(list) {
    return list.map(function (v) {
      return '<tr id="video-' + esc(v.bvid) + '" data-href="#video-' + esc(v.bvid) + '">' +
        '<td class="c-thumb"><span class="row-thumb none">视频</span></td>' +
        '<td class="c-name"><a class="row-name" href="#video-' + esc(v.bvid) + '">' + esc(v.title) + '</a>' +
          '<span class="row-sub">' + esc(v.keyword) + '</span></td>' +
        '<td class="c-cat">' + esc(v.up) + '</td>' +
        '<td class="c-lic"><span class="badge bili-origin">B 站</span></td>' +
        '<td class="c-price">—</td>' +
        '<td class="c-score">播放 ' + fmtNum(v.views) + ' · 赞 ' + fmtNum(v.likes) + '</td>' +
        '<td class="c-state">' + (v.mentions || []).length + ' 条线索</td>' +
        '<td class="c-src">B 站</td>' +
        '<td class="c-time">' + esc(v.publishedAt) + '</td>' +
        '<td class="c-act"><a class="row-act-link primary" href="' + esc(v.url) + '" target="_blank" rel="noopener noreferrer">去 B 站</a></td>' +
        '</tr>';
    });
  }

  function biliVideoListHTML(list) {
    var head = thHTML('预览', 'c-thumb') + thHTML('视频标题', 'c-name') +
      thHTML('UP 主', 'c-cat') + thHTML('许可', 'c-lic') + thHTML('价格', 'c-price') +
      thHTML('播放 / 点赞', 'c-score') + thHTML('状态', 'c-state') +
      thHTML('来源', 'c-src') + thHTML('发布', 'c-time') + thHTML('操作', 'c-act');
    return tableHTML(head, biliVideoRowsHTML(list));
  }

  function pendingImageRowsHTML(list) {
    return list.map(function (it) {
      return '<tr data-href="#item-' + esc(it.id) + '">' +
        '<td class="c-thumb"><span class="row-thumb broken">缺图</span></td>' +
        '<td class="c-name"><a class="row-name" href="#item-' + esc(it.id) + '">' + esc(it.name || it.id) + '</a></td>' +
        '<td class="c-cat">—</td><td class="c-lic">—</td><td class="c-price">—</td><td class="c-score">—</td>' +
        '<td class="c-state"><span class="badge low">缺截图</span></td><td class="c-src">—</td><td class="c-time">—</td>' +
        '<td class="c-act"><a class="row-act-link" href="#item-' + esc(it.id) + '">查看条目</a></td></tr>';
    });
  }

  function pendingImageListHTML(list) {
    var head = thHTML('预览', 'c-thumb') + thHTML('名称', 'c-name') + thHTML('分类', 'c-cat') +
      thHTML('许可', 'c-lic') + thHTML('价格', 'c-price') + thHTML('评分 / 评价', 'c-score') +
      thHTML('状态', 'c-state') + thHTML('来源', 'c-src') + thHTML('更新', 'c-time') + thHTML('操作', 'c-act');
    return tableHTML(head, pendingImageRowsHTML(list));
  }

  /* ---------- 视图 ---------- */
  function setHead(title, sub) {
    $('viewTitle').textContent = title;
    $('viewStats').textContent = sub;
    currentBase = parseHash().base || '';
    $('viewPermalink').onclick = function (e) {
      e.preventDefault();
      var url = location.href.split('#')[0] + location.hash;
      if (navigator.clipboard) navigator.clipboard.writeText(url);
      $('status').textContent = '已复制本视图链接：' + location.hash;
    };
  }

  function emptyHTML(label) {
    return '<div class="empty"><b>该口径下暂无条目</b>' + esc(label || '换筛选条件或回到上一级菜单。') + '</div>';
  }

  function renderResourceView(route, data) {
    var kind = route.seg[0] === 'resources' ? 'resource' : 'tool';
    var price = route.seg[1] === 'paid' ? 'paid' : 'free';
    var cat = route.seg[2] || 'all';
    var f = filterCache[route.base] = filtersFromQ(route.q);
    var items = (data.items || []).filter(function (x) { return x.payloadKind !== 'x'; });
    items = items.filter(function (x) { return x.priceType === price && (cat === 'all' || x.category === cat); });
    var list = sortList(filterItems(items, f), f.sort || 'recommended');
    var title = (kind === 'resource' ? '资源' : '工具插件') + ' · ' + (price === 'free' ? '免费' : '付费') +
      (cat !== 'all' && CAT_MAP[cat] ? ' · ' + CAT_MAP[cat].name : '');
    setHead(title, list.length + ' / ' + items.length + ' 条（' + (kind === 'resource' ? '原生资源' : '工具与 GitHub 插件') + '）');
    $('toolbar').innerHTML = toolbarHTML('item', f, items);
    $('view').innerHTML = list.length ? renderCollection(list, {
      card: cardHTML,
      list: function (l) { return itemListHTML(l, f); }
    }) : emptyHTML('该分类当前没有 ' + (price === 'free' ? '免费' : '付费') + '条目。');
    bindToolbar('item', route.base);
    bindImgErrors();
  }

  function renderGithubView(route) {
    var f = filterCache[route.base] = filtersFromQ(route.q);
    if (route.seg[1] === 'stale') { f.activity = 'stale'; f.rec = 'all'; }
    return loadShard('github').then(function (gh) {
      var items = gh.items || [];
      var list = items.filter(function (g) {
        if (f.group !== 'all' && g.group !== f.group) return false;
        if (f.activity !== 'all' && g.activity !== f.activity) return false;
        if (f.minStars !== 'all' && g.stars < parseInt(f.minStars, 10)) return false;
        if (f.rec !== 'all' && !g.recommended) return false;
        if (f.q && ([g.repo, g.name, g.description, (g.topics || []).join(' ')].join(' ').toLowerCase().indexOf(f.q.toLowerCase()) === -1)) return false;
        return true;
      });
      var sorted = sortGithub(list, f.sort || 'heat');
      var c = gh.counts || {};
      setHead(route.seg[1] === 'stale' ? 'GitHub 插件 · 久未更新' : 'GitHub 插件',
        sorted.length + ' / ' + items.length + ' 条 · 推荐 ' + (c.recommended || 0) +
        ' · 活跃 ' + (c.active || 0) + ' / 一般 ' + (c.normal || 0) + ' / 停滞 ' + (c.stale || 0) +
        ' / 归档 ' + (c.archived || 0) + ' · 久未更新但高人气 ' + (c.stalePopular || 0));
      $('toolbar').innerHTML = toolbarHTML('github', f, items);
      $('view').innerHTML = sorted.length ? renderCollection(sorted, {
        card: ghCardHTML,
        list: function (l) { return ghListHTML(l, f); }
      }) : emptyHTML('当前筛选下没有插件；归档与低人气条目默认不展示。');
      bindToolbar('github', route.base);
      bindImgErrors();
    });
  }

  function renderBiliView(route) {
    var f = filterCache[route.base] = filtersFromQ(route.q);
    var status = route.seg[1] || 'verified';
    return loadShard('bilibili').then(function (b) {
      var res = (b.resources || []).filter(function (r) { return r.status === status; });
      var q = (f.q || '').toLowerCase();
      if (q) res = res.filter(function (r) { return (r.name + ' ' + (r.notes || []).join(' ') + ' ' + (r.officialUrl || '')).toLowerCase().indexOf(q) > -1; });
      var st = b.stats || {};
      setHead('B 站信息源 · ' + (BILI_STATUS_TEXT[status] || status),
        res.length + ' 个资源 · 视频 ' + (st.videos || 0) + ' 条 / 线索 ' + (st.mentions || 0) +
        ' 条 · 已核实 ' + (st.verified || 0) + ' / 待核实 ' + (st.pending || 0) +
        ' / 已收费 ' + (st.paid || 0) + ' / 已下架 ' + (st.removed || 0) +
        ' / 无法确认 ' + (st.unverifiable || 0));
      $('toolbar').innerHTML = toolbarHTML('bili', f, res);
      var body = '';
      if (f.by === 'video') {
        var vids = b.videos.slice();
        if (status !== 'verified') vids = vids.filter(function (v) {
          return (v.mentions || []).some(function (m) { return m.status === status; });
        });
        body = vids.length
          ? (viewMode === 'list' ? biliVideoListHTML(vids) : vids.map(biliVideoHTML).join(''))
          : emptyHTML('该状态下没有视频。');
      } else {
        body = res.length ? renderCollection(res, {
          gridClass: 'bili-grid', card: biliCardHTML, list: biliListHTML
        }) : emptyHTML('该状态下没有资源线索。');
      }
      $('view').innerHTML = body;
      bindToolbar('bili', route.base);
      bindImgErrors();
    });
  }

  function renderListView(route) {
    var which = route.seg[1];
    var f = filterCache[route.base] = filtersFromQ(route.q);
    setHead('清单 · ' + (which === 'pending-images' ? '待补图' : which === 'pending' ? '待核实 / 无法确认' : '失效 / 已下架'), '');
    $('toolbar').innerHTML = '';
    if (which === 'pending-images') {
      var imgs = (STATS.pendingImages || []);
      setHead('清单 · 待补图', imgs.length + ' 条缺截图');
      $('view').innerHTML = imgs.length
        ? (viewMode === 'list' ? pendingImageListHTML(imgs) : '<ul class="plain-list">' + imgs.map(function (it) {
          return '<li><b>' + esc(it.name || it.id) + '</b><span>' + esc(it.reason || '') + '</span>' +
            '<a href="#item-' + esc(it.id) + '">查看条目</a></li>';
        }).join('') + '</ul>')
        : emptyHTML('当前没有缺图条目。');
      return Promise.resolve();
    }
    return loadShard('pending').then(function (p) {
      var items = (p.items || []).filter(function (r) {
        if (which === 'pending') return r.status === 'pending' || r.status === 'unverifiable';
        return r.status === 'removed' || r.status === 'dead';
      });
      var q = (f.q || '').toLowerCase();
      if (q) items = items.filter(function (r) { return (r.name + ' ' + (r.notes || []).join(' ')).toLowerCase().indexOf(q) > -1; });
      $('viewStats').textContent = items.length + ' 条留档，保留线索不删除';
      $('view').innerHTML = items.length ? renderCollection(items, {
        gridClass: 'bili-grid', card: biliCardHTML, list: biliListHTML
      }) : emptyHTML('该清单当前为空。');
      bindImgErrors();
    });
  }

  function renderItem(id) {
    $('toolbar').innerHTML = '<a class="btn btn-ghost" href="' + ROUTES.resourceFree + '">← 返回浏览</a>';
    $('view').innerHTML = '<div class="loading">正在加载条目…</div>';
    return Promise.all([loadShard('resources'), loadShard('tools'), loadShard('github'), loadShard('bilibili'), loadShard('pending')]).then(function (parts) {
      var all = [];
      var found = null;
      parts.forEach(function (p) {
        (p.items || p.resources || []).forEach(function (x) { if (x.id === id) found = x; });
      });
      if (!found) {
        setHead('条目未找到', id);
        $('view').innerHTML = emptyHTML('该 id 不在当前数据分片中，可能是旧链接。');
        return;
      }
      var isBili = !found.id || (parts[4].items || []).some(function (x) { return x.id === id; });
      var isGh = (parts[2].items || []).some(function (x) { return x.id === id; });
      var isBiliRes = (parts[3].resources || []).some(function (x) { return x.id === id; });
      if (isBiliRes) {
        setHead('B 站线索 · ' + found.name, '状态：' + (BILI_STATUS_TEXT[found.status] || found.status));
        $('view').innerHTML = '<div class="bili-grid">' + biliCardHTML(found) + '</div>';
      } else {
        setHead('条目 · ' + found.name, 'id：' + found.id);
        $('view').innerHTML = '<div class="grid single">' + (isGh ? ghCardHTML(found) : cardHTML(found)) + '</div>';
      }
      bindImgErrors();
    });
  }

  function renderVideo(bvid) {
    $('toolbar').innerHTML = '<a class="btn btn-ghost" href="' + ROUTES.biliVerified + '">← 返回 B 站信息源</a>';
    $('view').innerHTML = '<div class="loading">正在加载视频…</div>';
    return loadShard('bilibili').then(function (b) {
      var v = (b.videos || []).filter(function (x) { return x.bvid === bvid; })[0];
      if (!v) { setHead('视频未找到', bvid); $('view').innerHTML = emptyHTML('该视频不在当前分片中。'); return; }
      setHead('B 站视频 · ' + v.title, v.up + ' · ' + v.publishedAt);
      $('view').innerHTML = biliVideoHTML(v);
    });
  }

  function bindImgErrors() {
    Array.prototype.forEach.call(document.querySelectorAll('.thumb img, .row-thumb img'), function (img) {
      img.addEventListener('error', function () {
        var box = img.parentNode;
        box.classList.add('broken');
        img.remove();
      });
    });
  }

  /* ---------- 主循环 ---------- */
  function routeTitle(route) {
    if (route.type === 'item') return '条目详情';
    if (route.type === 'video') return '视频详情';
    var seg = route.seg;
    if (seg[0] === 'resources' || seg[0] === 'tools') {
      return (seg[0] === 'resources' ? '资源' : '工具') + ' · ' + (seg[1] === 'paid' ? '付费' : '免费') +
        (seg[2] && CAT_MAP[seg[2]] ? ' · ' + CAT_MAP[seg[2]].name : '');
    }
    if (seg[0] === 'github') return 'GitHub 插件';
    if (seg[0] === 'bilibili') return 'B 站 · ' + (BILI_STATUS_TEXT[seg[1]] || seg[1]);
    if (seg[0] === 'lists') return '清单';
    return '资源';
  }

  function render() {
    var route = parseHash();
    applyViewFromRoute(route);
    saveScroll();
    $('appError').hidden = true;
    $('status').textContent = '';
    syncViewSwitch(route);
    ensureViewInHash(route);
    renderNav({ base: route.base || '', title: routeTitle(route) });

    var job;
    if (route.type === 'item') job = renderItem(route.id);
    else if (route.type === 'video') job = renderVideo(route.id);
    else if (route.seg[0] === 'resources' || route.seg[0] === 'tools') {
      job = loadShard(route.seg[0]).then(function (d) { renderResourceView(route, d); });
    } else if (route.seg[0] === 'github') job = renderGithubView(route);
    else if (route.seg[0] === 'bilibili') job = renderBiliView(route);
    else if (route.seg[0] === 'lists') job = renderListView(route);
    else job = Promise.reject(new Error('未知路由：' + location.hash));

    Promise.resolve(job).then(function () {
      restoreScroll(route.base || '');
    }).catch(function (err) {
      showFatal(err.message || String(err));
      $('view').innerHTML = emptyHTML('数据分片加载失败，请重新运行 node scripts/build.js。');
    });
  }

  function init() {
    renderHero();
    render();
    window.addEventListener('hashchange', render);
    var toggle = $('navToggle');
    var backdrop = $('navBackdrop');
    function closeNav() {
      document.body.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      backdrop.hidden = true;
    }
    toggle.addEventListener('click', function () {
      var open = !document.body.classList.contains('nav-open');
      document.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      backdrop.hidden = !open;
    });
    backdrop.addEventListener('click', closeNav);
    $('nav').addEventListener('click', function (e) {
      if (e.target.closest('a[data-base]')) closeNav();
    });

    $('viewModeBar').addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-mode]');
      if (!btn) return;
      var mode = btn.getAttribute('data-mode');
      if (mode === viewMode) return;
      viewMode = mode;
      saveViewMode();
      var route = parseHash();
      if (route.type !== 'view') return;
      saveScroll();
      location.hash = hashFor(route.base, filtersFromQ(route.q));
    });

    // 列表表头排序：与工具条排序下拉共用同一个 sort 状态
    document.addEventListener('click', function (e) {
      var btn = e.target.closest('button[data-sort]');
      if (!btn) return;
      var route = parseHash();
      if (route.type !== 'view') return;
      var f = filterCache[route.base] || filtersFromQ(route.q);
      var key = btn.getAttribute('data-sort');
      f.sort = (f.sort === key) ? '' : key;
      filterCache[route.base] = f;
      location.hash = hashFor(route.base, f);
    });

    // 点名称或行进入详情（链接与按钮保持自己的跳转）
    document.addEventListener('click', function (e) {
      if (e.target.closest('a, button')) return;
      var tr = e.target.closest('tr[data-href]');
      if (!tr) return;
      location.hash = tr.getAttribute('data-href');
    });
  }

  init();
})();

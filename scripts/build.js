#!/usr/bin/env node
'use strict';

/**
 * UE 资源与工具索引 · 校验 + 构建脚本
 * 用法：
 *   node scripts/build.js          校验数据、重算统计、生成 data/assets.js 与 assets.json
 *   node scripts/build.js --page   额外用 src/ 模板重建 index.html（仅改页面时才需要）
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const SRC_DIR = path.join(ROOT, 'src');
const ASSETS_DIR = path.join(ROOT, 'assets');
const IMG_DIR = path.join(ASSETS_DIR, 'img');

const args = process.argv.slice(2);
const rebuildPage = args.indexOf('--page') > -1;
const errors = [];
const warnings = [];
const pendingImages = [];

const FIELDS = [
  'id', 'name', 'kind', 'category', 'subcategory', 'priceType', 'license',
  'engine', 'format', 'size', 'obtain', 'source', 'price', 'currency',
  'rating', 'reviews', 'notes', 'image', 'tags', 'verified', 'extra'
];

function fail(msg) { errors.push(msg); }
function warn(msg) { warnings.push(msg); }

function readJSON(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    fail('JSON 无法解析：' + path.relative(ROOT, file) + '（' + e.message + '）');
    return null;
  }
}

function isURL(s) {
  if (typeof s !== 'string' || !s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) {
    return false;
  }
}

function round1(n) { return Math.round(n * 10) / 10; }

/* ---------- 图片格式与尺寸 ---------- */
function imageInfo(buf) {
  if (!buf || buf.length < 12) return null;

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i += 1; continue; }
      const marker = buf[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2; continue;
      }
      if (marker === 0xff) { i += 1; continue; }
      if (i + 4 > buf.length) break;
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const h = buf.readUInt16BE(i + 5);
        const w = buf.readUInt16BE(i + 7);
        return { format: 'jpeg', width: w, height: h };
      }
      i += 2 + len;
    }
    return { format: 'jpeg', width: 0, height: 0 };
  }

  // PNG
  const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (buf.length >= 24 && buf.slice(0, 8).equals(pngMagic)) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }

  // WebP
  if (buf.length >= 16 && buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X' && buf.length >= 30) {
      const w = 1 + (buf[24] + (buf[25] << 8) + (buf[26] << 16));
      const h = 1 + (buf[27] + (buf[28] << 8) + (buf[29] << 16));
      return { format: 'webp', width: w, height: h };
    }
    return { format: 'webp', width: 0, height: 0 };
  }

  return null;
}

function checkImage(item, label) {
  if (item.image == null || item.image === '') {
    if (item.priceType === 'free') {
      if (item.extra && (Array.isArray(item.extra.bilibili) || item.extra.github)) {
        warn(label + ' 免费条目缺截图，已列入「待补图」报告（B 站/GitHub 来源条目允许先入目录）');
        pendingImages.push({ id: item.id, name: item.name, reason: '免费条目缺截图' });
      } else {
        fail(label + ' 免费条目必须有截图（image 为空）');
      }
    } else {
      warn(label + ' 付费条目缺截图，已列入「待补图」报告');
      pendingImages.push({ id: item.id, name: item.name, reason: '付费条目缺截图' });
    }
    return false;
  }
  if (typeof item.image !== 'string' || !item.image.startsWith('assets/img/') || item.image.indexOf('..') > -1) {
    fail(label + ' 截图路径必须是 assets/img/<分类>/<id>.jpg：' + item.image);
    return false;
  }
  const abs = path.join(ROOT, item.image);
  if (!fs.existsSync(abs)) {
    fail(label + ' 截图不存在：' + item.image);
    return false;
  }
  const size = fs.statSync(abs).size;
  if (size <= 0) {
    fail(label + ' 截图为 0 字节：' + item.image);
    return false;
  }
  const buf = fs.readFileSync(abs);
  const info = imageInfo(buf);
  if (!info) {
    fail(label + ' 截图不是有效 JPEG/PNG/WebP：' + item.image);
    return false;
  }
  if (info.width && info.height && (info.width < 100 || info.height < 60)) {
    fail(label + ' 截图尺寸过小（' + info.width + '×' + info.height + '）：' + item.image);
    return false;
  }
  return true;
}

/* ---------- 读取数据 ---------- */
const categories = readJSON(path.join(DATA_DIR, 'categories.json')) || { resource: [], tool: [] };
const sourceFile = readJSON(path.join(DATA_DIR, 'sources.json')) || { meta: {}, sources: [] };
const resources = readJSON(path.join(DATA_DIR, 'resources.json')) || [];
const tools = readJSON(path.join(DATA_DIR, 'tools.json')) || [];
const biliFile = readJSON(path.join(DATA_DIR, 'bilibili.json'));
const githubPath = path.join(DATA_DIR, 'github.json');
const githubFile = fs.existsSync(githubPath) ? readJSON(githubPath) : null;

if (!Array.isArray(resources) || !Array.isArray(tools)) {
  fail('resources.json / tools.json 顶层必须是数组');
}

const meta = sourceFile.meta || {};
const TODAY = new Date().toISOString().slice(0, 10);
const DATA_VERSION = meta.fetchedAt || TODAY;
const sources = sourceFile.sources || [];

const resCatIds = new Set((categories.resource || []).map(c => c.id));
const toolCatIds = new Set((categories.tool || []).map(c => c.id));
const catDefs = {};
(categories.resource || []).forEach(c => { catDefs[c.id] = c; });
(categories.tool || []).forEach(c => { catDefs[c.id] = c; });

const sourceIds = new Set(sources.map(s => s.id));
const items = resources.concat(tools);
const seenIds = new Set();
const seenNames = new Map();

/* ---------- 条目校验 ---------- */
let imageCount = 0;

items.forEach((item, idx) => {
  const label = '条目 #' + (idx + 1) + '「' + (item && item.name ? item.name : '?') + '」';

  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    fail(label + ' 不是对象');
    return;
  }

  FIELDS.forEach(f => {
    if (!(f in item)) fail(label + ' 缺少字段 ' + f);
  });

  if (typeof item.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(item.id)) {
    fail(label + ' id 只能用小写字母/数字/连字符：' + item.id);
  } else if (seenIds.has(item.id)) {
    fail(label + ' id 重复：' + item.id);
  } else {
    seenIds.add(item.id);
  }

  if (typeof item.name !== 'string' || !item.name.trim()) fail(label + ' name 为空');
  if (item.name && seenNames.has(item.name)) {
    warn(label + ' 名称与 ' + seenNames.get(item.name) + ' 重复：' + item.name);
  } else if (item.name) {
    seenNames.set(item.name, item.id);
  }

  if (item.kind !== 'resource' && item.kind !== 'tool') fail(label + ' kind 必须是 resource 或 tool');
  const allowedCats = item.kind === 'tool' ? toolCatIds : resCatIds;
  if (!allowedCats.has(item.category)) fail(label + ' category 与 kind 不匹配或不存在：' + item.category);
  const def = catDefs[item.category];
  if (!def) {
    fail(label + ' 分类不存在：' + item.category);
  } else if (!(def.subcategories || []).includes(item.subcategory)) {
    fail(label + ' subcategory 不在分类 schema 中：' + item.subcategory);
  }

  if (item.priceType !== 'free' && item.priceType !== 'paid') fail(label + ' priceType 必须是 free 或 paid');

  ['license', 'engine', 'format', 'size', 'notes'].forEach(f => {
    if (typeof item[f] !== 'string' || !item[f].trim()) fail(label + ' ' + f + ' 不能为空（未知请填「未获取」）');
  });

  if (!isURL(item.obtain)) fail(label + ' obtain 不是 http(s) 链接：' + item.obtain);
  if (!isURL(item.source)) fail(label + ' source 不是 http(s) 链接：' + item.source);

  if (item.priceType === 'paid') {
    if (item.price == null) {
      if (item.currency !== null) fail(label + ' 付费条目价格未获取时 currency 必须为 null');
      if (typeof item.notes !== 'string' || item.notes.indexOf('未获取') === -1) {
        fail(label + ' 付费条目价格为空时 notes 必须显式写「未获取」并注明页面显示形式');
      }
    } else {
      if (typeof item.price !== 'number' || !isFinite(item.price) || item.price <= 0) {
        fail(label + ' 付费条目 price 必须是正数或 null');
      }
      if (typeof item.currency !== 'string' || !item.currency) fail(label + ' 付费条目 currency 不能为空');
    }
    if (item.rating != null && (typeof item.rating !== 'number' || item.rating < 0 || item.rating > 5)) {
      fail(label + ' 付费条目 rating 必须是 0–5 的数字或 null');
    }
    if (item.reviews != null && (typeof item.reviews !== 'number' || !isFinite(item.reviews) || item.reviews < 0)) {
      fail(label + ' 付费条目 reviews 必须是 ≥0 的数字或 null');
    }
  } else {
    if (item.price !== null) fail(label + ' 免费条目 price 必须为 null');
    if (item.currency !== null) fail(label + ' 免费条目 currency 必须为 null');
    if (item.rating != null && (typeof item.rating !== 'number' || item.rating < 0 || item.rating > 5)) {
      fail(label + ' rating 必须是 0–5 的数字或 null');
    }
    if (item.reviews != null && (typeof item.reviews !== 'number' || item.reviews < 0)) {
      fail(label + ' reviews 必须是 ≥0 的数字或 null');
    }
  }

  if (!Array.isArray(item.tags) || !item.tags.length || item.tags.some(t => typeof t !== 'string' || !t.trim())) {
    fail(label + ' tags 必须是非空字符串数组');
  }

  if (typeof item.verified !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.verified)) {
    fail(label + ' verified 必须是 YYYY-MM-DD：' + item.verified);
  }

  if (!item.extra || typeof item.extra !== 'object' || Array.isArray(item.extra)) {
    fail(label + ' extra 必须是对象（可为 {}）');
  }

  if (checkImage(item, label)) imageCount++;

  if (item.priceType === 'paid' && item.reviews != null && item.reviews < 10) {
    warn(label + ' 评价样本少（' + item.reviews + ' 条），页面已标注');
  }
});

/* ---------- B 站信息源校验与聚合 ---------- */
const BILI_STATUS = new Set(['verified', 'pending', 'dead', 'paid', 'removed', 'unverifiable']);
const BILI_ORIGINS = new Set(['简介', '评论', '字幕']);
// 同一资源被多条视频提及时取最确定的结论：已核实 > 已收费 > 已下架 > 渠道穷尽无法核实 > 历史失效 > 待核实
const BILI_STATUS_RANK = { verified: 6, paid: 5, removed: 4, unverifiable: 3, dead: 2, pending: 1 };
const BILI_STATUS_LABEL = {
  verified: '已核实', pending: '待核实', dead: '失效', paid: '已收费', removed: '已下架', unverifiable: '查过但无法确认'
};
let bilibili = null;

function isDate(s) { return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s); }
function normUrl(s) {
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.origin + u.pathname).toLowerCase().replace(/\/+$/, '');
  } catch (e) { return null; }
}

if (!biliFile || typeof biliFile !== 'object' || Array.isArray(biliFile)) {
  fail('data/bilibili.json 缺失或顶层不是对象');
} else {
  const bm = biliFile.meta || {};
  const videos = biliFile.videos;
  if (!isDate(bm.fetchedAt)) fail('bilibili.meta.fetchedAt 必须是 YYYY-MM-DD');
  if (!Array.isArray(videos) || !videos.length) {
    fail('bilibili.videos 必须是非空数组');
  } else {
    const seenBv = new Set();
    const aggMap = new Map();
    const aggOrder = [];
    const byUp = {};
    const byKeyword = {};
    const byOrigin = { '简介': 0, '评论': 0, '字幕': 0 };
    let mentionCount = 0;
    let withComments = 0;
    let withSubtitles = 0;
    let descOk = 0;
    let subtitleTextCount = 0;

    videos.forEach((v, vi) => {
      const label = 'B 站视频 #' + (vi + 1) + '「' + (v && v.bvid ? v.bvid : '?') + '」';
      if (!v || typeof v !== 'object' || Array.isArray(v)) { fail(label + ' 不是对象'); return; }

      if (typeof v.bvid !== 'string' || !/^BV[0-9A-Za-z]{10}$/.test(v.bvid)) {
        fail(label + ' bvid 格式不合法：' + v.bvid);
      } else if (seenBv.has(v.bvid)) {
        fail(label + ' bvid 重复：' + v.bvid);
      } else {
        seenBv.add(v.bvid);
      }

      if (typeof v.id !== 'string' || v.id !== String(v.bvid).toLowerCase()) {
        fail(label + ' id 必须等于 bvid 小写：' + v.id);
      }
      if (!isURL(v.url) || !/^https:\/\/www\.bilibili\.com\/video\/BV[0-9A-Za-z]{10}\/?$/.test(v.url)) {
        fail(label + ' B 站链接格式不正确：' + v.url);
      }
      ['title', 'up', 'keyword'].forEach(f => {
        if (typeof v[f] !== 'string' || !v[f].trim()) fail(label + ' ' + f + ' 不能为空');
      });
      if (v.views != null && (typeof v.views !== 'number' || !isFinite(v.views) || v.views < 0)) {
        fail(label + ' views 必须是 ≥0 的数字或 null');
      }
      ['likes', 'favorites'].forEach(f => {
        const val = v[f];
        if (val != null && val !== '未获取' && (typeof val !== 'number' || !isFinite(val) || val < 0)) {
          fail(label + ' ' + f + ' 必须是 ≥0 的整数或「未获取」');
        }
      });
      if (!isDate(v.publishedAt)) fail(label + ' publishedAt 必须是 YYYY-MM-DD');
      if (typeof v.desc !== 'string' || !v.desc.trim()) fail(label + ' desc 不能为空（未知请填「未获取」）');
      if (!isDate(v.descFetchedAt)) fail(label + ' descFetchedAt 必须是 YYYY-MM-DD');
      if (v.desc && v.desc !== '未获取') descOk++;

      if (!Array.isArray(v.comments)) fail(label + ' comments 必须是数组');
      (v.comments || []).forEach((c, ci) => {
        if (!c || typeof c.text !== 'string' || !c.text.trim()) fail(label + ' 评论 #' + (ci + 1) + ' 文本为空');
        if (c && c.origin !== '评论') fail(label + ' 评论 origin 必须是「评论」');
        if (c && c.like != null && (typeof c.like !== 'number' || c.like < 0)) fail(label + ' 评论 like 必须是 ≥0 的数字或 null');
      });
      if ((v.comments || []).length) withComments++;

      if (!Array.isArray(v.subtitles)) fail(label + ' subtitles 必须是数组');
      (v.subtitles || []).forEach((s, si) => {
        if (!s || typeof s.text !== 'string' || !s.text.trim()) fail(label + ' 字幕 #' + (si + 1) + ' 文本不能为空');
        if (!s || typeof s.lang !== 'string' || !s.lang.trim()) fail(label + ' 字幕 #' + (si + 1) + ' lang 不能为空');
        if (typeof s.auto !== 'boolean') fail(label + ' 字幕 #' + (si + 1) + ' auto 必须是布尔值');
        if (typeof s.source !== 'string' || !s.source.trim()) fail(label + ' 字幕 #' + (si + 1) + ' source 不能为空');
        if (!isDate(s.fetchedAt)) fail(label + ' 字幕 #' + (si + 1) + ' fetchedAt 必须是 YYYY-MM-DD');
        subtitleTextCount++;
      });
      if ((v.subtitles || []).length) withSubtitles++;
      if (typeof v.subtitleStatus !== 'string' || !v.subtitleStatus.trim()) fail(label + ' subtitleStatus 不能为空');

      if (!Array.isArray(v.mentions) || !v.mentions.length) {
        warn(label + ' 没有任何资源线索（mentions 为空）');
      }
      const seenMention = new Set();
      (v.mentions || []).forEach((m, mi) => {
        const ml = label + ' 线索 #' + (mi + 1);
        if (!m || typeof m.name !== 'string' || !m.name.trim()) { fail(ml + ' name 不能为空'); return; }
        if (typeof m.type !== 'string' || !m.type.trim()) fail(ml + ' type 不能为空');
        if (typeof m.free !== 'boolean') fail(ml + ' free 必须是布尔值');
        if (!BILI_STATUS.has(m.status)) fail(ml + ' status 必须是 verified/pending/paid/removed/dead/unverifiable：' + m.status);
        if (m.status === 'verified' && m.free !== true) fail(ml + ' 已核实条目 free 必须为 true');
        if (m.status === 'paid' && m.free !== false) fail(ml + ' 已收费条目 free 必须为 false');
        if ((m.status === 'removed' || m.status === 'dead') && m.free !== false) {
          fail(ml + ' 已下架/失效条目 free 必须为 false');
        }
        if (m.status === 'unverifiable' && m.free !== false) {
          fail(ml + ' 查过但无法确认条目 free 必须为 false');
        }
        if (m.status === 'verified' && !isURL(m.officialUrl)) {
          fail(ml + ' 已核实条目必须给出可打开的 officialUrl 作为证据');
        }
        if (m.recheck != null) {
          const r = m.recheck;
          if (typeof r !== 'object' || Array.isArray(r)) {
            fail(ml + ' recheck 必须是对象');
          } else {
            if (!isDate(r.at)) fail(ml + ' recheck.at 必须是 YYYY-MM-DD');
            if (!['free', 'paid', 'removed', 'unverifiable', 'pending'].includes(r.verdict)) {
              fail(ml + ' recheck.verdict 必须是 free/paid/removed/unverifiable/pending：' + r.verdict);
            }
            if (typeof r.method !== 'string' || !r.method.trim()) fail(ml + ' recheck.method 不能为空');
            if (r.evidenceUrl != null && !isURL(r.evidenceUrl)) fail(ml + ' recheck.evidenceUrl 不是 http(s) 链接');
            if (typeof r.note !== 'string' || !r.note.trim()) fail(ml + ' recheck.note 不能为空');
            if (r.channels != null && (!Array.isArray(r.channels) || r.channels.some(c => typeof c !== 'string' || !c.trim()))) {
              fail(ml + ' recheck.channels 必须是非空字符串数组或省略');
            }
          }
        }
        if (!BILI_ORIGINS.has(m.origin)) fail(ml + ' origin 必须是 简介/评论/字幕：' + m.origin);
        if (m.ts != null && (typeof m.ts !== 'number' || !isFinite(m.ts) || m.ts < 0)) {
          fail(ml + ' ts 必须是 ≥0 的秒数或 null');
        }
        if (m.rawUrl != null && !isURL(m.rawUrl)) fail(ml + ' rawUrl 不是 http(s) 链接：' + m.rawUrl);
        if (m.officialUrl != null && !isURL(m.officialUrl)) fail(ml + ' officialUrl 不是 http(s) 链接：' + m.officialUrl);
        if (typeof m.thirdParty !== 'boolean') fail(ml + ' thirdParty 必须是布尔值');
        if (typeof m.note !== 'string' || !m.note.trim()) fail(ml + ' note 不能为空');
        if (m.resourceId != null && !seenIds.has(m.resourceId)) {
          fail(ml + ' resourceId 在主目录中不存在：' + m.resourceId);
        }

        const dk = [m.name.trim().toLowerCase(), normUrl(m.officialUrl) || '', m.origin, m.ts == null ? '' : m.ts].join('|');
        if (seenMention.has(dk)) fail(ml + ' 同一视频内线索重复（名称/官方链接/来源/时间戳相同）');
        seenMention.add(dk);
        byOrigin[m.origin]++;
        mentionCount++;

        // 跨视频按资源聚合：优先官方链接，其次名称
        const key = normUrl(m.officialUrl) || ('name:' + m.name.trim().toLowerCase());
        if (!aggMap.has(key)) {
          aggMap.set(key, {
            key, name: m.name.trim(), type: m.type.trim(), free: false,
            status: m.status, origins: [], videos: [], rawUrl: m.rawUrl,
            officialUrl: m.officialUrl, thirdParty: false, notes: [],
            resourceId: m.resourceId || null
          });
          aggOrder.push(key);
        }
        const a = aggMap.get(key);
        a.free = a.free || m.free;
        if ((BILI_STATUS_RANK[m.status] || 0) > (BILI_STATUS_RANK[a.status] || 0)) a.status = m.status;
        if (m.origin && a.origins.indexOf(m.origin) === -1) a.origins.push(m.origin);
        if (!a.rawUrl && m.rawUrl) a.rawUrl = m.rawUrl;
        if (!a.officialUrl && m.officialUrl) a.officialUrl = m.officialUrl;
        if (!a.resourceId && m.resourceId) a.resourceId = m.resourceId;
        a.thirdParty = a.thirdParty || m.thirdParty;
        if (a.notes.indexOf(m.note) === -1) a.notes.push(m.note);
        const vk = v.bvid + '|' + m.origin + '|' + (m.ts == null ? '' : m.ts);
        if (!a.videos.some(x => x.key === vk)) {
          a.videos.push({
            key: vk, bvid: v.bvid,
            url: 'https://www.bilibili.com/video/' + v.bvid + (m.ts != null ? '?t=' + Math.floor(m.ts) : ''),
            title: v.title, up: v.up, origin: m.origin, ts: m.ts
          });
        }
      });

      byUp[v.up] = (byUp[v.up] || 0) + 1;
      byKeyword[v.keyword] = (byKeyword[v.keyword] || 0) + 1;
    });

    const aggResources = aggOrder.map(k => aggMap.get(k));
    aggResources.forEach(r => {
      if (r.status === 'verified') r.free = true;
      else if (r.status === 'paid' || r.status === 'removed' || r.status === 'dead' || r.status === 'unverifiable') r.free = false;
    });
    const statusCount = { verified: 0, pending: 0, dead: 0, paid: 0, removed: 0, unverifiable: 0 };
    aggResources.forEach(r => { statusCount[r.status] = (statusCount[r.status] || 0) + 1; });
    const byType = {};
    aggResources.forEach(r => { byType[r.type] = (byType[r.type] || 0) + 1; });

    bilibili = {
      meta: bm,
      videos,
      resources: aggResources,
      stats: {
        videos: videos.length,
        mentions: mentionCount,
        resources: aggResources.length,
        verified: statusCount.verified,
        pending: statusCount.pending,
        dead: statusCount.dead,
        paid: statusCount.paid,
        removed: statusCount.removed,
        unverifiable: statusCount.unverifiable,
        freeResources: aggResources.filter(r => r.free).length,
        paidResources: aggResources.filter(r => !r.free).length,
        withComments,
        withSubtitles,
        descCoverage: videos.length ? round1(descOk / videos.length * 100) : 0,
        subtitleTextCount,
        byType,
        byUp,
        byKeyword,
        byOrigin,
        pendingImages
      }
    };

    const pendingPayload = {
      meta: {
        generatedAt: bm.fetchedAt || '',
        fetchedAt: bm.fetchedAt || '',
        total: statusCount.pending + statusCount.dead + statusCount.paid + statusCount.removed + statusCount.unverifiable,
        note: '由 data/bilibili.json 自动生成，请勿手改；只收录待核实/已收费/已下架/无法确认/失效线索，不进入主力目录。'
      },
      items: aggResources.filter(r => r.status !== 'verified')
    };
    fs.writeFileSync(path.join(DATA_DIR, 'bilibili-pending.json'), JSON.stringify(pendingPayload, null, 2) + '\n', 'utf8');

    if (statusCount.verified) {
      console.log('B 站：' + videos.length + ' 条视频 / ' + mentionCount + ' 条线索 / ' +
        aggResources.length + ' 个去重资源（已核实 ' + statusCount.verified +
        ' / 待核实 ' + statusCount.pending + ' / 已收费 ' + statusCount.paid +
        ' / 已下架 ' + statusCount.removed + ' / 无法确认 ' + statusCount.unverifiable +
        ' / 失效 ' + statusCount.dead + '）');
    }
  }
}

/* ---------- GitHub 插件校验、人气分档与并入工具 ---------- */
const GH_GROUPS = {
  '编辑器效率': 'editor',
  '蓝图与脚本': 'blueprint-script',
  '性能调试': 'perf-debug',
  '版本管理与协作': 'vcs',
  'AI辅助': 'ai',
  '美术与关卡': 'art-level'
};
const GH_ACTIVITY = new Set(['active', 'normal', 'stale', 'archived']);
const GH_ACTIVITY_RANK = { active: 4, normal: 3, stale: 2, archived: 1 };
let github = { meta: {}, items: [] };

function monthsBetween(from, to) {
  const a = new Date(from + 'T00:00:00Z');
  const b = new Date(to + 'T00:00:00Z');
  return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

if (githubFile) {
  if (!Array.isArray(githubFile.items)) {
    fail('data/github.json items 必须是数组');
  } else {
    const gh = githubFile.items.map((g, idx) => {
      const gl = 'GitHub #' + (idx + 1) + '「' + (g && (g.repo || g.name) ? (g.repo || g.name) : '?') + '」';
      if (!g || typeof g !== 'object') { fail(gl + ' 不是对象'); return null; }
      if (typeof g.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(g.id)) fail(gl + ' id 非法');
      if (typeof g.repo !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(g.repo)) fail(gl + ' repo 必须是 owner/name');
      if (!isURL(g.url) || !/^https:\/\/github\.com\//i.test(g.url)) fail(gl + ' url 必须是 github.com 链接');
      if (typeof g.description !== 'string' || !g.description.trim()) fail(gl + ' description 不能为空');
      if (!GH_GROUPS[g.group]) fail(gl + ' group 非法：' + g.group);
      if (typeof g.license !== 'string' || !g.license.trim()) fail(gl + ' license 不能为空');
      if (!Number.isInteger(g.stars) || g.stars < 0) fail(gl + ' stars 必须是整数');
      if (!Number.isInteger(g.forks) || g.forks < 0) fail(gl + ' forks 必须是整数');
      if (!Number.isInteger(g.openIssues) && g.openIssues != null) fail(gl + ' openIssues 必须是整数或 null');
      if (!isDate(g.pushedAt)) fail(gl + ' pushedAt 必须是 YYYY-MM-DD');
      if (!(g.lastRelease === '未获取' || g.lastRelease === '无 release' ||
        (typeof g.lastRelease === 'string' && /（(\d{4}-\d{2}-\d{2})）$/.test(g.lastRelease) && isDate(g.lastRelease.match(/（(\d{4}-\d{2}-\d{2})）/)[1])))) {
        fail(gl + ' lastRelease 必须是「未获取」/「无 release」/「tag（YYYY-MM-DD）」');
      }
      if (typeof g.archived !== 'boolean') fail(gl + ' archived 必须是布尔值');
      if (!GH_ACTIVITY.has(g.activity)) fail(gl + ' activity 非法：' + g.activity);
      if (g.archived && g.activity !== 'archived') fail(gl + ' archived=true 时 activity 必须是 archived');
      if (!g.archived && g.activity === 'archived') fail(gl + ' archived=false 时 activity 不能是 archived');
      if (!g.archived && isDate(g.pushedAt)) {
        const m = monthsBetween(g.pushedAt, TODAY);
        const expect = m <= 6 ? 'active' : (m <= 12 ? 'normal' : 'stale');
        if (g.activity !== expect) fail(gl + ' activity 与 pushedAt 不一致（应为 ' + expect + '）');
      }
      if (g.image && (!g.image.startsWith('assets/img/') || !fs.existsSync(path.join(ROOT, g.image)))) {
        fail(gl + ' 截图不存在：' + g.image);
      }
      if (typeof g.hasDocs !== 'boolean') warn(gl + ' hasDocs 未填，按 false 处理');
      ['likes', 'reviewCount'].forEach(f => {
        if (g[f] != null && g[f] !== '未获取' && !Number.isInteger(g[f])) {
          fail(gl + ' ' + f + ' 必须是整数或「未获取」');
        }
      });
      if (g.rating != null && g.rating !== '未获取' && typeof g.rating !== 'number') {
        fail(gl + ' rating 必须是数字或「未获取」');
      }
      return Object.assign({}, g);
    }).filter(Boolean);

    // 分组内前 20% 人气阈值（按 stars 降序取第 20% 位）
    const byGroupStars = {};
    gh.forEach(g => { (byGroupStars[g.group] = byGroupStars[g.group] || []).push(g.stars); });
    const groupThreshold = {};
    Object.keys(byGroupStars).forEach(k => {
      const arr = byGroupStars[k].slice().sort((a, b) => b - a);
      const idx = Math.max(0, Math.ceil(arr.length * 0.2) - 1);
      groupThreshold[k] = arr[idx];
    });

    const ghCounts = { total: 0, recommended: 0, active: 0, normal: 0, stale: 0, archived: 0, stalePopular: 0, lowPopular: 0, byGroup: {} };
    gh.forEach(g => {
      const highPopular = g.stars >= 300 || g.stars >= (groupThreshold[g.group] || 0);
      let popularityTier;
      let recommended;
      let badge;
      if (g.archived) {
        popularityTier = 'archived';
        recommended = false;
        badge = '归档，谨慎使用';
      } else if (g.activity === 'stale' && highPopular) {
        popularityTier = 'stale-popular';
        recommended = true;
        badge = '久未更新，社区常用';
      } else if (g.activity === 'stale') {
        popularityTier = 'low-popular';
        recommended = false;
        badge = '久未更新且人气低，存疑';
      } else {
        popularityTier = 'recommended';
        recommended = true;
        badge = g.activity === 'active' ? '活跃' : '一般活跃';
      }
      g.popularityTier = popularityTier;
      g.recommended = recommended;
      g.badge = badge;
      g.highPopular = highPopular;
      g.groupRankThreshold = groupThreshold[g.group];
      // 综合热度：可复现的整数排序键（星标为主、fork 与评价为辅）
      g.heat = g.stars * 2 + g.forks + (g.openIssues == null ? 0 : Math.max(0, 30 - g.openIssues));
      ghCounts.total++;
      if (recommended) ghCounts.recommended++;
      ghCounts[g.activity]++;
      if (popularityTier === 'stale-popular') ghCounts.stalePopular++;
      if (popularityTier === 'low-popular') ghCounts.lowPopular++;
      ghCounts.byGroup[g.group] = (ghCounts.byGroup[g.group] || 0) + 1;
    });

    github = { meta: githubFile.meta || {}, items: gh, counts: ghCounts };

    // 并入工具条目（按 GitHub 仓库全名去重）；独立 GitHub 视图仍用自己的分片
    const seenRepo = new Set();
    tools.concat(items).forEach(x => {
      try {
        const u = new URL(x.source || '');
        if (u.hostname.replace(/^www\./, '') === 'github.com') {
          seenRepo.add(u.pathname.replace(/^\/+|\/+$/g, '').toLowerCase());
        }
      } catch (e) { /* ignore */ }
    });
    gh.forEach(g => {
      const repoKey = g.repo.toLowerCase();
      if (seenRepo.has(repoKey)) { warn('GitHub 仓库与现有条目重复，已跳过：' + g.repo); return; }
      if (seenIds.has(g.id)) { warn('GitHub 条目 id 重复，已跳过：' + g.id); return; }
      seenIds.add(g.id);
      seenRepo.add(repoKey);
      if (g.image) {
        imageCount++;
      } else {
        warn('GitHub 条目无预览图，已列入「待补图」：' + g.repo);
        pendingImages.push({ id: g.id, name: g.name || g.repo, reason: 'GitHub 仓库缺 OG 预览图' });
      }
      const cat = GH_GROUPS[g.group];
      const def = catDefs[cat] || { subcategories: [] };
      items.push({
        id: g.id,
        name: g.name || g.repo,
        kind: 'tool',
        category: cat,
        subcategory: (def.subcategories || [])[0] || '其他',
        priceType: 'free',
        license: g.license,
        engine: g.ueVersion || '未获取',
        format: 'GitHub 仓库（源码 / .uplugin）',
        size: '未获取',
        obtain: g.url,
        source: g.url,
        price: null,
        currency: null,
        rating: null,
        reviews: null,
        notes: (g.description || '') + ' 安装：' + (g.install || '未获取') + '；活跃度：' + g.badge +
          '；最后提交 ' + g.pushedAt + (g.licenseRisk && g.licenseRisk !== '无' ? '；许可风险：' + g.licenseRisk : ''),
        image: g.image || '',
        tags: ['GitHub', 'UE 插件', g.group].concat(g.topics || []).slice(0, 6),
        verified: g.verified || TODAY,
        extra: {
          github: true,
          repo: g.repo,
          author: g.author,
          stars: g.stars,
          forks: g.forks,
          openIssues: g.openIssues,
          activity: g.activity,
          archived: g.archived,
          activityBadge: g.badge,
          popularityTier: g.popularityTier,
          recommended: g.recommended,
          heat: g.heat,
          highPopular: g.highPopular,
          lastRelease: g.lastRelease,
          install: g.install,
          ueVersion: g.ueVersion,
          hasDocs: g.hasDocs,
          platformNote: g.platformNote,
          licenseRisk: g.licenseRisk
        }
      });
    });
  }
}

/* ---------- 复核证据缓存校验（可选文件） ---------- */
const evidencePath = path.join(DATA_DIR, 'recheck-evidence.json');
if (fs.existsSync(evidencePath)) {
  const ev = readJSON(evidencePath);
  if (ev) {
    if (!Array.isArray(ev.entries)) {
      fail('recheck-evidence.json entries 必须是数组');
    } else {
      const seenEv = new Set();
      ev.entries.forEach((e, i) => {
        const el = 'recheck-evidence #' + (i + 1);
        if (!e || typeof e.name !== 'string' || !e.name.trim()) { fail(el + ' name 不能为空'); return; }
        if (seenEv.has(e.name)) fail(el + ' name 重复：' + e.name);
        seenEv.add(e.name);
        if (!['free', 'paid', 'removed', 'unverifiable', 'pending'].includes(e.verdict)) {
          fail(el + ' verdict 必须是 free/paid/removed/unverifiable/pending：' + e.verdict);
        }
        if (typeof e.free !== 'boolean') fail(el + ' free 必须是布尔值');
        if (e.verdict === 'free' && e.free !== true) fail(el + ' verdict=free 时 free 必须为 true');
        if (e.verdict !== 'free' && e.verdict !== 'pending' && e.free !== false) {
          fail(el + ' verdict=' + e.verdict + ' 时 free 必须为 false');
        }
        if (e.verdict === 'unverifiable' && (!Array.isArray(e.channels) || !e.channels.length)) {
          fail(el + ' verdict=unverifiable 必须列出 channels（查过的渠道）');
        }
        if (e.channels != null && (!Array.isArray(e.channels) || e.channels.some(c => typeof c !== 'string' || !c.trim()))) {
          fail(el + ' channels 必须是非空字符串数组或省略');
        }
        if (e.verdict === 'free' && !isURL(e.officialUrl) && !isURL(e.evidenceUrl)) {
          fail(el + ' verdict=free 必须给出 officialUrl 或 evidenceUrl');
        }
        ['officialUrl', 'evidenceUrl'].forEach(f => {
          if (e[f] != null && !isURL(e[f])) fail(el + ' ' + f + ' 不是 http(s) 链接');
        });
        if (typeof e.note !== 'string' || !e.note.trim()) fail(el + ' note 不能为空');
        if (!isDate(e.checkedAt)) fail(el + ' checkedAt 必须是 YYYY-MM-DD');
      });
    }
  }
}

/* ---------- 统计 ---------- */
const total = items.length;
const free = items.filter(x => x.priceType === 'free').length;
const paid = items.filter(x => x.priceType === 'paid').length;
const resourceCount = items.filter(x => x.kind === 'resource').length;
const toolCount = items.filter(x => x.kind === 'tool').length;

const byCategory = {};
Object.keys(catDefs).forEach(id => { byCategory[id] = { total: 0, free: 0, paid: 0 }; });
items.forEach(x => {
  if (!byCategory[x.category]) byCategory[x.category] = { total: 0, free: 0, paid: 0 };
  byCategory[x.category].total++;
  byCategory[x.category][x.priceType]++;
});

function sourceKey(x) {
  let host = '';
  try { host = new URL(x.source).hostname.toLowerCase(); } catch (e) { /* ignore */ }
  if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
  if (host === 'fab.com' || host.endsWith('.fab.com')) {
    const tags = x.tags || [];
    const tagText = tags.join('|');
    if (tagText.indexOf('Epic官方') > -1 || tagText.indexOf('Epic 官方') > -1 || tags.indexOf('Epic Games') > -1) return 'epic-samples';
    if (tagText.indexOf('Quixel') > -1) return 'quixel';
    return 'fab';
  }
  const first = (x.tags || [])[0] || '';
  const map = {
    'Poly Haven': 'polyhaven', 'ambientCG': 'ambientcg', 'Kenney': 'kenney',
    'OpenGameArt': 'opengameart', 'Sketchfab': 'sketchfab', 'Fab': 'fab',
    'Epic Games': 'epic-samples', 'Epic官方': 'epic-samples', 'Epic 官方': 'epic-samples',
    'GitHub': 'github', 'Quaternius': 'quaternius'
  };
  return map[first] || 'other';
}

const bySource = {};
items.forEach(x => {
  const k = sourceKey(x);
  if (!sourceIds.has(k)) warn('来源未在 sources.json 中登记：' + k + '（条目 ' + x.id + '）');
  bySource[k] = (bySource[k] || 0) + 1;
});

const stats = {
  total,
  resources: resourceCount,
  tools: toolCount,
  free,
  paid,
  freeRatio: total ? round1(free / total * 100) : 0,
  imageCount,
  imageCoverage: total ? round1(imageCount / total * 100) : 0,
  lowSamplePaid: items.filter(x => x.priceType === 'paid' && x.reviews != null && x.reviews < 10).length,
  archived: items.filter(x => x.extra && x.extra.archived).length,
  byCategory,
  bySource,
  byKind: {
    resource: {
      total: resourceCount,
      free: items.filter(x => x.kind === 'resource' && x.priceType === 'free').length,
      paid: items.filter(x => x.kind === 'resource' && x.priceType === 'paid').length
    },
    tool: {
      total: toolCount,
      free: items.filter(x => x.kind === 'tool' && x.priceType === 'free').length,
      paid: items.filter(x => x.kind === 'tool' && x.priceType === 'paid').length
    }
  },
  pendingImages
};

/* ---------- 未引用图片 ---------- */
const usedImages = new Set(items.map(x => x.image).filter(Boolean));
if (fs.existsSync(IMG_DIR)) {
  const walk = dir => {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(ent => {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.(jpg|jpeg|png|webp)$/i.test(ent.name)) {
        const rel = path.relative(ROOT, p).split(path.sep).join('/');
        if (!usedImages.has(rel)) warn('未被任何条目引用的图片：' + rel);
      }
    });
  };
  walk(IMG_DIR);
}

/* ---------- 口径 counts ---------- */
function countsFor(kind) {
  const out = { total: 0, free: 0, paid: 0, byCategory: {} };
  items.filter(x => x.kind === kind).forEach(x => {
    out.total++;
    out[x.priceType]++;
    const c = out.byCategory[x.category] = out.byCategory[x.category] || { total: 0, free: 0, paid: 0 };
    c.total++;
    c[x.priceType]++;
  });
  return out;
}
const resCounts = countsFor('resource');
const toolCounts = countsFor('tool');
const biliStats = (bilibili && bilibili.stats) ? bilibili.stats : {
  videos: 0, mentions: 0, resources: 0, verified: 0, pending: 0, dead: 0,
  paid: 0, removed: 0, unverifiable: 0, pendingImages
};
const counts = {
  resources: resCounts,
  tools: toolCounts,
  github: github.counts || { total: 0, recommended: 0, active: 0, normal: 0, stale: 0, archived: 0, stalePopular: 0, lowPopular: 0, byGroup: {} },
  bili: {
    videos: biliStats.videos, mentions: biliStats.mentions, resources: biliStats.resources,
    verified: biliStats.verified, pending: biliStats.pending, paid: biliStats.paid,
    removed: biliStats.removed, unverifiable: biliStats.unverifiable, dead: biliStats.dead
  },
  lists: {
    pendingImages: pendingImages.length,
    pending: biliStats.pending + biliStats.unverifiable,
    removed: biliStats.removed + biliStats.dead
  }
};

/* ---------- 输出分片数据 ---------- */
const resourcesShard = {
  version: DATA_VERSION,
  generatedAt: TODAY,
  items: items.filter(x => x.kind === 'resource')
};
const toolsShard = {
  version: DATA_VERSION,
  generatedAt: TODAY,
  items: items.filter(x => x.kind === 'tool')
};
const biliShard = {
  version: DATA_VERSION,
  generatedAt: TODAY,
  meta: bilibili ? bilibili.meta : {},
  videos: bilibili ? bilibili.videos : [],
  resources: bilibili ? bilibili.resources : [],
  stats: biliStats
};
const pendingShard = {
  version: DATA_VERSION,
  generatedAt: TODAY,
  items: bilibili ? bilibili.resources.filter(r => r.status !== 'verified') : [],
  pendingImages
};
const githubShard = {
  version: DATA_VERSION,
  generatedAt: TODAY,
  meta: github.meta || {},
  counts: counts.github,
  items: github.items || []
};
const coreShard = {
  version: DATA_VERSION,
  generatedAt: TODAY,
  meta,
  categories,
  sources,
  stats,
  counts,
  biliStats,
  githubStats: counts.github,
  items: []
};

const shards = [
  ['core.js', 'UEHUB_CORE', coreShard],
  ['resources.js', 'UEHUB_RESOURCES', resourcesShard],
  ['tools.js', 'UEHUB_TOOLS', toolsShard],
  ['bilibili.js', 'UEHUB_BILI', biliShard],
  ['pending.js', 'UEHUB_PENDING', pendingShard],
  ['github.js', 'UEHUB_GITHUB', githubShard]
];

const payload = { meta, categories, sources, stats, counts, bilibili, github: githubShard, items };

/* 分片完整性：每个分片必须能被独立解析，且带 version 与 items */
shards.forEach(([file, globalName, data]) => {
  const js = '/* 自动生成：node scripts/build.js；请勿手改 */\n' +
    'window.' + globalName + ' = ' + JSON.stringify(data) + ';\n';
  try {
    const sandbox = { window: {} };
    vm.runInNewContext(js, sandbox, { timeout: 2000 });
    const got = sandbox.window[globalName];
    if (!got || typeof got !== 'object') fail('分片 ' + file + ' 无法解析');
    else if (!got.version || !isDate(got.version)) fail('分片 ' + file + ' 缺少合法 version');
    else if (!Array.isArray(got.items) && !Array.isArray(got.videos)) fail('分片 ' + file + ' 缺少 items/videos 数组');
  } catch (e) {
    fail('分片 ' + file + ' 语法错误：' + e.message);
  }
});

const outJson = path.join(ROOT, 'assets.json');

if (!errors.length) {
  shards.forEach(([file, , data]) => {
    const js = '/* 自动生成：node scripts/build.js；请勿手改 */\n' +
      'window.' + shards.find(s => s[0] === file)[1] + ' = ' + JSON.stringify(data) + ';\n';
    fs.writeFileSync(path.join(DATA_DIR, file), js, 'utf8');
  });
  fs.writeFileSync(outJson, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  const oldAssets = path.join(DATA_DIR, 'assets.js');
  if (fs.existsSync(oldAssets)) {
    fs.unlinkSync(oldAssets);
    console.log('已移除旧的 data/assets.js（改为按视图分片）');
  }
}

/* ---------- 页面构建 / 校验 ---------- */
const templatePath = path.join(SRC_DIR, 'index.template.html');
const cssPath = path.join(SRC_DIR, 'styles.css');
const appPath = path.join(SRC_DIR, 'app.js');
const htmlPath = path.join(ROOT, 'index.html');

let pageStatus = '未重建';

const REQUIRED_ROUTES = [
  '#/resources/free', '#/resources/paid', '#/tools/free', '#/tools/paid',
  '#/bilibili/verified', '#/bilibili/pending', '#/bilibili/paid', '#/bilibili/removed',
  '#/bilibili/unverifiable', '#/github', '#/github/stale',
  '#/lists/pending-images', '#/lists/pending', '#/lists/removed'
];

function validateHTML(html, tag) {
  if (!html || html.length < 1000) fail(tag + ' 内容过短');
  if (!html.includes('data/core.js')) fail(tag + ' 未引用 data/core.js（首屏分片）');
  if (html.includes('data/assets.js')) fail(tag + ' 仍在引用已废弃的 data/assets.js');
  ['nav', 'view', 'viewTitle', 'viewStats', 'toolbar', 'status', 'appError', 'viewModeBar'].forEach(id => {
    if (!html.includes('id="' + id + '"')) fail(tag + ' 缺少容器 #' + id);
  });
  if (!html.includes('data-mode="grid"') || !html.includes('data-mode="list"')) {
    fail(tag + ' 视图切换控件缺少 grid / list 两个模式按钮');
  }
  if (/<script[^>]+src=["']\s*["']/i.test(html)) fail(tag + ' 存在空 script src');
  if (/(href|src)\s*=\s*(""|'')/i.test(html)) fail(tag + ' 存在空链接 / 空 src');
  if (html.indexOf('/*__STYLES__*/') > -1 || html.indexOf('/*__APP__*/') > -1) {
    fail(tag + ' 仍包含未替换的模板标记');
  }
  const scriptOpen = (html.match(/<script/gi) || []).length;
  const scriptClose = (html.match(/<\/script>/gi) || []).length;
  if (scriptOpen !== scriptClose) fail(tag + ' script 标签数量不匹配（' + scriptOpen + ' 开 / ' + scriptClose + ' 关）');
  // 页面只保留外壳：不得内联任何条目名称（防止数据写死进 index.html）
  const leaked = items.filter(x => x.name && x.name.length >= 4 && html.indexOf(x.name) > -1).map(x => x.name);
  if (leaked.length) fail(tag + ' 内联了条目内容（应运行时从分片渲染）：' + leaked.slice(0, 5).join(' / '));
  // hash 路由必须全部接上；唯一性在 validateRoutes 中按 ROUTES 定义块校验
  REQUIRED_ROUTES.forEach(r => {
    if (html.indexOf("'" + r + "'") === -1) fail(tag + ' 路由未接入：' + r);
  });
}

/**
 * hash 路由不重复：只在渲染脚本的 ROUTES 定义块里校验，
 * 页面中的 <a href="#/..."> 是跳转链接，不属于路由定义。
 */
function validateRoutes(appSrc, tag) {
  const m = appSrc.match(/var\s+ROUTES\s*=\s*\{[\s\S]*?\n\s*\};/);
  if (!m) { fail(tag + ' 找不到 ROUTES 定义块'); return; }
  const routes = [];
  m[0].replace(/'#\/[^']*'/g, s => { routes.push(s.slice(1, -1)); return s; });
  const dup = routes.filter((r, i) => routes.indexOf(r) !== i);
  if (dup.length) fail(tag + ' ROUTES 存在重复路由：' + Array.from(new Set(dup)).join(' / '));
  REQUIRED_ROUTES.forEach(r => {
    const n = routes.filter(x => x === r).length;
    if (n !== 1) fail(tag + ' 路由 ' + r + ' 定义次数应为 1，实际 ' + n);
  });
  if (routes.length !== REQUIRED_ROUTES.length) {
    fail(tag + ' ROUTES 数量 ' + routes.length + '，应有 ' + REQUIRED_ROUTES.length + ' 条');
  }
}

/**
 * 视图模式：只允许 grid / list；模式必须进 hash，且两种模式共用同一份 list 数据。
 */
function validateViewModes(appSrc, tag) {
  const m = appSrc.match(/var\s+VIEW_MODES\s*=\s*\[([^\]]*)\]/);
  if (!m) { fail(tag + ' 找不到 VIEW_MODES 定义'); return; }
  const modes = m[1].split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  const expect = ['grid', 'list'];
  if (modes.length !== expect.length || expect.some(x => modes.indexOf(x) === -1)) {
    fail(tag + ' VIEW_MODES 只能是 grid / list，实际：' + modes.join(' / '));
  }
  if (appSrc.indexOf("put('view'") === -1) fail(tag + ' 视图模式未写入 hash（缺少 put(\'view\')）');
  if (appSrc.indexOf('localStorage.getItem(VIEW_MODE_KEY)') === -1 ||
      appSrc.indexOf('localStorage.setItem(VIEW_MODE_KEY') === -1) {
    fail(tag + ' 视图模式未持久化到 localStorage');
  }
  const renderDefs = (appSrc.match(/function\s+renderCollection\s*\(/g) || []).length;
  if (renderDefs !== 1) fail(tag + ' renderCollection 应只定义一次（两种模式共用同一数据源），实际 ' + renderDefs);
  const renderUses = (appSrc.match(/renderCollection\(/g) || []).length - 1;
  if (renderUses < 3) fail(tag + ' 资源 / GitHub / B 站视图应共用 renderCollection，实际调用 ' + renderUses + ' 次');
  if (appSrc.indexOf("VIEW_MODES.indexOf(qv)") === -1) fail(tag + ' 未校验 URL 中 view 取值合法性');
}

if (!fs.existsSync(templatePath)) {
  fail('缺少页面模板 src/index.template.html');
} else {
  const template = fs.readFileSync(templatePath, 'utf8');
  const css = fs.existsSync(cssPath) ? fs.readFileSync(cssPath, 'utf8') : '';
  const app = fs.existsSync(appPath) ? fs.readFileSync(appPath, 'utf8') : '';
  if (!css) fail('缺少 src/styles.css');
  if (!app) fail('缺少 src/app.js');
  if (template.indexOf('/*__STYLES__*/') === -1) fail('模板缺少 /*__STYLES__*/ 标记');
  if (template.indexOf('/*__APP__*/') === -1) fail('模板缺少 /*__APP__*/ 标记');

  const html = template.replace('/*__STYLES__*/', () => css).replace('/*__APP__*/', () => app);
  validateRoutes(app, '生成的 index.html');
  validateViewModes(app, '生成的 index.html');
  validateHTML(html, '生成的 index.html');

  if (rebuildPage || !fs.existsSync(htmlPath)) {
    if (!errors.length) {
      fs.writeFileSync(htmlPath, html, 'utf8');
      pageStatus = '已重建';
    }
  } else {
    const old = fs.readFileSync(htmlPath, 'utf8');
    validateHTML(old, '现有 index.html');
    pageStatus = '保持不变（修改模板后请加 --page）';
    if (fs.statSync(templatePath).mtimeMs > fs.statSync(htmlPath).mtimeMs ||
        fs.statSync(cssPath).mtimeMs > fs.statSync(htmlPath).mtimeMs ||
        fs.statSync(appPath).mtimeMs > fs.statSync(htmlPath).mtimeMs) {
      warn('src/ 模板或样式比 index.html 新，运行 node scripts/build.js --page 重建页面');
    }
  }
}

/* ---------- 报告 ---------- */
const line = '----------------------------------------';
console.log('\nUE 资源与工具索引 · 构建校验');
console.log(line);
console.log('条目总数：' + total + '（资源 ' + resourceCount + ' / 工具 ' + toolCount + '）');
console.log('免费：' + free + '（' + stats.freeRatio + '%） | 付费：' + paid);
console.log('截图：' + imageCount + '/' + total + '（' + stats.imageCoverage + '%）');
console.log('分类：' + Object.keys(byCategory).map(id => id + ':' + byCategory[id].total).join('  '));
console.log('来源：' + Object.keys(bySource).map(k => k + ':' + bySource[k]).join('  '));
if (!errors.length) {
  const shardKB = shards.map(([file]) => file + ' ' + (fs.statSync(path.join(DATA_DIR, file)).size / 1024).toFixed(1) + ' KB').join('、');
  const jsonKB = (fs.statSync(outJson).size / 1024).toFixed(1);
  console.log('输出：分片 ' + shardKB);
  console.log('      assets.json（' + jsonKB + ' KB）、index.html（' + pageStatus + '）');
} else {
  console.log('输出：因校验失败，未写入 data/*.js 分片 / assets.json');
}
console.log(line);

if (warnings.length) {
  console.log('警告 ' + warnings.length + ' 条：');
  warnings.slice(0, 40).forEach(w => console.log('  ⚠ ' + w));
  if (warnings.length > 40) console.log('  … 其余 ' + (warnings.length - 40) + ' 条省略');
}

if (errors.length) {
  console.log('错误 ' + errors.length + ' 条：');
  errors.slice(0, 80).forEach(e => console.log('  ✗ ' + e));
  if (errors.length > 80) console.log('  … 其余 ' + (errors.length - 80) + ' 条省略');
  process.exit(1);
}

console.log('校验通过。');

#!/usr/bin/env node
'use strict';

/**
 * 资源链接复核 · 可重跑脚本
 *
 * 用法（最短）：
 *   node scripts/recheck.js                复核 B 站线索 + 自动跑 node scripts/build.js
 *   node scripts/recheck.js --scope=all    同时检查主目录 obtain/source 链接
 *   node scripts/recheck.js --no-build     只复核、不构建
 *   node scripts/recheck.js --dry-run      只输出报告，不改 data/bilibili.json
 *
 * 规则：
 *   - 只访问公开页面，限速 1 秒/次，不登录、不绕过风控。
 *   - 先应用 data/recheck-evidence.json（人工公开页面核对结论），再用实时 HTTP 状态补充。
 *   - 403/429/503 视为「被风控」，保持原状态，只记录渠道与时间。
 *   - 第三方网盘/聚合转载站不自动改判（清单里标记未核实）。
 *   - 404/410 或页面明确 404 → removed（已下架）；有 Buy now/Add to cart 且无 Free → paid（已收费）。
 *   - 结果写入 data/recheck-report.json，并在末尾串跑 node scripts/build.js。
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const BILI_FILE = path.join(DATA_DIR, 'bilibili.json');
const EVIDENCE_FILE = path.join(DATA_DIR, 'recheck-evidence.json');
const REPORT_FILE = path.join(DATA_DIR, 'recheck-report.json');
const TODAY = new Date().toISOString().slice(0, 10);

const argv = process.argv.slice(2);
const has = f => argv.indexOf(f) > -1;
const opt = (name, def) => {
  const hit = argv.find(a => a.startsWith('--' + name + '='));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

const scope = opt('scope', 'all');             // bili | main | all
const delay = Math.max(0, Number(opt('delay', '1000')) || 0);
const limit = Number(opt('limit', '0')) || 0;
const dryRun = has('--dry-run');
const noBuild = has('--no-build');
const evidencePath = opt('evidence', EVIDENCE_FILE);

const STATUS_RANK = { verified: 6, paid: 5, removed: 4, unverifiable: 3, dead: 2, pending: 1 };
const SKIP_HOSTS = [
  'pan.baidu.com', 'ue.uulumi.com', 'cgalpha.com', 'cgtall.com', 'asset001.com',
  '3dcghub.com', 'gfxhive.net', 'digitalgeekland.com', 'renderhub.com',
  'turbosquid.com', 'cgtrader.com', 'b23.tv', 'youtube.com', 'youtu.be'
];
const BLOCKED_CODES = new Set([403, 429, 503]);

function isURL(s) {
  if (typeof s !== 'string' || !s) return false;
  try {
    const u = new URL(s);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

function normUrl(s) {
  if (!s) return null;
  try {
    const u = new URL(s);
    return (u.origin + u.pathname).toLowerCase().replace(/\/+$/, '');
  } catch (e) { return null; }
}

function hostOf(s) {
  try { return new URL(s).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; }
}

function skipHost(s) {
  const h = hostOf(s);
  return SKIP_HOSTS.some(x => h === x || h.endsWith('.' + x));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function request(url, redirects) {
  return new Promise(resolve => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6'
      }
    }, res => {
      const status = res.statusCode || 0;
      const location = res.headers.location;
      if (status >= 300 && status < 400 && location && redirects > 0) {
        res.resume();
        resolve(request(new URL(location, url).href, redirects - 1));
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => {
        if (body.length < 200000) body += chunk;
      });
      res.on('end', () => resolve({ status, finalUrl: url, body }));
      res.on('error', () => resolve({ status, finalUrl: url, body }));
    });
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ status: 0, finalUrl: url, body: '', error: 'timeout' });
    });
    req.on('error', e => resolve({ status: 0, finalUrl: url, body: '', error: e.code || e.message }));
    req.end();
  });
}

function classify(host, status, body) {
  if (status === 404 || status === 410) return { verdict: 'removed', reason: 'HTTP ' + status };
  if (BLOCKED_CODES.has(status)) return { verdict: null, reason: 'HTTP ' + status + '（风控，未绕过）' };
  if (!status) return { verdict: null, reason: '网络错误/超时' };
  if (body && /Sorry, we couldn['’]t find that page|Page not found|页面不存在|404 Not Found/i.test(body)) {
    return { verdict: 'removed', reason: '页面内提示 404' };
  }
  if (status !== 200) return { verdict: null, reason: 'HTTP ' + status };
  const buy = /Buy now|Add to cart|Add to basket|立即购买|加入购物车/i.test(body || '');
  const free = /\bFree\b|免费/i.test(body || '');
  if (host === 'fab.com' && free && !buy) return { verdict: 'free', reason: '页面标注 Free' };
  if (buy && !free) return { verdict: 'paid', reason: '页面出现购买入口且无 Free' };
  return { verdict: null, reason: '页面可打开，价格/许可需人工确认' };
}

function loadJSON(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; }
}

/* ---------- 应用证据缓存 ---------- */
const evidence = loadJSON(evidencePath, { entries: [] });
const evByName = new Map();
(evidence.entries || []).forEach(e => {
  if (e && e.name) evByName.set(e.name.trim(), e);
  if (e && e.officialUrl) evByName.set('url:' + normUrl(e.officialUrl), e);
});

const report = {
  generatedAt: TODAY,
  scope,
  evidenceFile: path.relative(ROOT, evidencePath).split(path.sep).join('/'),
  checked: 0,
  skipped: 0,
  appliedEvidence: 0,
  changes: { newlyFree: [], turnedPaid: [], removed: [], dead: [], unverifiable: [] },
  unable: [],
  errors: []
};

const bili = loadJSON(BILI_FILE, null);
if (!bili || !Array.isArray(bili.videos)) {
  console.error('data/bilibili.json 无法读取');
  process.exit(1);
}

let dirty = false;

function applyEvidence(m) {
  const e = evByName.get(m.name && m.name.trim()) || evByName.get('url:' + normUrl(m.officialUrl));
  if (!e) return false;
  const oldStatus = m.status;
  const oldFree = m.free;
  if (isURL(e.officialUrl)) m.officialUrl = e.officialUrl;
  m.free = e.verdict === 'free' ? true : e.verdict === 'pending' ? m.free : false;
  m.status = e.verdict === 'free' ? 'verified' : e.verdict;
  m.recheck = {
    at: e.checkedAt || TODAY,
    verdict: e.verdict,
    method: e.method || '公开页面人工核对（证据缓存）',
    evidenceUrl: e.evidenceUrl || e.officialUrl || null,
    priceNote: e.priceNote || null,
    channels: e.channels || null,
    note: e.note
  };
  report.appliedEvidence++;
  dirty = true;
  if (oldStatus !== m.status || oldFree !== m.free) {
    recordChange(m, oldStatus, oldFree, '证据缓存');
  }
  return true;
}

function recordChange(m, oldStatus, oldFree, how) {
  const rec = {
    name: m.name, from: oldStatus, to: m.status, freeFrom: oldFree, freeTo: m.free,
    officialUrl: m.officialUrl || null, how: how
  };
  if (m.status === 'verified' && oldStatus !== 'verified') report.changes.newlyFree.push(rec);
  else if (m.status === 'paid') report.changes.turnedPaid.push(rec);
  else if (m.status === 'removed') report.changes.removed.push(rec);
  else if (m.status === 'unverifiable') report.changes.unverifiable.push(rec);
  else if (m.status === 'dead') report.changes.dead.push(rec);
}

/* ---------- 收集待查链接 ---------- */
const targets = [];
const biliTargets = [];
if (scope === 'bili' || scope === 'all') {
  bili.videos.forEach(v => {
    (v.mentions || []).forEach(m => {
      if (applyEvidence(m)) return;
      const url = m.officialUrl || (m.thirdParty ? null : m.rawUrl);
      if (!url) {
        report.skipped++;
        report.unable.push({ name: m.name, reason: '没有可核对的官方链接（仅网盘/未获取）' });
        return;
      }
      if (!isURL(url)) { report.errors.push({ name: m.name, reason: '链接格式不合法：' + url }); return; }
      if (skipHost(url)) {
        report.skipped++;
        report.unable.push({ name: m.name, reason: '第三方网盘/转载站，未自动判定：' + hostOf(url) });
        return;
      }
      biliTargets.push({ url, mention: m, video: v.bvid });
    });
  });
}

const mainTargets = [];
if (scope === 'main' || scope === 'all') {
  const resources = loadJSON(path.join(DATA_DIR, 'resources.json'), []);
  const tools = loadJSON(path.join(DATA_DIR, 'tools.json'), []);
  resources.concat(tools).forEach(item => {
    [item.obtain, item.source].forEach(url => {
      if (!isURL(url) || skipHost(url)) return;
      mainTargets.push({ url, item: item.id });
    });
  });
}

/* ---------- 逐个复核 ---------- */
async function run() {
  const urls = new Map();
  biliTargets.forEach(t => {
    const k = normUrl(t.url);
    if (!urls.has(k)) urls.set(k, []);
    urls.get(k).push(t);
  });

  let idx = 0;
  for (const [key, group] of urls) {
    if (limit && idx >= limit) break;
    idx++;
    const url = group[0].url;
    const res = await request(url, 5);
    report.checked++;
    const host = hostOf(res.finalUrl || url);
    const c = classify(host, res.status, res.body);

    if (!c.verdict) {
      report.unable.push({ name: group.map(g => g.mention.name).join(' / '), url, reason: c.reason });
      group.forEach(g => {
        if (!g.mention.recheck) {
          g.mention.checkedAt = TODAY;
          dirty = true;
        }
      });
      if (delay) await sleep(delay);
      continue;
    }

    group.forEach(g => {
      const m = g.mention;
      const oldStatus = m.status;
      const oldFree = m.free;
      if (c.verdict === 'free') {
        if (m.status === 'verified') return;
        m.status = 'verified';
        m.free = true;
        if (!m.officialUrl) m.officialUrl = res.finalUrl || url;
      } else if (c.verdict === 'paid') {
        m.status = 'paid';
        m.free = false;
      } else if (c.verdict === 'removed') {
        m.status = 'removed';
        m.free = false;
      }
      m.checkedAt = TODAY;
      m.recheck = {
        at: TODAY,
        verdict: c.verdict === 'free' ? 'free' : c.verdict,
        method: '公开页面 HTTP 状态（未登录）',
        evidenceUrl: res.finalUrl || url,
        priceNote: null,
        note: c.reason
      };
      if (oldStatus !== m.status || oldFree !== m.free) {
        recordChange(m, oldStatus, oldFree, c.reason);
        dirty = true;
      }
    });
    if (delay) await sleep(delay);
  }

  for (const t of mainTargets) {
    if (limit && report.checked >= limit) break;
    const res = await request(t.url, 5);
    report.checked++;
    if (res.status === 404 || res.status === 410) {
      report.errors.push({ name: t.item, url: t.url, reason: 'HTTP ' + res.status + '（主目录链接失效，未自动改价格）' });
    } else if (BLOCKED_CODES.has(res.status)) {
      report.unable.push({ name: t.item, url: t.url, reason: 'HTTP ' + res.status + '（风控，未绕过）' });
    }
    if (delay) await sleep(delay);
  }

  if (!dryRun && dirty) {
    fs.writeFileSync(BILI_FILE, JSON.stringify(bili, null, 2) + '\n', 'utf8');
  }
  if (!dryRun) {
    fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');
  }

  const line = '----------------------------------------';
  console.log('\n资源复核 · recheck');
  console.log(line);
  console.log('范围：' + scope + ' | 请求 ' + report.checked + ' 个链接 | 证据命中 ' + report.appliedEvidence + ' 条 | 跳过 ' + report.skipped);
  console.log('变动：新增免费 ' + report.changes.newlyFree.length +
    ' / 转为收费 ' + report.changes.turnedPaid.length +
    ' / 下架 ' + report.changes.removed.length +
    ' / 失效 ' + report.changes.dead.length);
  console.log('未能判定 ' + report.unable.length + ' 条（403/风控/仅网盘/需人工）');
  console.log('报告：' + (dryRun ? '（dry-run 未写入）' : 'data/recheck-report.json'));
  console.log(line);

  if (!noBuild && !dryRun) {
    const r = spawnSync('node', [path.join(__dirname, 'build.js')], { cwd: ROOT, stdio: 'inherit' });
    process.exit(r.status || 0);
  }
}

run().catch(e => {
  console.error('复核失败：' + e.message);
  process.exit(1);
});

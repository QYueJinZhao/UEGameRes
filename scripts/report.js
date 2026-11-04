#!/usr/bin/env node
'use strict';

/**
 * 核查总结报告生成器
 * 用法：node scripts/report.js
 *
 * 数字口径：
 * - 总数、免费/付费、截图覆盖、分类分布、GitHub 活跃度、B 站状态直接读取 data/core.js 的 stats / counts
 *   （core.js 由 scripts/build.js 从 data/*.json 现算生成，避免报告与页面两套数字）。
 * - 价格区间、评分/评价数分布、免费替代、各类缺口等明细由本脚本从 data/*.json 现算。
 * - 生成前做一致性断言：明细重算的总数必须与 core.js 的 counts 完全一致，否则退出非零并提示先跑 build。
 *
 * 输出：docs/REPORT-<date>.md 与 docs/REPORT-<date>.html（HTML 自包含，无外链 CSS/JS/图片）。
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DOCS = path.join(ROOT, 'docs');

/* 先刷新 data/core.js 与分片，保证报告读到的 stats/counts 是当前 data/*.json 的结果 */
try {
  execFileSync(process.execPath, [path.join(__dirname, 'build.js')], { stdio: 'inherit' });
} catch (e) {
  console.error('数据构建失败，未生成报告。先修复 node scripts/build.js 报出的错误。');
  process.exit(1);
}

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadCore() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(DATA, 'core.js'), 'utf8'), sandbox, { timeout: 2000 });
  if (!sandbox.window.UEHUB_CORE) throw new Error('data/core.js 未导出 UEHUB_CORE');
  return sandbox.window.UEHUB_CORE;
}

function round1(n) { return Math.round(n * 10) / 10; }
function rating1(n) { return Number(n).toFixed(1); }
function money(n) { return '¥' + (Math.round(n * 100) / 100).toFixed(2).replace(/\.00$/, ''); }
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function mdCell(s) { return String(s == null ? '' : s).replace(/\|/g, '｜').replace(/\n/g, ' '); }
function kb(rel) {
  return (fs.statSync(path.join(ROOT, rel)).size / 1024).toFixed(1) + ' KB';
}

const core = loadCore();
const stats = core.stats;
const counts = core.counts;
const biliStats = core.biliStats;

const resources = readJSON(path.join(DATA, 'resources.json'));
const tools = readJSON(path.join(DATA, 'tools.json'));
const github = readJSON(path.join(DATA, 'github.json'));
const bili = readJSON(path.join(DATA, 'bilibili.json'));
const epic = readJSON(path.join(DATA, 'epic-samples.json'));
const sourceFile = readJSON(path.join(DATA, 'sources.json'));
const categories = readJSON(path.join(DATA, 'categories.json'));
const recheck = readJSON(path.join(DATA, 'recheck-report.json'));

const fetchedAt = core.meta.fetchedAt || core.version;
const errorList = [];
function check(cond, msg) { if (!cond) errorList.push(msg); }

/* ---------- 明细统计 ---------- */
const localItems = resources.concat(tools);
const paidItems = localItems.filter(x => x.priceType === 'paid');
const freeLocal = localItems.filter(x => x.priceType === 'free');
const ghItems = github.items || [];

const computedTotal = localItems.length + ghItems.length;
const computedFree = freeLocal.length + ghItems.length;
const computedPaid = paidItems.length;

check(computedTotal === stats.total, '总数不一致：明细 ' + computedTotal + ' / core ' + stats.total);
check(computedTotal === counts.resources.total + counts.tools.total, '总数与 counts 不一致：' + computedTotal + ' / ' + (counts.resources.total + counts.tools.total));
check(computedFree === stats.free, '免费数不一致：明细 ' + computedFree + ' / core ' + stats.free);
check(computedPaid === stats.paid, '付费数不一致：明细 ' + computedPaid + ' / core ' + stats.paid);
check(resources.length === counts.resources.total, '资源数不一致：' + resources.length + ' / ' + counts.resources.total);
check(tools.length + ghItems.length === counts.tools.total, '工具数不一致：' + (tools.length + ghItems.length) + ' / ' + counts.tools.total);
check(paidItems.length === counts.resources.paid + counts.tools.paid, '付费拆分不一致：' + paidItems.length + ' / ' + (counts.resources.paid + counts.tools.paid));

/* 截图：按本地文件实际存在重算 */
const allImageItems = resources.concat(tools, ghItems);
const missingImages = allImageItems.filter(x => !x.image || !fs.existsSync(path.join(ROOT, x.image)));
const imageCount = allImageItems.length - missingImages.length;
check(imageCount === stats.imageCount, '截图数不一致：明细 ' + imageCount + ' / core ' + stats.imageCount);

/* 价格与评分/评价数 */
const pricedItems = paidItems.filter(x => typeof x.price === 'number' && isFinite(x.price));
const priceNullItems = paidItems.filter(x => x.price == null);
const prices = pricedItems.map(x => x.price).sort((a, b) => a - b);
const priceMin = prices.length ? prices[0] : null;
const priceMax = prices.length ? prices[prices.length - 1] : null;
const priceMedian = prices.length ? (prices.length % 2 ? prices[(prices.length - 1) / 2] : (prices[prices.length / 2 - 1] + prices[prices.length / 2]) / 2) : null;

const priceBuckets = { '<100': 0, '100-299': 0, '300-599': 0, '>=600': 0 };
pricedItems.forEach(x => {
  const p = x.price;
  const k = p < 100 ? '<100' : p < 300 ? '100-299' : p < 600 ? '300-599' : '>=600';
  priceBuckets[k]++;
});

const ratingBuckets = { '5.0': 0, '4.5-4.9': 0, '4.0-4.4': 0, '<4.0': 0, 'null': 0 };
paidItems.forEach(x => {
  const r = x.rating;
  if (r == null) ratingBuckets.null++;
  else if (r === 5) ratingBuckets['5.0']++;
  else if (r >= 4.5) ratingBuckets['4.5-4.9']++;
  else if (r >= 4.0) ratingBuckets['4.0-4.4']++;
  else ratingBuckets['<4.0']++;
});

const reviewBuckets = { '>=50': 0, '10-49': 0, '<10': 0, 'null': 0 };
paidItems.forEach(x => {
  const n = x.reviews;
  if (n == null) reviewBuckets.null++;
  else if (n >= 50) reviewBuckets['>=50']++;
  else if (n >= 10) reviewBuckets['10-49']++;
  else reviewBuckets['<10']++;
});

const lowSample = paidItems.filter(x => x.reviews != null && x.reviews < 10).length;
const strongPaid = paidItems.filter(x => x.reviews != null && x.reviews >= 50 && x.rating != null && x.rating >= 4.5).length;
check(lowSample === stats.lowSamplePaid, '样本少条数不一致：明细 ' + lowSample + ' / core ' + stats.lowSamplePaid);

const paidLicenseMissing = paidItems.filter(x => String(x.license).includes('未获取')).length;
check(paidLicenseMissing === paidItems.length, '付费许可未获取条数不等于付费总数');

/* 本轮新增付费：取付费条目中最新的 verified 日期，不用手写条数 */
const latestPaidDate = paidItems.map(x => x.verified).sort().slice(-1)[0];
const newPaidItems = paidItems.filter(x => x.verified === latestPaidDate);
const newPricedItems = newPaidItems.filter(x => typeof x.price === 'number' && isFinite(x.price));
const newPrices = newPricedItems.map(x => x.price).sort((a, b) => a - b);
const newPriceMin = newPrices.length ? newPrices[0] : null;
const newPriceMax = newPrices.length ? newPrices[newPrices.length - 1] : null;
const newRatings = newPaidItems.filter(x => x.rating != null).map(x => x.rating);
const newRatingMin = newRatings.length ? Math.min.apply(null, newRatings) : null;
const newRatingMax = newRatings.length ? Math.max.apply(null, newRatings) : null;
const newReviews50 = newPaidItems.filter(x => x.reviews != null && x.reviews >= 50).length;
const newLowSample = newPaidItems.filter(x => x.reviews != null && x.reviews < 10).length;
const newLicenseMissing = newPaidItems.filter(x => String(x.license).includes('未获取')).length;
const newPriceNull = newPaidItems.filter(x => x.price == null).length;

const altRe = /免费替代[:：]\s*([a-z0-9-]{4,})/;
const altItems = paidItems.filter(x => altRe.test(x.notes));
const altIds = [];
altItems.forEach(x => {
  const m = x.notes.match(altRe);
  if (m && altIds.indexOf(m[1]) === -1) altIds.push(m[1]);
});
const altResolved = altIds.filter(id => localItems.some(x => x.id === id));
check(altIds.length === altResolved.length, '免费替代指向了不存在的条目：' + altIds.filter(id => altResolved.indexOf(id) === -1).join(', '));

const priceForm = x => {
  const m = String(x.notes).match(/价格未获取[：:]([^；。]+)/);
  return m ? m[1].trim() : '备注含「未获取」，页面未给出 CNY';
};

/* 许可 / 引擎 / 版本缺口 */
const licenseMissingItems = localItems.filter(x => String(x.license).includes('未获取'));
const licenseMissingFree = licenseMissingItems.length - paidLicenseMissing;
const engineMissingItems = localItems.filter(x => String(x.engine).includes('未获取'));
const engineMissingPaid = paidItems.filter(x => String(x.engine).includes('未获取')).length;
const verifiedDated = allImageItems.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x.verified || ''))).length;

/* GitHub 明细 */
const gh = counts.github;
const releaseMissing = ghItems.filter(x => x.lastRelease === '未获取').length;
const releaseNone = ghItems.filter(x => x.lastRelease === '无 release').length;
const releaseDated = ghItems.length - releaseMissing - releaseNone;
const ueMissing = ghItems.filter(x => x.ueVersion === '未获取').length;
const ueV4 = ghItems.filter(x => x.ueVersion === '4.x').length;
const ueV5 = ghItems.filter(x => x.ueVersion === '5.x').length;
const ghNoLicense = ghItems.filter(x => String(x.license).includes('未声明')).length;
const ghGpl = ghItems.filter(x => /GPL/i.test(String(x.license))).length;
const ghGroups = Object.keys(gh.byGroup || {}).map(k => k + ' ' + gh.byGroup[k]);

/* B 站明细 */
const biliVideos = bili.videos.length;
const biliMentions = bili.videos.reduce((n, v) => n + (v.mentions || []).length, 0);
const rawStatus = { verified: 0, paid: 0, removed: 0, dead: 0, pending: 0, unverifiable: 0 };
bili.videos.forEach(v => (v.mentions || []).forEach(m => { if (rawStatus[m.status] != null) rawStatus[m.status]++; }));
const subtitleVideos = bili.videos.filter(v => Array.isArray(v.subtitles) && v.subtitles.length > 0).length;
const subtitleMissing = bili.videos.filter(v => String(v.subtitleStatus).includes('未获取')).length;
const descOk = bili.videos.filter(v => !String(v.descStatus || '').includes('未获取')).length;
const commentsTotal = bili.videos.reduce((n, v) => n + (v.comments || []).length, 0);
const thirdParty = bili.videos.reduce((n, v) => n + (v.mentions || []).filter(m => m.thirdParty).length, 0);
const biliStatusSum = counts.bili.verified + counts.bili.pending + counts.bili.paid + counts.bili.removed + counts.bili.unverifiable + counts.bili.dead;

check(biliVideos === counts.bili.videos, 'B 站视频数不一致');
check(biliMentions === counts.bili.mentions, 'B 站线索数不一致：' + biliMentions + ' / ' + counts.bili.mentions);
check(biliStatusSum === counts.bili.resources, 'B 站状态合计与去重资源数不一致：' + biliStatusSum + ' / ' + counts.bili.resources);
check(subtitleVideos === biliStats.withSubtitles, 'B 站有字幕视频数不一致');
check(subtitleMissing === biliVideos, 'B 站字幕未获取视频数不等于视频总数');

/* Epic 明细 */
const epicItems = epic.items || [];
const epicTypes = {};
epicItems.forEach(x => {
  const t = (x.extra && x.extra.type) || '未标注';
  epicTypes[t] = (epicTypes[t] || 0) + 1;
});
const epicLicense = { ueOnly: 0, docs: 0 };
epicItems.forEach(x => {
  const lic = String(x.license);
  if (lic.includes('官方文档')) epicLicense.docs++;
  else if (lic.includes('UE-Only')) epicLicense.ueOnly++;
});
const epicRatingMissing = epicItems.filter(x => x.rating == null).length;
const epicSizeMissing = epicItems.filter(x => String(x.size).includes('未获取')).length;
const epicTagged = resources.filter(x => (x.tags || []).includes('Epic官方')).length;
const epicSourceCount = stats.bySource['epic-samples'] || 0;

/* Fab 风控 */
const recheck403 = recheck.unable.filter(x => String(x.reason).includes('403')).length;

/* 来源表 */
const sourceTotal = sourceFile.sources.length;
const SOURCE_ACCESS = {
  fab: '频道/分类页与卖家页公开访问；详情页常 403/Cloudflare，价格用频道页或搜索快照',
  'epic-samples': 'Fab 商品接口 + Epic 官方文档页；价格与评分为主',
  quixel: 'Fab 卖家页与商品页；部分页面 403，以示例工程为主',
  polyhaven: '公开页面；CC0 直接下载',
  ambientcg: '公开页面；CC0 直接下载',
  kenney: '公开页面；ZIP 直下',
  opengameart: '公开页面；逐条许可',
  sketchfab: '公开页面；仅 downloadable + CC0',
  quaternius: '官网公开页面；CC0',
  github: '未认证 search API；不逐仓库打详情',
  bilibili: 'view/reply/player 公开接口；字幕需登录，未获取'
};
const sourceRows = sourceFile.sources.map(s => {
  let n;
  if (s.id === 'bilibili') n = biliVideos + ' 视频 / ' + biliMentions + ' 线索';
  else if (s.id === 'github') n = String(stats.bySource[s.id] || 0) + '（GitHub 视图 ' + ghItems.length + '）';
  else n = String(stats.bySource[s.id] || 0);
  return [s.name, n, s.license, SOURCE_ACCESS[s.id] || '公开页面'];
});

/* ---------- 报告内容（同一份 blocks 同时渲染 Markdown 与 HTML） ---------- */
const paidRatio = stats.total ? round1(stats.paid / stats.total * 100) : 0;
const blocks = [];

function h2(text, id) { blocks.push({ type: 'h2', text, id }); }
function h3(text) { blocks.push({ type: 'h3', text }); }
function p(text) { blocks.push({ type: 'p', text }); }
function ul(items) { blocks.push({ type: 'ul', items }); }
function table(headers, rows) { blocks.push({ type: 'table', headers, rows }); }
function callout(text) { blocks.push({ type: 'callout', text }); }
function code(lines) { blocks.push({ type: 'code', lines }); }

/* 1 结论 */
h2('1. 一页结论', 'sec1');
p('本次核查登记来源 ' + sourceTotal + ' 个（含 B 站信息源），主目录 ' + stats.total + ' 条条目：资源 ' + counts.resources.total + ' 条，工具/插件 ' + counts.tools.total + ' 条。免费 ' + stats.free + ' 条（' + stats.freeRatio + '%），付费 ' + stats.paid + ' 条（' + paidRatio + '%）。截图 ' + stats.imageCount + '/' + stats.total + '（' + stats.imageCoverage + '%），缺 ' + missingImages.length + ' 条。');
p('B 站信息源：' + biliVideos + ' 个视频、' + biliMentions + ' 条线索，去重后 ' + counts.bili.resources + ' 个资源。结论分布：已核实 ' + counts.bili.verified + '、已收费 ' + counts.bili.paid + '、已下架 ' + counts.bili.removed + '、待核实 ' + counts.bili.pending + '、无法确认 ' + counts.bili.unverifiable + '、失效 ' + counts.bili.dead + '。');
p('能不能直接用：免费部分能用，但不能默认商用——资源与本地工具 ' + localItems.length + ' 条中有 ' + licenseMissingItems.length + ' 条许可标「未获取」，GitHub 另有 ' + ghNoLicense + ' 条未声明许可。付费部分不能盲买——' + pricedItems.length + ' 条有 CNY 价格（' + money(priceMin) + '–' + money(priceMax) + '，中位 ' + money(priceMedian) + '），' + priceNullItems.length + ' 条价格未获取，' + paidLicenseMissing + ' 条许可未获取，' + lowSample + ' 条评价数 <10。');
p('建议路径：先用 ' + stats.free + ' 条免费资源和 ' + altItems.length + ' 组免费替代跑通流程；付费只考虑评价数 ≥50 且评分 ≥4.5 的 ' + strongPaid + ' 条中的具体需求项，并在结算页确认许可与最终价格。');
callout('结论：目录可用，但「可用」只等于入口与基础信息可用；商用许可、最终价格和插件版本兼容性仍需逐条确认。');

/* 2 范围与方法 */
h2('2. 核查范围与方法', 'sec2');
p('登记来源 ' + sourceTotal + ' 个（含 B 站信息源）；B 站只作信息源，不作为下载源。来源计数按条目 source 域名归并，GitHub 129 条包含 GitHub 视图 84 条与主目录中已有的 GitHub 条目。');
table(['来源', '条目数', '许可口径', '获取方式'], sourceRows);
p('采集限额与手段：GitHub 未认证 search API，' + github.meta.queries.length + ' 次查询、每次 per_page=100；重点仓库补详情 ' + github.meta.enrich.apiCalls + ' 次调用（剩余额度 ' + github.meta.enrich.remaining + '），.uplugin 走 raw 再 ' + github.meta.enrich.treeApiCalls + ' 次（剩余 ' + github.meta.enrich.remainingAfterTree + '）。B 站公开接口按约 1.2 秒/次限速；复核脚本按 1 秒/次限速。');
p('公开接口：GitHub search/repo/releases、B 站 view/reply/player、Epic 商品接口。页面快照：Fab 频道/分类页与卖家页、搜索引擎快照、Epic 官方文档页。拿不到：B 站字幕（需登录）、部分 Fab 详情页（403/Cloudflare）、部分价格/许可/体积字段。');
p('Fab 风控在复核报告中留下 ' + recheck403 + ' 条 403 记录；这些记录只说明「没拿到」，不覆盖已有结论，也没有绕过风控。');

/* 3 结果 */
h2('3. 结果分口径呈现', 'sec3');

h3('3.1 资源');
p('资源 ' + counts.resources.total + ' 条：免费 ' + counts.resources.free + '、付费 ' + counts.resources.paid + '。按用途分布如下。');
table(['用途', '总数', '免费', '付费'], categories.resource.map(c => {
  const n = counts.resources.byCategory[c.id] || { total: 0, free: 0, paid: 0 };
  return [c.name, n.total, n.free, n.paid];
}).concat([['合计', counts.resources.total, counts.resources.free, counts.resources.paid]]));

h3('3.2 工具与插件');
p('工具/插件 ' + counts.tools.total + ' 条：免费 ' + counts.tools.free + '、付费 ' + counts.tools.paid + '。其中本地工具条目 ' + tools.length + ' 条，GitHub 合并 ' + ghItems.length + ' 条；下面的分类分布包含 GitHub 条目。');
table(['用途', '总数', '免费', '付费'], categories.tool.map(c => {
  const n = counts.tools.byCategory[c.id] || { total: 0, free: 0, paid: 0 };
  return [c.name, n.total, n.free, n.paid];
}).concat([['合计', counts.tools.total, counts.tools.free, counts.tools.paid]]));

h3('3.2.1 GitHub 活跃度');
p('GitHub ' + gh.total + ' 条：推荐池 ' + gh.recommended + ' 条。活跃度分档如下。');
table(['档位', '条数', '处理'], [
  ['活跃（近 6 个月有提交）', gh.active, '正常推荐'],
  ['一般（6–12 个月）', gh.normal, '正常推荐'],
  ['停滞（超 12 个月）', gh.stale, '按人气二次判定'],
  ['归档', gh.archived, '默认不展示'],
  ['合计', gh.total, '—']
]);
p('停滞 ' + gh.stale + ' 条中，久未更新但高人气 ' + gh.stalePopular + ' 条保留推荐，并标注最后提交、UE 版本与可能需手动改编译；久未更新且人气低 ' + gh.lowPopular + ' 条默认不展示。归档 ' + gh.archived + ' 条默认不展示，仅在仍有代码价值时保留。');
p('分组：' + ghGroups.join('、') + '。');
p('版本信息：release 可追溯 ' + releaseDated + ' 条、明确无 release ' + releaseNone + ' 条、未获取 ' + releaseMissing + ' 条；UE 版本 5.x ' + ueV5 + ' 条、4.x ' + ueV4 + ' 条、未获取 ' + ueMissing + ' 条。');

h3('3.3 付费项');
p('付费 ' + stats.paid + ' 条（资源 ' + counts.resources.paid + ' + 工具 ' + counts.tools.paid + '）。');
table(['指标', '结果'], [
  ['有 CNY 价格', pricedItems.length + ' 条'],
  ['价格区间', money(priceMin) + '–' + money(priceMax)],
  ['中位价', money(priceMedian)],
  ['价格 <¥100', priceBuckets['<100'] + ' 条'],
  ['价格 ¥100–299', priceBuckets['100-299'] + ' 条'],
  ['价格 ¥300–599', priceBuckets['300-599'] + ' 条'],
  ['价格 ≥¥600', priceBuckets['>=600'] + ' 条'],
  ['评分 5.0', ratingBuckets['5.0'] + ' 条'],
  ['评分 4.5–4.9', ratingBuckets['4.5-4.9'] + ' 条'],
  ['评分 4.0–4.4', ratingBuckets['4.0-4.4'] + ' 条'],
  ['评分 <4.0', ratingBuckets['<4.0'] + ' 条'],
  ['评价数 ≥50', reviewBuckets['>=50'] + ' 条'],
  ['评价数 10–49', reviewBuckets['10-49'] + ' 条'],
  ['评价数 <10', reviewBuckets['<10'] + ' 条'],
  ['标「样本少」', lowSample + ' 条'],
  ['有免费替代', altItems.length + ' 条'],
  ['价格未获取', priceNullItems.length + ' 条'],
  ['许可未获取', paidLicenseMissing + ' 条']
]);
p('本轮新增付费（verified ' + latestPaidDate + '）' + newPaidItems.length + ' 条：' + newPricedItems.length + ' 条有 CNY 价格（' + money(newPriceMin) + '–' + money(newPriceMax) + '），' + newPriceNull + ' 条价格未获取，' + newLicenseMissing + ' 条许可未获取（Fab 商品页许可条款显示「-」）；评分 ' + rating1(newRatingMin) + '–' + rating1(newRatingMax) + '，评价数 ≥50 的 ' + newReviews50 + '/' + newPaidItems.length + '，' + newLowSample + ' 条 <10 标「样本少」。这是 ' + paidItems.length + ' 条付费总盘中的新增批次，不是全部。');
p('价格未获取的 ' + priceNullItems.length + ' 条：' + priceNullItems.map(x => x.name + '（' + priceForm(x) + '）').join('；') + '。');
p('有免费替代的 ' + altItems.length + ' 条，备注均指向目录内条目：' + altIds.join('、') + '。');
p('评分与评价数全部来自页面当时显示；评价数 <10 的 ' + lowSample + ' 条已在页面标「样本少」，不要把高分当作口碑。');

h3('3.4 B 站信息源');
table(['指标', '结果'], [
  ['视频', biliVideos + ' 个'],
  ['线索（原始提及）', biliMentions + ' 条'],
  ['去重资源', counts.bili.resources + ' 个'],
  ['已核实', counts.bili.verified + ' 个'],
  ['待核实', counts.bili.pending + ' 个'],
  ['已收费', counts.bili.paid + ' 个'],
  ['已下架', counts.bili.removed + ' 个'],
  ['无法确认', counts.bili.unverifiable + ' 个'],
  ['失效', counts.bili.dead + ' 个'],
  ['有字幕视频', subtitleVideos + ' 个'],
  ['字幕文本', biliStats.subtitleTextCount + ' 条'],
  ['简介覆盖率', descOk + '/' + biliVideos + '（' + biliStats.descCoverage + '%）'],
  ['热门评论', commentsTotal + ' 条（' + biliStats.withComments + ' 个视频有评论）'],
  ['线索来源', '简介 ' + biliStats.byOrigin['简介'] + ' / 评论 ' + biliStats.byOrigin['评论'] + ' / 字幕 ' + biliStats.byOrigin['字幕']],
  ['第三方网盘链接', thirdParty + ' 条']
]);
p('原始提及状态：已核实 ' + rawStatus.verified + '、已收费 ' + rawStatus.paid + '、已下架 ' + rawStatus.removed + '、无法确认 ' + rawStatus.unverifiable + '；按官方链接优先、否则按名称去重后，变为 ' + counts.bili.verified + '/' + counts.bili.paid + '/' + counts.bili.removed + '/' + counts.bili.unverifiable + '。');
p('字幕：' + biliVideos + ' 个视频的 subtitleStatus 全部是「未获取（需登录 Cookie）」；本轮没有拿到任何字幕文本，不能把字幕当作线索来源。');
p(counts.bili.unverifiable + ' 条无法确认已按最后一轮作者名/数量特征反查结案，备注含 channels 与 checkedAt，不再重复追踪。');

h3('3.5 Epic 官方免费示例');
table(['指标', '结果'], [
  ['本轮净新增', epicItems.length + ' 条'],
  ['完整示例工程', (epicTypes['完整示例工程'] || 0) + ' 条'],
  ['场景资产包', (epicTypes['场景资产包'] || 0) + ' 条'],
  ['学习内容', (epicTypes['学习内容'] || 0) + ' 条'],
  ['模板', (epicTypes['模板'] || 0) + ' 条'],
  ['许可 UE-Only（商品页）', epicLicense.ueOnly + ' 条'],
  ['许可含官方文档页', epicLicense.docs + ' 条'],
  ['评分未获取', epicRatingMissing + ' 条'],
  ['体积未获取', epicSizeMissing + ' 条'],
  ['与旧条目去重跳过', (epic.meta.dedup.skippedExisting || []).length + ' 条'],
  ['资源目录中 epic-samples 来源', epicSourceCount + ' 条']
]);
p('资源目录中 epic-samples 来源的 ' + epicSourceCount + ' 条 = 本轮 epic-samples.json 净新增 ' + epicItems.length + ' 条 + 既有 Epic Games 示例 ' + (epicSourceCount - epicItems.length) + ' 条（City Sample、Lyra 等）。');
p('许可限制：' + epicItems.length + ' 条中 ' + epicLicense.ueOnly + ' 条为商品页 Epic Content License（UE-Only），' + epicLicense.docs + ' 条来自 Epic 官方文档页。共同限制：仅可在 Unreal Engine 项目内使用；不可单独再分发；不可用于非 UE 引擎。');

/* 4 判定标准 */
h2('4. 判定标准与可信度', 'sec4');
p('主目录 ' + stats.total + ' 条均带核对日期（verified 合法日期 ' + verifiedDated + ' 条）；下面这张状态表只针对 B 站去重资源，不要把主目录条目当成同一套状态。');
table(['状态', '判定条件', '本次条数'], [
  ['verified', '官方页面可打开，且当前免费可用；必须有 officialUrl', counts.bili.verified + ' 条'],
  ['paid', '有购买入口或明确标价，判定已收费', counts.bili.paid + ' 条'],
  ['removed', '稳定 404/410，或页面明确写找不到', counts.bili.removed + ' 条'],
  ['dead', '历史失效，保留留档', counts.bili.dead + ' 条'],
  ['pending', '有名称或链接，但尚未得出结论', counts.bili.pending + ' 条'],
  ['unverifiable', '公开渠道查尽仍无法确认；必须列 channels', counts.bili.unverifiable + ' 条']
]);
ul([
  '人气优先于活跃度：GitHub 推荐不只看最近提交；久未更新但高人气 ' + gh.stalePopular + ' 条保留推荐，久未更新且人气低 ' + gh.lowPopular + ' 条默认不展示。',
  '评价数 <10 标「样本少」：本次 ' + lowSample + ' 条付费项命中；高分可能来自极小样本，不当口碑。',
  '403 不覆盖已有结论：复核遇到 403/429/503 一律记「风控，未获取」，保持原状态；本次 ' + recheck403 + ' 条 403。',
  '只有 404/410 判下架：单次 404 必须换渠道复核；本次 removed ' + counts.bili.removed + ' 条、dead ' + counts.bili.dead + ' 条。',
  '去重状态优先级：verified > paid > removed > dead > pending；同一资源被多条视频提及时取最确定的结论。',
  '价格与许可：付费价格必须是页面实际 CNY；抓不到写 null 并在备注写「未获取」，不折算、不估算；本次 ' + priceNullItems.length + ' 条价格未获取。',
  '主目录：' + stats.total + ' 条都有核对日期；截图按本地文件实际存在计数，不按字段是否为空。'
]);

/* 5 缺口与风险 */
h2('5. 已知缺口与风险', 'sec5');
p('以下缺口保留原值，不用「暂无数据」美化。每条都给出影响和使用者动作。');
table(['缺口', '数量', '影响', '使用者该怎么做'], [
  ['价格未获取', priceNullItems.length + ' 条', '无法做预算与比价', '到商品页或结算页确认 CNY 最终价；不要把 USD/BRL 折算当中国区价格'],
  ['许可未获取（资源/本地工具）', licenseMissingItems.length + ' 条（付费 ' + paidLicenseMissing + ' + 免费 ' + licenseMissingFree + '）', '无法确认能否商用、能否用于商业游戏', '用前核对商品页 License terms 或仓库 LICENSE；拿不到就联系作者'],
  ['截图缺口', missingImages.length + ' 条', '卡片没有可用预览', '点官方页面看实际效果；不要用占位图代替'],
  ['GitHub release 未获取', releaseMissing + ' 条（另 ' + releaseNone + ' 条明确无 release）', '无法判断是否有可安装版本', '看仓库 Releases/Tags 与 README；只有源码时需自行编译'],
  ['GitHub UE 版本未获取', ueMissing + ' 条（已识别 5.x ' + ueV5 + ' / 4.x ' + ueV4 + '）', '无法判断与当前引擎是否兼容', '读 .uplugin 的 EngineVersion 或 README 明示版本；没有再实测'],
  ['资源/本地工具引擎字段未获取', engineMissingItems.length + ' 条（付费 ' + engineMissingPaid + ' + 免费 ' + (engineMissingItems.length - engineMissingPaid) + '）', '无法判断与当前 UE 版本兼容', '看商品页 Engines/版本说明；在目标版本实测后再批量使用'],
  ['Fab 风控', recheck403 + ' 条 403', '页面快照可能过期，价格/状态会漂移', '重跑 recheck；以人工打开的公开页面为准，不绕过风控'],
  ['B 站字幕', subtitleMissing + '/' + biliVideos + ' 个视频', '无法从字幕挖线索，字幕命中为 0', '需要登录态才能取字幕；当前只用简介与评论，不猜字幕内容'],
  ['第三方网盘', thirdParty + ' 条链接', '来源与安全性未核实', '不作为主力下载入口；优先找官方页或作者发布页'],
  ['Epic 体积未获取', epicSizeMissing + '/' + epicItems.length + ' 条', '无法预估磁盘与下载时间', '到商品页看 Download size；预留解压与 DerivedData 空间'],
  ['GitHub 许可风险', ghNoLicense + ' 条未声明 / ' + ghGpl + ' 条 GPL', '商用可能受限或传染', '未声明许可先联系作者；GPL/AGPL 在闭源商业项目里慎用']
]);

/* 6 复盘与后续 */
h2('6. 复盘与后续', 'sec6');
h3('6.1 本轮踩的坑（提炼）');
ul([
  'B 站搜索页是前端渲染，匿名抓不到；字幕接口匿名也不返回。规则：只用 view/reply/player 公开接口，字幕拿不到就写「未获取（需登录 Cookie）」，不猜、不做 ASR。',
  'Fab 直连常 403/Cloudflare，换 ?lang= 参数还会 404。规则：403/429/503 记「风控，未获取」，用公开页面/搜索快照取证，绝不代理绕过。',
  '404 不等于资源没了：曾因带 ?lang=en-US 的参数 404 误判，裸 URL 实际可打开。规则：只有稳定 404/410 或页面明确「找不到」才判 removed。',
  '同一资源被多条视频提及时状态会冲突。规则：按官方链接优先、否则名称去重；状态取 verified > paid > removed > dead > pending。',
  '缺图、状态与 free 不一致曾靠人工发现。规则：把口径写进 build.js 断言，状态、缺图、分片、路由、条目内联都自动校验。',
  '外链图有速率限制，OG 429、GitHub assets 302 都会让下载失败。规则：只收可下载的真实图片，失败进待补图，不生成占位图、不热链。',
  '数据构建与页面重建混在一起会让 index.html 无故变动。规则：新增数据只跑 build，改 src/ 才加 --page。',
  'GitHub 未认证 API 限额紧：core 60 次/小时、search 10 次/分钟。规则：靠 search 字段覆盖，重点仓库才补详情，限额将尽即停。',
  '插件不能只看最近提交：会误杀成熟但停更的插件。规则：活跃度定档 + 人气（stars ≥300 或分组前 20%）二次判定。'
]);
h3('6.2 已沉淀进脚本 / README 的规则');
ul([
  'scripts/build.js：字段/类型/ID/分类/链接/断图校验；付费价格缺失必须 notes 写明「未获取」；评价数 <10 警告；分片完整性、路由唯一、index.html 不内联条目；B 站状态与 free 一致性。',
  'scripts/recheck.js：只访问公开页面，1 秒/次；403/429/503 保持原状态；404/410 才改判；结论写 data/recheck-report.json，人工证据写 data/recheck-evidence.json。',
  'README.md：字段 schema、数据/页面隔离、视图模式、GitHub 采集与推荐双口径、Epic 示例许可限制、新增报告的生成命令。',
  'docs/RETRO.md：保留完整踩坑记录；本报告第 6.1 节只提炼可复用规则，不复制全文。'
]);
h3('6.3 下一轮优先级（按投入产出）');
table(['优先级', '做什么', '为什么先做'], [
  ['1', '补 ' + priceNullItems.length + ' 条价格与 ' + paidLicenseMissing + ' 条付费许可', '直接影响买不买、能不能商用；是付费目录的核心决策信息'],
  ['2', '补 GitHub release ' + releaseMissing + ' 条、UE 版本 ' + ueMissing + ' 条与 ' + ghNoLicense + ' 条未声明许可', '影响插件能不能装、能不能商用；比继续加条数更能提升可用性'],
  ['3', '处理 B 站 ' + counts.bili.unverifiable + ' 条无法确认线索；字幕需登录后再评估', '追溯成本高、收益有限；先把已有结论的证据补全'],
  ['4', '补 Epic 体积 ' + epicSizeMissing + ' 条与截图 ' + missingImages.length + ' 条', '只影响展示与磁盘预估，不改变资源本身可用性，放最后']
]);

/* 7 附录 */
h2('7. 附：文件清单与复现命令', 'sec7');
table(['文件', '内容', '规模'], [
  ['data/resources.json', counts.resources.total + ' 条资源', kb('data/resources.json')],
  ['data/tools.json', tools.length + ' 条本地工具', kb('data/tools.json')],
  ['data/github.json', ghItems.length + ' 条 GitHub 插件', kb('data/github.json')],
  ['data/epic-samples.json', epicItems.length + ' 条 Epic 示例', kb('data/epic-samples.json')],
  ['data/bilibili.json', biliVideos + ' 个视频 / ' + biliMentions + ' 条线索', kb('data/bilibili.json')],
  ['data/core.js', 'stats / counts / 分类（构建产物）', kb('data/core.js')],
  ['scripts/build.js', '校验 + 统计 + 分片 / 页面', kb('scripts/build.js')],
  ['scripts/recheck.js', '公开链接复核 + 变动报告', kb('scripts/recheck.js')],
  ['scripts/report.js', '生成本报告 + 一致性检查', kb('scripts/report.js')],
  ['docs/REPORT-' + fetchedAt + '.md', 'Markdown 主稿', '见生成输出'],
  ['docs/REPORT-' + fetchedAt + '.html', '自包含打印/分享版', '见生成输出']
]);
code([
  'node scripts/build.js      # 校验数据、重算统计，重建 data/*.js 分片与 assets.json',
  'node scripts/recheck.js    # 公开链接复核，写 data/recheck-report.json，并串跑 build',
  'node scripts/report.js     # 从 data/*.json 生成本报告，并做数字一致性检查'
]);
p('抓取截止：' + fetchedAt + '（Asia/Shanghai）。core.generatedAt 为 ' + core.generatedAt + '（构建机 UTC 日期）；页面文件未重建，只有数据与报告更新。');
p('一致性检查：报告总数 ' + stats.total + ' = counts 资源 ' + counts.resources.total + ' + 工具 ' + counts.tools.total + '；免费 ' + stats.free + '、付费 ' + stats.paid + '、截图 ' + stats.imageCount + ' 与 core.stats 一致。');

/* ---------- 渲染 Markdown ---------- */
function renderMd() {
  const out = [];
  out.push('# UE 资源与工具索引 · 核查总结报告');
  out.push('');
  out.push('> 报告日期：' + fetchedAt + ' ｜ 抓取截止：' + fetchedAt + '（Asia/Shanghai）');
  out.push('> 数据源：data/*.json ｜ 生成：node scripts/report.js（构建统计：node scripts/build.js）');
  out.push('');
  blocks.forEach(b => {
    if (b.type === 'h2') { out.push('', '## ' + b.text, ''); }
    else if (b.type === 'h3') { out.push('', '### ' + b.text, ''); }
    else if (b.type === 'p') { out.push(b.text, ''); }
    else if (b.type === 'callout') { out.push('> ' + b.text, ''); }
    else if (b.type === 'ul') { b.items.forEach(i => out.push('- ' + i)); out.push(''); }
    else if (b.type === 'table') {
      out.push('| ' + b.headers.map(mdCell).join(' | ') + ' |');
      out.push('| ' + b.headers.map(() => '---').join(' | ') + ' |');
      b.rows.forEach(r => out.push('| ' + r.map(mdCell).join(' | ') + ' |'));
      out.push('');
    } else if (b.type === 'code') {
      out.push('```bash', ...b.lines, '```', '');
    }
  });
  return out.join('\n');
}

/* ---------- 渲染自包含 HTML ---------- */
function renderHtml() {
  let inSection = false;
  const body = blocks.map((b, i) => {
    let prefix = '';
    if (b.type === 'h2') {
      prefix = (inSection ? '</div>\n' : '') + '<div class="section">';
      inSection = true;
      return prefix + '<h2 id="' + esc(b.id || ('sec' + i)) + '">' + esc(b.text) + '</h2>';
    }
    if (b.type === 'h3') return '<h3>' + esc(b.text) + '</h3>';
    if (b.type === 'p') return '<p>' + esc(b.text) + '</p>';
    if (b.type === 'callout') return '<div class="callout">' + esc(b.text) + '</div>';
    if (b.type === 'ul') return '<ul>' + b.items.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
    if (b.type === 'code') return '<pre class="cmd"><code>' + esc(b.lines.join('\n')) + '</code></pre>';
    if (b.type === 'table') {
      return '<div class="table-wrap"><table><thead><tr>' +
        b.headers.map(x => '<th>' + esc(x) + '</th>').join('') +
        '</tr></thead><tbody>' +
        b.rows.map(r => '<tr>' + r.map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') +
        '</tbody></table></div>';
    }
    return '';
  }).join('\n') + (inSection ? '\n</div>' : '');

  const statCards = [
    ['总条目', stats.total, '资源 ' + counts.resources.total + ' / 工具 ' + counts.tools.total],
    ['免费占比', stats.freeRatio + '%', stats.free + ' 免费 / ' + stats.paid + ' 付费'],
    ['截图覆盖', stats.imageCoverage + '%', stats.imageCount + ' / ' + stats.total],
    ['B 站已核实', counts.bili.verified, '无法确认 ' + counts.bili.unverifiable + ' / 已收费 ' + counts.bili.paid]
  ].map(([k, v, s]) => '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(k) + ' · ' + esc(s) + '</span></div>').join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>UE 资源与工具索引 · 核查总结报告（${esc(fetchedAt)}）</title>
<style>
:root {
  --bg: #f4f6f8;
  --surface: #ffffff;
  --surface-2: #eef1f5;
  --border: #dfe3e9;
  --text: #1b2129;
  --muted: #68707d;
  --accent: #1a66ff;
  --accent-ink: #0b3fb3;
  --green: #137a4b;
  --green-bg: #e7f6ee;
  --amber: #8a5a00;
  --amber-bg: #fff4dc;
  --red: #a4232b;
  --red-bg: #fdecec;
  --gray-bg: #eef0f3;
  --radius: 12px;
  --shadow: 0 1px 2px rgba(16, 24, 40, .06), 0 4px 14px rgba(16, 24, 40, .05);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif;
  background: var(--bg);
  color: var(--text);
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
}
.hero {
  background: radial-gradient(1200px 500px at 18% -10%, #26457c 0%, transparent 60%),
              linear-gradient(180deg, #0e1a30 0%, #14213d 100%);
  color: #e8eefc;
}
.hero-inner { max-width: 1120px; margin: 0 auto; padding: 36px 28px 30px; }
.kicker { font-size: 12px; letter-spacing: .12em; color: #a9b7d4; text-transform: uppercase; }
h1 { font-size: 30px; line-height: 1.2; margin: 8px 0 8px; letter-spacing: .3px; color: #fff; }
.sub { margin: 0; color: #a9b7d4; font-size: 13px; max-width: 760px; }
.pill { display: inline-block; border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.06); color: #c9d4e9; border-radius: 999px; padding: 4px 11px; font-size: 12px; margin-top: 14px; }
.stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 20px; }
.stat { background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.11); border-radius: 10px; padding: 10px 13px; }
.stat b { display: block; font-size: 21px; line-height: 1.25; color: #fff; font-variant-numeric: tabular-nums; }
.stat span { display: block; font-size: 11.5px; color: #a9b7d4; margin-top: 2px; }
.wrap { max-width: 1120px; margin: 0 auto; padding: 26px 28px 40px; }
.toc { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 18px; }
.toc a { font-size: 12.5px; color: var(--accent-ink); background: var(--surface); border: 1px solid var(--border); border-radius: 999px; padding: 5px 11px; text-decoration: none; }
.toc a:hover { border-color: var(--accent); }
.section { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 24px 28px; margin-bottom: 16px; box-shadow: var(--shadow); }
h2 { font-size: 20px; margin: 0 0 14px; padding-bottom: 10px; border-bottom: 1px solid var(--border); }
h3 { font-size: 15px; margin: 22px 0 8px; color: var(--accent-ink); }
p { margin: 10px 0; color: #303844; line-height: 1.75; }
ul { margin: 10px 0; padding-left: 22px; }
li { margin: 6px 0; line-height: 1.7; }
.callout { margin: 14px 0; padding: 11px 14px; background: var(--amber-bg); border-left: 3px solid #d99400; color: var(--amber); border-radius: 6px; font-size: 13.5px; }
.table-wrap { overflow-x: auto; margin: 12px 0; }
table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
th { text-align: left; background: var(--surface-2); color: #39424f; font-weight: 600; padding: 8px 10px; border-bottom: 1px solid var(--border); white-space: nowrap; }
td { padding: 8px 10px; border-bottom: 1px solid #edf0f3; vertical-align: top; }
tbody tr:last-child td { border-bottom: 0; }
td:first-child, th:first-child { white-space: nowrap; }
pre.cmd { background: #0e1a30; color: #e8eefc; padding: 14px 16px; border-radius: 8px; overflow-x: auto; font-size: 12.5px; line-height: 1.9; }
pre.cmd code { font-family: "Cascadia Code", Consolas, "SFMono-Regular", monospace; }
.footer { max-width: 1120px; margin: 0 auto; padding: 0 28px 30px; color: var(--muted); font-size: 12.5px; }
.footer strong { color: var(--text); }
@media (max-width: 760px) {
  .hero-inner, .wrap, .footer { padding-left: 16px; padding-right: 16px; }
  .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .section { padding: 18px 16px; }
  h1 { font-size: 24px; }
  td:first-child, th:first-child { white-space: normal; }
}
@media print {
  body { background: #fff; color: #111; }
  .hero { background: #fff !important; color: #111; border-bottom: 2px solid #111; }
  .hero-inner { padding: 18px 0; }
  h1, .kicker, .sub, .pill, .stat b { color: #111 !important; }
  .sub, .stat span, .pill { color: #444 !important; }
  .stats { grid-template-columns: repeat(4, 1fr); }
  .stat { border: 1px solid #bbb; background: #fff; }
  .toc { display: none; }
  .wrap { max-width: none; padding: 0; }
  .section { box-shadow: none; border: 0; border-top: 1px solid #999; border-radius: 0; padding: 14px 0; margin: 0; break-inside: avoid; }
  .table-wrap { overflow: visible; }
  table { font-size: 11px; }
  th, td { padding: 5px 6px; }
  pre.cmd { background: #fff; color: #111; border: 1px solid #999; }
  .callout { background: #fff; border-left: 3px solid #666; color: #222; }
  a { color: #111; text-decoration: none; }
}
</style>
</head>
<body>
<header class="hero">
  <div class="hero-inner">
    <div class="kicker">UE Assets &amp; Tools Index · Audit Report</div>
    <h1>UE 资源与工具索引 · 核查总结报告</h1>
    <p class="sub">核查范围、可信度口径、付费项与已知缺口。所有数字由 scripts/report.js 读取 data/*.json 现算生成，数据变了重跑即更新。</p>
    <div class="pill">报告日期 ${esc(fetchedAt)} · 抓取截止 ${esc(fetchedAt)}（Asia/Shanghai） · 自包含，可直接打印</div>
    <div class="stats">${statCards}</div>
  </div>
</header>
<main class="wrap">
  <nav class="toc">
    <a href="#sec1">1 一页结论</a>
    <a href="#sec2">2 范围与方法</a>
    <a href="#sec3">3 结果分口径</a>
    <a href="#sec4">4 判定标准</a>
    <a href="#sec5">5 缺口与风险</a>
    <a href="#sec6">6 复盘与后续</a>
    <a href="#sec7">7 文件与复现</a>
  </nav>
${body}
</main>
<footer class="footer">
  <p><strong>复现：</strong><code>node scripts/build.js</code> → <code>node scripts/recheck.js</code> → <code>node scripts/report.js</code>。本页不依赖外部 CSS/JS/图片，样式变量与索引站一致；打印时自动切为白底。</p>
</footer>
</body>
</html>
`;
}

/* ---------- 写文件 + 一致性检查 ---------- */
if (errorList.length) {
  console.error('数字一致性检查失败：');
  errorList.forEach(e => console.error('  - ' + e));
  console.error('请先运行 node scripts/build.js，再运行 node scripts/report.js。');
  process.exit(1);
}

if (!fs.existsSync(DOCS)) fs.mkdirSync(DOCS, { recursive: true });
const mdPath = path.join(DOCS, 'REPORT-' + fetchedAt + '.md');
const htmlPath = path.join(DOCS, 'REPORT-' + fetchedAt + '.html');
const md = renderMd();
const html = renderHtml();
fs.writeFileSync(mdPath, md, 'utf8');
fs.writeFileSync(htmlPath, html, 'utf8');

function statsOf(file) {
  const text = fs.readFileSync(file, 'utf8');
  const chars = text.replace(/\s/g, '').length;
  const lines = text.split(/\r?\n/).length;
  return { chars, lines, bytes: fs.statSync(file).size };
}

const mdInfo = statsOf(mdPath);
const htmlInfo = statsOf(htmlPath);

console.log('核查报告已生成：');
console.log('  ' + mdPath);
console.log('  ' + htmlPath);
console.log('数字一致性检查：通过（总数 ' + stats.total + ' / 免费 ' + stats.free + ' / 付费 ' + stats.paid + ' / 截图 ' + stats.imageCount + ' 与 data/core.js 的 counts 一致）');
console.log('规模：Markdown ' + mdInfo.lines + ' 行 / ' + mdInfo.chars + ' 字 / ' + (mdInfo.bytes / 1024).toFixed(1) + ' KB；HTML ' + htmlInfo.lines + ' 行 / ' + htmlInfo.chars + ' 字 / ' + (htmlInfo.bytes / 1024).toFixed(1) + ' KB');

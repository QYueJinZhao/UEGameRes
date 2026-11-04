# UE 资源与工具索引

面向 Unreal Engine 开发者的离线索引站：顶部搜索 + 分类导航 + 多维筛选 + 卡片网格。  
页面、样式、渲染脚本与条目数据完全隔离：**新增条目只改数据文件 + 补图，不改 index.html。**

## 现状统计（终态）

以下数字以 `data/core.js` 的 `counts/stats` 为准（2026-11-04）；数据变化后重跑 `node scripts/build.js` 与 `node scripts/report.js`。

| 指标 | 现值 |
|---|---|
| 主目录 | 349 = 资源 205 + 工具 144 |
| 免费 / 付费 | 299 / 50（免费占 85.7%） |
| 截图 | 348/349（99.7%），缺 1 条 GitHub 图 |
| 资源付费 | 40 条；env、material、prop、character、vfx、audio、ui、blueprint 各 5 条，other 0 |
| 工具付费 | 10 条；editor 2、blueprint-script 2、art-level 3、audio-tool 1、perf-debug 1、build 1；vcs、animation、ai、other-tool 0（有意的缺口，不硬凑） |
| 付费总盘 | 47 条有 CNY 价（¥33.18–¥1196.87），3 条价格未获取，50 条许可未获取，15 条评价 <10 |
| 本轮新增付费 | 13 条（verified 2026-11-04）：10 条有价（¥132.92–¥997.38），3 条价格未获取，13 条许可未获取；评分 4.7–5.0；评价数 ≥50 的 10/13；<10 的 1 条标「样本少」 |
| GitHub | 84 条：活跃 60 / 一般 10 / 停滞 12 / 归档 2；release 可追溯 8、明确无 release 4、未获取 72；UE 5.x 70 / 4.x 7 / 未获取 7 |
| B 站 | 34 视频 / 51 原始线索 / 48 去重资源；verified 18、paid 24、removed 1、unverifiable 5、pending 0、dead 0 |
| Epic 官方示例 | 34 条：完整工程 22 / 资产包 9 / 学习内容 2 / 模板 1 |

B 站 5 条 `unverifiable` 已按最后一轮作者名与数量特征反查结案，不再重复追踪；「风格化河边小屋」命中 House Along the River / StylArts，$49.99，已改判 `paid`。

## 命令与边界

| 命令 | 做什么 | 边界 |
|---|---|---|
| `node scripts/build.js` | 校验 `data/*.json`、重算 `stats/counts`、重建分片与 `assets.json` | 不重建 `index.html` |
| `node scripts/build.js --page` | 用 `src/` 模板、样式、渲染脚本重建 `index.html` | 只在改 `src/` 时用 |
| `node scripts/recheck.js` | 公开链接复核、写 `data/recheck-report.json`、串跑 build | 不登录、不绕风控；第三方网盘跳过且不自动改判 |
| `node scripts/report.js` | 内部串跑 build，生成 `docs/REPORT-<date>.md/html`，断言总数与 `core.js` counts 一致 | 不改页面 |

## 判定口径（终态）

- `verified`：官方页可打开且当前免费可用，必须 `free=true` 且有 `officialUrl`；`paid`：有购买入口或明确标价；`removed`：只有稳定 404/410 或页面明确「找不到」；`dead`：历史失效留档；`pending`：尚无结论；`unverifiable`：公开渠道穷尽仍无法确认，必须列 `channels`、`checkedAt`、`note`，已有 5 条结案。
- 403/429/503 记「风控，未获取」，不覆盖已有结论；不登录购买、不触发交易；第三方网盘跳过，不自动改判。
- 推荐双口径：人气优先于活跃度单指标；6 条「久未更新但高人气」保留推荐，6 条低人气存疑，2 条归档默认不展示。
- 评价数 <10 标「样本少」，不把高分当口碑；付费选品优先评价数 ≥50 且评分 ≥4.5。
- 价格、许可、评分、评价数、体积、release、UE 版本拿不到一律写「未获取」，不换算、不估算、不推断商用范围。
- 报告与文档的总数、免费/付费、截图数必须与 `data/core.js` 的 `counts/stats` 对齐；口径差异在正文显式标注，不误报为矛盾。

## 目录结构

```
index.html               # 入口，双击打开（由模板构建，勿手改）
assets.json              # 全量结构化导出（构建产物，可给外部工具用）
assets/img/<分类ID>/      # 本地截图，按条目 ID 命名
data/resources.json      # 资源条目（免费 + 付费，含 Epic 官方示例）
data/tools.json          # 工具 / 插件条目（Fab、GitHub 等来源）
data/github.json         # GitHub 插件采集结果（未认证 search API，含人气与活跃度）
data/categories.json     # 分类与子分类 schema
data/sources.json        # 站点 meta、来源说明、维护步骤
data/bilibili.json       # B 站信息源：视频、简介原文、评论、字幕与资源线索
data/bilibili-pending.json # 构建产物：待核实/已收费/已下架/失效清单（勿手改）
data/recheck-evidence.json # 人工公开页面核对结论缓存（recheck.js 优先读取）
data/recheck-report.json   # 复核产物：本次变动清单与未能判定原因（由 recheck.js 生成）
data/core.js             # 构建产物：分类、统计、counts（首屏必载）
data/resources.js        # 构建产物：资源分片
data/tools.js            # 构建产物：工具分片（含 GitHub 合并条目）
data/bilibili.js         # 构建产物：B 站视频与线索分片
data/pending.js          # 构建产物：待核实 / 失效清单分片
data/github.js           # 构建产物：GitHub 插件独立视图分片
src/index.template.html  # 页面模板（只有外壳与容器）
src/styles.css           # 样式
src/app.js               # 运行时渲染脚本（菜单、hash 路由、按需加载分片）
scripts/build.js         # 校验 + 统计 + 构建分片 / 页面
scripts/recheck.js       # 批量复核链接 + 输出变动清单 + 串跑 build.js
scripts/report.js        # 从 data/*.json 生成 docs/REPORT-<date>.md / .html，并做数字一致性检查
```

数据流：`data/*.json` → `scripts/build.js` 校验/重算 → `data/core.js + 各视图分片` → `index.html` 运行时按视图动态注入 `<script src>` 渲染。  
`file://` 下不能用 `fetch`，所以分片走 `<script src>`；同一分片只请求一次并缓存，分片内的 `version` 与 `core.js` 不一致时页面会提示重新构建。

## 导航与 hash 路由

菜单是「范围/口径」层，视图内筛选是「维度」层，二者都写进同一个 URL hash，可分享、可回退。

| 菜单层级 | 口径 | hash |
|---|---|---|
| 资源 | 免费 / 付费，再按用途分类（环境、材质贴图、道具模型、角色动画、VFX、音频、UI、示例模板、HDRI） | `#/resources/free`、`#/resources/free/<categoryId>`、`#/resources/paid`、`#/resources/paid/<categoryId>` |
| 工具插件 | 免费工具 / 付费工具，再按用途分组；GitHub 独立视图 | `#/tools/free`、`#/tools/free/<categoryId>`、`#/tools/paid`、`#/github`、`#/github/stale` |
| B 站信息源 | 已核实 / 待核实 / 已收费 / 已下架 / 查过但无法确认；视图内可切「按资源 / 按视频」 | `#/bilibili/verified`、`#/bilibili/pending`、`#/bilibili/paid`、`#/bilibili/removed`、`#/bilibili/unverifiable`，加 `?by=video` |
| 清单 | 待补图 / 待核实 / 失效（历史留档） | `#/lists/pending-images`、`#/lists/pending`、`#/lists/removed` |
| 单条深链 | 资源 / 工具 / GitHub / B 站线索、视频 | `#item-<id>`、`#video-<bvid>` |

视图内筛选参数：`q`（关键词）、`lic`（许可）、`eng`（引擎）、`rating`、`reviews`、`source`（来源站）、`sort`（排序）、`activity`（活跃度）、`minStars`、`rec`（仅推荐）、`group`（GitHub 分组）、`by`（B 站看法）。菜单项条数全部来自 `data/core.js` 的 `counts`，模板不写死数字。

切换菜单会保留各视图自己的筛选与滚动位置；同一视图只加载一次分片。窄屏下侧栏折叠为抽屉，按钮上显示当前口径。

视图模式：工具条左侧可切「缩略图 / 列表」，所有视图共用；列表模式写入 hash（`?view=list`），并持久化到 `localStorage`（键 `uehub-view`），默认缩略图。两种模式复用同一份筛选/排序结果，列表表头点击即改同一个 `sort` 状态；窄屏自动收起分类、来源等次要列。

## 新增一条资源（最短 4 步）

1. 在 `data/resources.json` 或 `data/tools.json` 的数组末尾加一条 JSON 对象（字段见下）。
2. 把截图存为 `assets/img/<分类ID>/<条目ID>.jpg`（也支持 PNG/WebP）。
3. 运行：

```bash
node scripts/build.js
```

4. 刷新 `index.html`。页面文件不需要改。

数据侧到此完成；如需刷新核查报告，再运行 `node scripts/report.js`（内部串跑 build，不改页面）。

只有修改 `src/` 下模板、样式或渲染脚本时，才需要重建页面：

```bash
node scripts/build.js --page
```

`scripts/build.js` 会检查：缺字段、类型错误、重复 ID、分类/子分类不匹配、空链接、断图、0 字节/伪造图片、免费条目缺图；随后重算统计并写出分片与 `assets.json`。此外还校验：分片完整性（每个视图依赖的分片存在且可解析）、hash 路由唯一、`index.html` 不内联任何条目内容、GitHub 字段与活跃度档位、归档与推荐口径互斥。有错误会以退出码 1 结束，不需要人肉校对。

B 站信息源额外校验：BV 号与视频链接格式、资源链接可解析、同一视频线索去重、`status` 只能取 `verified/pending/paid/removed/dead/unverifiable`、`origin` 只能取 `简介/评论/字幕`、`ts` 为非负秒数、字幕文本非空；并按官方链接（其次名称）跨视频去重聚合，自动写出 `data/bilibili-pending.json`。状态一致性也由构建强制：`verified` 必须 `free=true` 且有 `officialUrl`，`paid/removed/dead/unverifiable` 必须 `free=false`；带 `recheck` 的线索会校验核对日期、结论、渠道与证据链接。B 站免费条目若暂无截图，只进「待补图」报告（`bilibili.stats.pendingImages`）而不阻断构建，不生成占位图。

## 复核（最短用法）

```bash
node scripts/recheck.js
```

这一条命令会：读取 `data/recheck-evidence.json`（人工公开页面核对结论）→ 对 B 站线索与主目录 `obtain/source` 链接做限速 HTTP 检查（1 秒/次）→ 更新 `status`/`free`/核对时间 → 写 `data/recheck-report.json`（新增免费 / 转为收费 / 已下架 / 未能判定）→ 自动串跑 `node scripts/build.js`。

常用变体：

```bash
node scripts/recheck.js --scope=bili  # 只复核 B 站线索（更快）
node scripts/recheck.js --no-build    # 只复核，不构建
node scripts/recheck.js --dry-run     # 只读演练，不改数据、不写报告
```

规则：只访问公开页面，不登录、不绕过风控；403/429/503 记为「风控，未获取」，保持原状态；第三方网盘/转载站不自动改判；404/410 或页面 404 才判 `removed`。人工核对结论写回 `data/recheck-evidence.json`，下次仍可重跑复现。

## 生成核查报告

```bash
node scripts/report.js
```

先生成 `data/core.js` 与分片（内部串跑 `node scripts/build.js`），再从 `data/*.json` 现算全部数字，生成 `docs/REPORT-<抓取日期>.md` 与同日期 `.html`（自包含、可直接打印/分享）；生成前会断言报告总数与 `data/core.js` 的 `counts` 一致，不一致时退出非零。

## 新增 / 维护 B 站线索

本轮终态：34 个视频、51 条原始线索、48 个去重资源；`verified` 18、`paid` 24、`removed` 1、`unverifiable` 5、`pending` 0、`dead` 0。5 条 `unverifiable` 已结案并停止追踪；「风格化河边小屋」最后一轮命中 House Along the River / StylArts，$49.99，已从 `unverifiable` 改判 `paid`。状态与条数以 `data/core.js` 的 `counts.bili` 为准。

1. 只采集公开页面：视频页元数据、简介原文、热门评论、播放器公开字幕列表；不下载音视频、不做 ASR、不绕过登录或风控。
2. 在 `data/bilibili.json` 的 `videos` 数组追加一条视频对象（字段见下），或给已有视频补 `mentions`。
3. 运行 `node scripts/build.js`：校验、去重聚合、更新 `data/assets.js`/`assets.json` 与待核实清单；**不需要** `--page`，页面模板无需改动。
4. 核实通过且值得进主目录的资源，另在 `data/resources.json`/`data/tools.json` 新增条目，并在 `extra.bilibili` 保留来源视频链接。
5. 改判或新增免费条目前先跑 `node scripts/recheck.js`：人工核对结论落到 `data/recheck-evidence.json`，实时检查只做补充；变动清单在 `data/recheck-report.json`。判定「免费」必须有 `officialUrl`，判定「已收费/已下架」必须 `free=false`，否则构建失败。
6. 决策与踩坑记录：方案取舍写 `docs/decisions.md`，可复用规则写 `docs/RETRO.md`；规则生效在 `scripts/build.js` 校验或 `scripts/recheck.js` 流程里，本段维护步骤随工作流同步更新。

B 站数据字段要点：

| 字段 | 说明 |
|---|---|
| `bvid` / `aid` / `url` | BV 号、av 号、视频完整链接 |
| `up` / `upMid` / `views` / `publishedAt` | UP 主、UID、播放量、发布日期 |
| `desc` / `descStatus` / `descFetchedAt` | 简介原文（尽量完整、保留换行）、获取状态、抓取日期；拿不到写「未获取」 |
| `comments[]` | `user/like/text/origin/ctime`；接口热门评论，非置顶评论 |
| `subtitles[]` | `{lang, auto, source, text, fetchedAt}`；匿名拿不到时为空并写 `subtitleStatus` |
| `mentions[]` | `name/type/free/status/origin/ts/rawUrl/officialUrl/thirdParty/note/resourceId` |

`mentions.origin` 标明线索来自「简介」「评论」还是「字幕」；字幕命中的 `ts` 为秒数，页面 B 站链接自动拼 `?t=<秒>`。`thirdParty: true` 表示网盘等非官方入口，页面标注「第三方来源，未核实安全性」，不当作主力下载入口。`resourceId` 必须指向主目录中已存在的条目。

`mentions.status` 口径：`verified` 已核实免费可用（必须 `free=true` 且有 `officialUrl`）；`paid` 已收费；`removed` 已下架/404；`dead` 历史失效；`pending` 待核实；`unverifiable` 渠道穷尽仍无法核实（必须列 `channels`，页面写「查过但无法确认」）。`paid/removed/dead/unverifiable` 必须 `free=false`。改判时附 `recheck: {at, verdict, method, evidenceUrl, channels, priceNote, note}`，核对日期、证据链接与查过渠道可追溯。对 `unverifiable` 做最后一轮作者名反查（原名/英文名/数量特征 + ArtStation/Discord/原始发布站），仍无结果就把最后一轮渠道写进 note 并结束该线索的追踪，不重复追。

## GitHub 插件（采集与口径）

数据在 `data/github.json`，构建后生成独立分片 `data/github.js`，对应视图 `#/github`（停滞/归档口径 `#/github/stale`），同时合并进工具条目（来源站 `github`，工具视图可按来源筛选）。

本轮终态：84 条；活跃 60 / 一般 10 / 停滞 12 / 归档 2；6 条「久未更新但高人气」保留推荐，6 条低人气存疑，归档 2 条默认不展示。12 个重点仓库补齐 release 与默认分支；release 可追溯 8 条、明确无 release 4 条、未获取 72 条；UE 版本 5.x 70 条、4.x 7 条、未获取 7 条。

采集只走公开、未认证 GitHub API，不绕限额：

- search 限额 10 次/分钟、core 60 次/小时；主要靠 search 返回字段（`full_name`、`description`、`stargazers_count`、`forks_count`、`pushed_at`、`license`、`archived`、`topics`、`html_url`），`per_page=100` 少量查询覆盖。
- 只对少数重点仓库补详情；命中限额立即停止并写「未获取」，不换账号、不刷接口。
- 查询维度：`topic:unreal-engine`、`topic:unreal-engine-plugin`、`topic:ue5`、`topic:ue4-plugin` 加关键词（unreal engine plugin、ue5 plugin、unreal editor tool 等），分组为编辑器效率、蓝图与脚本、性能调试、版本管理与协作、AI 辅助、美术与关卡。
- 剔除：与 UE 无关、纯文档、空壳/无实质代码仓库；同一仓库按 `owner/name` 归一化去重，并与已有 Fab/GitHub 条目按仓库全名去重。

字段：`repo`、`author`、`url`、`description`、`group`、`license`、`stars`、`forks`、`openIssues`、`pushedAt`、`lastRelease`、`archived`、`activity`、`ueVersion`、`install`、`hasDocs`、`platformNote`、`image`、`imageSource`、`verified`，以及人气占位 `likes` / `reviewCount`（取不到写「未获取」）；补过详情的重点仓库另有 `defaultBranch`。

`lastRelease` 允许三种取值：`tag（YYYY-MM-DD）`、`无 release`、`未获取`；`ueVersion` 优先取 `.uplugin` 的 `EngineVersion`，未写时沿用 README/描述里明确的 `4.x` / `5.x`，不臆测精确版本，取不到写「未获取」（本轮 12 个补详情仓库的 `.uplugin` 均无 `EngineVersion`，故未标 `ueVersionSource`）。

许可风险：GPL/AGPL 在页面标「传染风险」；无许可文件写「未声明许可，商用前需联系作者」；`licenseRisk` 参与卡片展示。

截图：优先下载仓库社交预览图/OG 图为本地 JPEG；OG 429 时随机退避重试，仍失败改取 README 首图（跳过 badge/SVG，相对路径按 raw 解析，GitHub assets 链接跟随 302）；仍拿不到不伪造，进「待补图」清单（`#/lists/pending-images`），并在 `meta.imageMissing` 记录仓库名。

限额补充：详情只给重点仓库（久未更新但高人气、活跃高星、主推荐），每仓 `repo` + `releases/latest` 两次；`.uplugin` 走 `raw.githubusercontent.com` 不占 API；`x-ratelimit-remaining ≤ 3` 立即停止，`meta.enrich` 记录调用数、剩余额度与原因。

## 人气与推荐判定（双口径）

只按最近提交时间一刀切会误杀「久未更新但社区常用」的插件，因此推荐判定同时看活跃度与人气：

| 档位 | 条件 | 列表表现 |
|---|---|---|
| 活跃 | 近 6 个月有提交 | 正常推荐，徽章「活跃」 |
| 一般 | 6–12 个月 | 正常推荐，徽章「一般活跃」 |
| 久未更新但高人气 | 超 12 个月，且 stars ≥ 300 或处于该分组 stars 前 20% | 仍推荐，徽章「久未更新，社区常用」，备注最后提交时间、UE 版本、可能需手动改编译 |
| 久未更新且人气低 | 超 12 个月，且未达高人气阈值 | 进「不推荐/存疑」，默认不展示 |
| 归档 | `archived=true` | 徽章「归档，谨慎使用」，默认不展示 |

排序：默认「综合热度」，`heat = stars * 2 + forks + max(0, 30 - openIssues)`，热度相同再按活跃度、最后按仓库名，保证可复现；另提供按星标、最近更新、高人气/久未更新、名称排序。筛选：分组、活跃度、星标下限、「仅推荐（排除归档与低人气）」、关键词。

校验（`build.js`）：URL 合法；`stars/forks/likes/reviewCount` 必须是整数或「未获取」；日期可解析；`activity` 与 `pushedAt` 一致；`archived` 与推荐口径互斥；`license` 非空或显式「未获取」；无图进待补图；路由与分片完整性照常校验。

## Epic 官方免费示例

`data/epic-samples.json` 是采集快照（可追溯），条目已合并进 `data/resources.json`，来源标记为 `epic`（`tags[0]` 为「Epic官方」，`extra.epic=true`）。归入「资源 → 示例与模板（免费）」以及 env/character 等对应分类。

本轮终态：34 条，完整示例工程 22 / 场景资产包 9 / 学习内容 2 / 模板 1；32 条商品页许可为 Epic Content License（UE-Only），2 条来自 Epic 官方文档页；体积未获取 32 条。

字段要求：`extra.type` 写明「完整示例工程 / 场景资产包 / 学习内容 / 模板」；`extra.gate` 写插件与硬件门槛（Nanite/Lumen、PVE、World Partition、Motion Matching 等）；许可统一写 Epic Content License 限制（仅限 UE 项目内使用、不可单独再分发、不可用于非 UE 引擎），有额外商用限制的单独注明；评分/评价数拿不到写「未获取」；体积拿不到写「未获取」。

获取路径必须写出来：网页 Add to Library、Epic Games Launcher 的 Fab / 学习页搜索名、或 GitHub 镜像，避免用户点进去不知道如何领取。Fab 直连 403 时改用官方文档页与搜索引擎快照取证，标「风控，未获取」，价格与评分绝不编造。

去重：与既有 City Sample / Lyra / Quixel Megascans 示例按资源名与官方链接归一化比对，重复不建新条。新增数据仍只跑 `node scripts/build.js`。

## 字段 schema（固定 21 个字段，未知填「未获取」或 null，字段名不可改）

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 小写字母/数字/连字符，全局唯一；截图文件名与它一致 |
| `name` | string | 显示名称 |
| `kind` | `resource` \| `tool` | 资源或工具 |
| `category` | string | 分类 ID，见下表 |
| `subcategory` | string | 必须是 `categories.json` 中该分类的子分类之一 |
| `priceType` | `free` \| `paid` | 免费 / 付费 |
| `license` | string | 许可原文；未知填「未获取（原因）」 |
| `engine` | string | 适用引擎版本；未知填「未获取（原因）」 |
| `format` | string | 文件格式/资产类型 |
| `size` | string | 体积；未知填「未获取」 |
| `obtain` | string | 可直达的下载页/仓库链接（http/https） |
| `source` | string | 来源页面（http/https） |
| `price` | number \| null | 付费有价填正数；抓不到填 null，并在 `notes` 显式写「未获取」及页面显示形式；免费必须 null |
| `currency` | string \| null | 有价填 `CNY`；价格未获取或免费必须 null |
| `rating` | number \| null | 0–5；未获取填 null（页面显示「评分未获取」） |
| `reviews` | number \| null | 评价数；未获取填 null；付费评价数 <10 会在页面标「样本少」 |
| `notes` | string | 备注，写清坑点（需登录/需署名/仅 UE 可用/版本兼容） |
| `image` | string \| null | 相对路径 `assets/img/<分类>/<id>.jpg`；免费必填；付费缺失会进「待补图」清单 |
| `tags` | string[] | 至少 1 个；第一个通常用于来源展示 |
| `verified` | string | `YYYY-MM-DD` |
| `extra` | object | 扩展信息，如 `{"seller":"Epic Games","stars":123,"archived":true}` |

付费项必须有 `price` 或 `notes` 明示「未获取」；`rating` / `reviews` 为数值或 null；`license` 非空。免费项必须有真实截图，付费缺图进「待补图」清单。

## 分类 ID

资源：`env` 环境/场景、`material` 材质贴图、`prop` 道具模型、`character` 角色动画、`vfx` 特效、`audio` 音频、`ui` UI/字体图标、`blueprint` 蓝图/示例/模板、`other` HDRI/天空。

工具：`editor` 编辑器效率、`blueprint-script` 蓝图/脚本、`art-level` 美术与关卡、`animation` 动画、`audio-tool` 音频、`perf-debug` 性能与调试、`build` 打包与工程、`vcs` 版本管理、`ai` AI 辅助、`other-tool` 其他。

新增子分类时，先改 `data/categories.json` 的 `subcategories`，再在条目里使用。

## 示例条目

```json
{
  "id": "polyhaven-hdri-example",
  "name": "Example HDRI",
  "kind": "resource",
  "category": "other",
  "subcategory": "HDRI 天空",
  "priceType": "free",
  "license": "CC0",
  "engine": "通用（可导入 UE4/UE5）",
  "format": "HDR / EXR",
  "size": "约 20 MB（4K HDR）",
  "obtain": "https://polyhaven.com/a/example",
  "source": "https://polyhaven.com/a/example",
  "price": null,
  "currency": null,
  "rating": null,
  "reviews": null,
  "notes": "免登录直下；CC0 可商用；UE 中用 HDRI Backdrop 或 Sky Light。",
  "image": "assets/img/other/polyhaven-hdri-example.jpg",
  "tags": ["Poly Haven", "HDRI"],
  "verified": "2026-11-03",
  "extra": {}
}
```

## 数据口径

- Fab 价格为中国区税前 CNY，随地区、汇率、折扣变化；评分/评价数取抓取时页面值。
- 抓不到的价格、评分、评价数、许可、星标一律写「未获取」，不估算、不编造。
- 免费条目截图全部本地化；付费条目截图来自商品页缩略图。
- GitHub 工具条目截图是仓库 OG/社交预览图，非编辑器实机截图；拿不到进待补图，不热链、不伪造。
- 归档仓库保留但标注「已归档」，默认不进推荐列表；久未更新但高人气仍推荐并说明风险。
- 页面显示人气样本量（stars、评分 + 评价数），不只给一个星级图标；缺失时明示「未获取」。
- 付费数字分两个口径写：总盘 50 条与新增批次 13 条，不要用新增批次替换总盘；报告里同时保留两个口径。
- 来源计数、原始线索、去重资源、全条目归档、GitHub 归档是不同口径；出现 41/34、129/84、51/48、5/2 这类差异时在正文标注范围，不当作矛盾。

## 发布（GitHub Pages）

- 线上地址：<https://qyuejinzhao.github.io/UEGameRes/>
- 仓库：<https://github.com/QYueJinZhao/UEGameRes>
- Pages 源：`main` 分支根目录（Deploy from a branch，`build_type=legacy`）；不使用 GitHub Actions。
- 页面与分片全部使用相对路径（`data/*.js`、`assets/img/...`），在 `/UEGameRes/` 子路径下可直接工作，不依赖站点根路径。
- 更新流程：改数据跑 `node scripts/build.js`，改模板跑 `node scripts/build.js --page`；提交并 push 到 `main` 后 Pages 自动重建。
- 在线验证：`curl.exe -s -o NUL -w "%{http_code} %{content_type}" https://qyuejinzhao.github.io/UEGameRes/`。

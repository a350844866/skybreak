# Skybreak 参赛路线与分工（2026-11-20，MBP Claude 制定）

用户于 2026-11-20 授权“按推荐的来，你自己把控”。本文是之后各方（用户 / 家服 Claude / MBP Claude / Junie）的共同依据。规则原文于 2026-11-20 读取自 <https://cloud9.devpost.com/rules>，以下时间均已换算为北京时间。

## 1. 规则要点（以原文为准）

| 项 | 内容 |
|---|---|
| 提交截止 | **2027-01-13 03:00**（太平洋时间 2027-01-12 11:00）。之后不能再修改提交 |
| 评审期 | 2027-01-28 07:00 – 2027-02-04 07:00 |
| 公布获奖 | 约 2027-02-09 04:00 |
| 资格 | 成年个人可参赛。排除的是美国法律或当地法律禁止参赛、领奖的地区（原文列名：Brazil, Quebec, Russia, Crimea, Cuba, Iran, North Korea，以及 OFAC 全面制裁国家），中国大陆不在其中。Cloud9 / Devpost / JetBrains / GRID 的员工及其家属不能参赛 |
| 领奖 | 需填写 W-8BEN 等表格，税与外汇手续由获奖者自理。GDC 差旅需要自办美国签证，签不下来只放弃差旅部分，现金仍可领 |
| Category 3 要求 | “Use a JetBrains tool (Rider recommended) to build a mini game playable at a Cloud9 booth or event.” 必须是开赛（2026-11-17）后新建，或开赛后有重大更新的项目。本仓库首次提交为 2026-11-19，满足 |
| 可用工具 | JetBrains IDE（IntelliJ IDEA / PyCharm / WebStorm / Rider / DataGrip）、JetBrains Air、AI Coding Agent Junie |
| 第一轮 | pass/fail：是否切题，是否“reasonably applies the required JetBrains tools” |
| 第二轮 | 5 项等权：Technological Implementation（JetBrains 工具用得多深、多熟练）/ Design（完整的产品体验）/ Potential Impact（为真实人群解决真实问题）/ Quality of the Idea（创意）/ Presentation（视频是否端到端讲清楚）。**同分时按上面顺序逐项比较，第一项就是 JetBrains 工具** |
| 奖金 | Cat 3 冠军：$6,000 + $100 礼品卡 + All Products Pack 一年 + GDC 门票和差旅；亚军：$2,000 + $100 + APP；加分奖 Best AI-Powered Workflow Story：$1,000 + $100 + APP。一个作品最多拿 1 个类别奖 + 1 个加分奖 |

**必交材料**：

1. GitHub 仓库 URL：必须**公开**，含全部源码、资源和运行说明，并有能在 About 栏识别的开源许可证（已有 MIT）。规则鼓励提交 `.idea` / `.junie` / `.air` 目录作为使用证据
2. 英文文字说明：功能介绍，并说明用了哪些 JetBrains 工具
3. 可玩演示链接：网站类项目要给能玩的地址，计划用 GitHub Pages
4. 演示视频：少于 3 分钟，在 YouTube **公开**发布；要拍到在目标设备（桌面电脑）上实际运行；不得含第三方商标或有版权的音乐
5. Methodology write-up：说明做法，以及它如何解决类别里的问题
6. 加分奖（可选）：例如仓库里放一份 `AI_SHOWCASE.md`，讲清楚用 JetBrains IDE / Junie / Air 开发的经历
7. 所有材料用英文（或附英文翻译）

## 2. 现状差距

| 维度 | 现状 | 风险 |
|---|---|---|
| JetBrains 工具 | M1–M3 由家服 Claude Code 写成；仓库里没有 `.idea` / `.junie` / `.air` | 🔴 第一轮 pass/fail，也是同分时的第一裁决项 |
| Design | 人工试玩打 0 分（“太无趣”）；彗星段“跟不上速度” | 🔴 |
| 性能 / 稳定 | 达标，见 [2026-11-20-mbp.md](2026-11-20-mbp.md) | 🟢 |
| 仓库 | 私有；MIT 许可证已能被 GitHub 识别 | 🟡 提交前必须公开 |
| 提交物 | README / Methodology / 视频 / Pages / AI_SHOWCASE 都还没有 | 🟡 |

## 3. 已定路线

1. **之后所有 `src/` 改动都由 Junie 实现**，在 WebStorm 项目里进行。Claude（MBP / 家服）只负责编排任务、评审 diff、真机测试和起草文档，不再直接写游戏代码。家服正在做的 M4 照常收尾，不浪费
2. **使用证据必须是真的**：`.idea` 由 WebStorm 打开项目时自然生成，只提交共享部分（`*.iml`、`modules.xml`、`runConfigurations/`、`codeStyles/`）；`.junie` 是 Junie 实际运行留下的内容。**不伪造、不补造**任何使用痕迹。`AI_SHOWCASE.md` 如实写明：M1–M3 由 Claude Code 完成，之后由 Junie 在 WebStorm 中迭代，Claude 负责编排、评审，并用真 GPU 机器人回归测试
3. **先修玩法，再加固、再做提交物**。Design 和 Presentation 都依赖“好玩”
4. **main 单写者**：同一时间只有一方往 main 推送。交接方式：在对应分支的 `playtest/` 文档或 commit message 里写明“main 交给 X”，接手方先 `git pull` 再开工。Junie 的任务一律在 `junie/<slug>` 分支上做，评审通过后合入 main
5. 对外、不可逆的动作（仓库公开、GitHub Pages、YouTube 发布、Devpost 提交）**到时逐项请用户确认**

## 4. 分工

| 角色 | 负责 |
|---|---|
| 用户 | Devpost “Join Hackathon”注册；兑换报名送的 All Products Pack 码和 AI Ultimate 码；JetBrains 账号登录（Junie 鉴权）；每轮人工试玩；确认仓库公开；YouTube 上传；最终提交 |
| MBP Claude | 安装 Junie CLI（需用户同意下载）；给 Junie 写任务、跑任务、评审 diff；用 `playtest/bot_mbp.py` 做真 GPU 回归；起草英文 README / Methodology / AI_SHOWCASE；录制视频素材 |
| 家服 Claude | 完成 M4 并推送 main 后交出 main；之后负责评审、CI 和 300 局无头 soak（`--headless`），不再直接改 `src/` |
| Junie | `src/`、`tests/` 下所有新功能和调参的实现；所需的 `DESIGN.md` 数值同步由任务明确授权 |

## 5. 时间线（北京时间）

| 时间 | 目标 |
|---|---|
| 11-20 – 11-23 | Devpost 注册、兑换码；Junie CLI 装好并登录；在 WebStorm 中打开项目，提交共享 `.idea`；家服推送 M4 |
| 11-24 – 11-30 | Junie 任务 #1（[junie-task-01-comet-pacing.md](junie-task-01-comet-pacing.md)）：彗星公平性、闪电节奏、首次点击卡顿、控制台清理 → MBP 真机回归 → 第二轮人工试玩 |
| 12-01 – 12-14 | 根据第二轮试玩定趣味性改造（Junie 任务 #2 起）；在最终构建上跑 300 局 soak；有条件的话在 Windows 核显机上验证 12 ms 预算（DESIGN 的目标是 integrated graphics） |
| 12-15 – 12-21 | 功能冻结；英文 README / Methodology / AI_SHOWCASE；用户确认后公开仓库并部署 GitHub Pages |
| 12-22 – 01-04 | 演示视频（< 3 min）：真人试玩镜头 + 机器人录屏 + 展位视角（ATTRACT、排行榜副屏、运营面板）；用户上传 YouTube 并公开 |
| 01-05 – 01-10 | 填 Devpost 草稿，按 §1 清单逐项核对，**01-10 前提交**。01-13 03:00 截止前留作缓冲 |

## 6. Potential Impact 与 Idea 的论证素材（写提交物时用）

- **真实场景**：展位上一局 60 s，加倒计时和结算约 90 s，一台机器每小时可接待约 40 名玩家；完全离线；排行榜在副屏实时刷新；运营面板支持 PIN、清榜、导出 CSV
- **展位可靠性已有实测数据**：10 局耐久内存持平、0 报错、120 Hz 零掉帧，见 [2026-11-20-mbp.md](2026-11-20-mbp.md)
- **差异点**：同类瞄准训练器（Aim Lab、KovaaK's 这类）面向个人长期训练；Skybreak 面向路过的展位观众，60 秒出一张“技能卡”，带每日排行和 attract 模式。趣味性改造要放大这些差异，而不是做成又一个瞄准训练器

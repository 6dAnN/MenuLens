# MenuLens · 你的 AI 美食伴侣

> 拍一张菜单，安心点一桌菜

一套完整的产品交付：**PRD + UI/UX 规范 + 两个可运行的 demo**（H5 / 微信小程序原生工程）。

小程序五项 AI 能力（菜单解析 / 拍照识菜 / 点单方案 / 菜谱生成 / AI 小助手）全部走
**WorkBuddy 云服务**的真实大模型，不需要任何 API Key。知识库检索（RAG）在本地完成，
断网也能用。Dify 作为产品原型的初始方案保留在 `dify-backup/`，未启用；后续有意向拓展成网页。

三个不妥协的设计取舍：

1. **过敏原与忌口过滤永远在代码层**——模型只在已被过滤过的安全候选里挑选，绝不允许它决定「这道菜能不能上桌」。
2. **置信度必须摊开给用户看**——识菜给出百分比、模型看到的线索、以及它自己声明拿不准的地方。
3. **AI 思考态显示真实业务步骤**——步骤推进由引擎在真实节点回调，不是定时器演的。

---

## 📁 目录结构

```
AI小程序/
├── AI小程序.docx               原始提案（你的输入）
├── README.md                   本文件
│
├── docs/
│   ├── PRD.md                  完整产品需求文档
│   ├── UI-UX-设计规范.md        设计系统+页面线框+组件规范
│   ├── 云服务接入指南.md        当前方案：免密钥LLM通道怎么接的
│   ├── 识菜与RAG实现说明.md     真看图识菜链路 + 本地RAG设计取舍与踩坑
│   └── Dify接入指南.md          初始方案：Dify Workflow
│
├── knowledge/                  食品知识库（RAG 语料源文件）
│   ├── 菜品知识库.md            15 道核心菜结构化档案（每道菜一个 chunk）
│   └── 食材与过敏原知识.md      过敏原/营养/人群建议/场景搭配/问答速查
│
├── tools/
│   └── build-kb.js             把 knowledge/*.md 编译成 utils/kb-data.js
│
├── dify-backup/                Dify 初始方案的归档（不启用，不删）
│   ├── dsl/                    两个可导入 DSL（识菜 Workflow / 小助手 Chatflow）
│   └── Dify实操指南-识菜与小助手.md
│
├── demo/                       H5高保真可交互演示版
│   ├── index.html
│   ├── styles.css              设计系统落地
│   ├── data.js                 菜品知识库 + 模拟菜单
│   ├── ai-engine.js            AI 引擎
│   └── app.js                  页面路由/状态/全部交互
│
├── tests/                      自动化验证
│   ├── _smoke.js               H5全链路冒烟测试
│   ├── _unittest.js            引擎+模型输出二次校验（50 项）
│   ├── _ragcheck.js            RAG检索+识菜归一化（68 项，离线）
│   ├── _e2e.js                 真实端到端（真图识菜+RAG问答，需联网）
│   ├── _wxstub.js              Node侧 wx.request 桩
│   ├── _mpcheck.js             小程序工程静态校验
│   ├── _cloudcheck.js          云服务SDK契约验证
│   ├── _difysvc.js             Dify备选方案契约验证（18 项）
│   ├── _difycheck.js           Dify指南代码片段校验
│   ├── _syntax.js              H5关键中文串与重复定义检查
│   ├── _fixtures/              识菜测试用菜品照片
│   ├── *.txt                   各自的测试报告
│   └── _shots/                 21张界面截图
│
├── MenuLens-微信小程序.zip      本地打包产物
│
└── miniprogram/                微信小程序原生工程
    ├── app.js / app.json / app.wxss
    ├── package.json            声明云服务SDK依赖
    ├── project.config.json     可直接导入微信开发者工具
    ├── custom-tab-bar/         自定义tabBar
    ├── components/
    │   ├── nav-bar/            沉浸式导航栏
    │   ├── dish-card/          菜品卡
    │   └── ai-fab/             悬浮AI小助手头像（全局）
    ├── pages/
    │   ├── home/               首页（含AI引擎状态条）
    │   ├── menu/               菜单识别结果+约束面板
    │   ├── plan/               点单方案
    │   ├── dish/               拍照识菜（云端视觉模型真看图）
    │   ├── assistant/          AI小助手聊天页（云模型+本地RAG，流式）
    │   ├── recipe/             AI菜谱
    │   ├── mine/               我的
    │   ├── history/            历史记录
    │   └── settings/           AI引擎与模型+忌口设置
    └── utils/
        ├── engine.js           引擎统一入口
        ├── cloud.js            云服务封装（含视觉模型选择）
        ├── ai-cloud.js         云服务版五项AI能力
        ├── rag.js              本地RAG检索（BM25+中文n-gram）
        ├── kb-data.js          知识库数据（由 tools/build-kb.js 生成）
        ├── api.js              旧Dify实现
        ├── cloud-config.js     云服务凭证
        ├── wb-sdk.js           官方SDK小程序产物
        ├── dishes.js           菜品本体
        ├── planner.js          点单引擎+过敏原硬过滤
        ├── dify-service.backup.js  Dify初始方案服务层（页面不再引用）
        ├── dify-config.backup.js   Dify初始方案凭证（占位值）
        └── store.js            本地存储
```

---

## 🧰 环境要求与依赖安装

微信开发者工具

**跑自动化测试（可选）：** 需要 Node.js ≥ 18。

```bash
# 1) 检查 Node 版本
node -v          # 需 >= 18

# 2) tests/ 下的脚本是零依赖的，直接运行即可
node tests/_unittest.js
node tests/_mpcheck.js
node tests/_cloudcheck.js
node tests/_ragcheck.js     # RAG检索 + 识菜归一化（离线）

# 3) 真实端到端（需联网 + 本机已配云服务凭证）
node tests/_e2e.js

# 4) 只有 H5 冒烟测试需要额外依赖（CDP 驱动真实 Chrome）
npm install ws
node tests/_smoke.js
```

> 冒烟测试默认找 `C:\Program Files\Google\Chrome\Application\chrome.exe`，
> 装在别处时用环境变量指定：`set CHROME_PATH=D:\...\chrome.exe`（Windows）/ `export CHROME_PATH=...`（macOS/Linux）。
>
> 改了 `knowledge/` 下的语料，要先 `node tools/build-kb.js` 重建索引，
> 否则 `_ragcheck.js` 的知识库完整性检查会失败。

**可选：升级云服务 SDK**（仅当你需要换 SDK 版本时）

```bash
cd miniprogram
npm install @tencent-ai/workbuddy-cloud-sdk@dev
cp node_modules/@tencent-ai/workbuddy-cloud-sdk/miniprogram_dist/miniprogram.js utils/wb-sdk.js
```

---

## 🍽️ 拍照识菜：真看图，不是套模板

早期版本只把「用户拍了一道菜」这句文字发给模型，模型看不到像素，只能凭上下文编一个菜名。
现在走真多模态：图片转 base64 → 挑一个 `supportsImages` 的模型 → 以 `image_url` 内容块
进 messages → 模型返回结构化 JSON → 归一化后落到菜品档案。

提示词强制模型给出三个字段，这是「置信度摊开给用户看」的落地：

| 字段 | 作用 |
|---|---|
| `confidence` | 模型自评把握。照片糊、只拍局部时必须给 0.4 以下 |
| `evidence` | 它从图里**真的看到**的线索（"红油浮在表面"），不是套话 |
| `uncertainty` | 它自己声明看不清、可能判错的地方 |

置信度低于 60% 时进度点和数字一起变红。模型说的话要能追溯，不然那个百分比就只是个装饰。

用一张清汤牛肉粉的照片实测：

```
name=越南牛肉河粉 / Pho Bo     confidence=0.82     category=汤
evidence=["白碗中清汤浸白色宽河粉","表面铺粉红色生烫牛肉片","撒有大量葱花香菜和葱段"]
uncertainty=牛肉片看似生烫，也可能是猪肉片，且非越南馆子也可能只是普通牛肉汤粉
```

同一张图隔一会儿再跑，输出是「牛肉粉 / 0.72 / 主食」。**两次结果不同不是 bug**——
模型对同一张照片的把握本来就不是固定值，这正是要把不确定说出来的原因。

## 💬 AI 小助手：云服务模型 + 本地 RAG

语料 26 条 chunk、约 12K 字符，建向量库的收益远小于它的网络往返。所以检索在本地做：

- **中文分词**：单字 + 二元组双路索引。单字保召回，bigram 保精度；
- **BM25 打分**：词频饱和 + 长度归一化；
- **相关性闸门**：必须命中 ≥34% 的问题词项、且至少一个 bigram。未加闸门时
  「明天天气如何」会召回「干炒牛河」（天/气蒙上的）；
- **标题锚点**：用户说出菜名时那条 chunk 强制排第一，且做双向包含判断，
  所以「冬阴功」能命中标题为「泰式冬阴功」的条目。

资料拼在本轮 user 消息里（不放 system），每轮都重新看，不被上一轮带偏。
聊天页每条回答下方可展开「依据 N 条」，显示标题、来源、匹配分——AI 说的话可核查。

实测：

> **问**：宫保鸡丁含花生吗？
> **答**：含，花生是宫保鸡丁的核心食材之一…如果你或同行的人对花生过敏，这道菜就别点了。
> 另外提醒下：菜单识别可能有漏，酱料里的隐藏成分建议再向服务员确认一下。
> **命中**：宫保鸡丁(47.6) / 常见菜品问答速查(19.7) / 八大常见过敏原(15.5)

## 📍 入口与降级

全页面右下角有悬浮 ✦ 头像（`components/ai-fab`），点它展开 AI 小助手聊天页
（`pages/assistant`）。识菜页拍照或选图会调云端视觉模型真实识别。

云端不可用时按顺序降级，且**状态如实标黄**，不假装在走模型：

| 情况 | 表现 |
|---|---|
| 模型调用失败 | 识菜返回本地菜品档案并标记 `source: 'local'`，页面写明「本地知识库兜底」 |
| 无可用视觉模型 | 同上，并在日志里记录原因 |
| 对话失败 | 回退本地 Agent 回复，顶栏状态点变黄 |
| 知识库无命中 | 不硬塞资料，模型据实说「我这边没有确切资料」 |

---

## 📖 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 背景与问题、用户画像、场景剧本、功能范围（MoSCoW）、8个功能的详细需求、菜品本体 Schema、置信度计算规则、Agent 架构与4个 Workflow 节点设计、模型选型路由、非功能需求（性能/成本/安全）、成功指标与埋点、竞品差异化、8周里程碑、10项风险缓解 |
| [`docs/UI-UX-设计规范.md`](docs/UI-UX-设计规范.md) | 设计理念、色板/字阶/间距/圆角/阴影 Token、8大组件规格、7个页面线框、动效参数表、完整状态机、可访问性、小程序适配注意事项 |
| [`docs/云服务接入指南.md`](docs/云服务接入指南.md) | 免密钥 LLM 通道原理、文件职责、两条底线规则、模型选择、验证方式、常见问题 |
| [`docs/识菜与RAG实现说明.md`](docs/识菜与RAG实现说明.md) | 真多模态识菜链路、置信度三字段设计、本地 BM25 RAG 的三道相关性闸门、语料维护方式、已知边界 |
| [`docs/Dify接入指南.md`](docs/Dify接入指南.md) | 初始方案：Dify 4个 Workflow+1个 Agent+知识库的逐节点搭建步骤与Prompt（已归档，未启用） |

---

*MenuLens v1.2 · 2026-11-06*

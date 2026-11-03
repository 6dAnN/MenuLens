# MenuLens · 你的 AI 美食伴侣

> 拍一张菜单，安心点一桌菜

一套完整的产品交付：**PRD + UI/UX 规范 + 两个可运行的 demo**（H5 演示版 / 微信小程序原生工程）。
小程序已接入 **WorkBuddy 云服务**的大模型通道，**不需要 Dify，也不需要任何 API Key**。

---

## 📁 目录结构

```
AI小程序/
├── AI小程序.docx               原始提案（你的输入）
├── README.md                   本文件
│
├── docs/
│   ├── PRD.md                  完整产品需求文档（14 章）
│   ├── UI-UX-设计规范.md        设计系统 + 页面线框 + 组件规范
│   ├── 云服务接入指南.md        当前方案：免密钥 LLM 通道怎么接的
│   └── Dify接入指南.md          备选方案：Dify Workflow（未删除，未启用）
│
├── demo/                       H5 高保真可交互演示版（双击即开，离线可跑）
│   ├── index.html
│   ├── styles.css              设计系统落地（含全部组件样式）
│   ├── data.js                 菜品知识库 + 模拟菜单
│   ├── ai-engine.js            AI 引擎（约束推理 / 方案生成 / Agent）
│   └── app.js                  页面路由 / 状态 / 全部交互
│
├── tests/                      自动化验证
│   ├── _smoke.js               H5 全链路冒烟测试（CDP 驱动真实 Chrome）
│   ├── _unittest.js            引擎 + 模型输出二次校验（50 项）
│   ├── _mpcheck.js             小程序工程静态校验（含 11 项云服务接入规范）
│   ├── _cloudcheck.js          云服务 SDK 契约验证（不联网，wx 桩）
│   ├── _difycheck.js           Dify 指南代码片段校验
│   ├── _syntax.js              H5 关键中文串与重复定义检查
│   ├── *.txt                   各自的测试报告
│   └── _shots/                 21 张界面截图
│
├── MenuLens-微信小程序.zip      一键导入包（miniprogram + docs + README）
│
└── miniprogram/                微信小程序原生工程
    ├── app.js / app.json / app.wxss
    ├── package.json            声明云服务 SDK 依赖（SDK 产物已内置，可直接跑）
    ├── project.config.json     可直接导入微信开发者工具
    ├── custom-tab-bar/         自定义 tabBar
    ├── components/
    │   ├── nav-bar/            沉浸式导航栏
    │   └── dish-card/          菜品卡（置信度三态）
    ├── pages/
    │   ├── home/               首页（含 AI 引擎状态条）
    │   ├── menu/               菜单识别结果 + 约束面板
    │   ├── plan/               点单方案
    │   ├── dish/               拍照识菜
    │   ├── recipe/             AI 菜谱
    │   ├── mine/               我的
    │   ├── history/            历史记录
    │   └── settings/           AI 引擎与模型 + 忌口设置
    └── utils/
        ├── engine.js           引擎统一入口（页面只认它）
        ├── cloud.js            云服务封装（单例/流式/降级/用量）
        ├── ai-cloud.js         云服务版五项 AI 能力
        ├── api.js              旧 Dify 实现（保留可对比）
        ├── cloud-config.example.js  云服务配置模板（占位值，入库）
        ├── cloud-config.local.js     真实凭证（本地，.gitignore 已忽略）
        ├── wb-sdk.js           官方 SDK 小程序产物（内置，166KB）
        ├── dishes.js           菜品本体（知识库）
        ├── planner.js          点单引擎 + 过敏原硬过滤（纯函数）
        └── store.js            本地存储
```

---

## 🚀 快速开始

### 1. 看 H5 Demo（30 秒，离线可跑）

```
双击 demo/index.html
```

用 Chrome / Edge 打开即可，无需任何环境、无需联网。

### 2. 跑小程序（5 分钟）

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)
2. 打开工具 → **导入项目** → 选择 `miniprogram/` 目录
3. AppID 选 **「测试号」**（不用注册）
4. 点编译，即可真机预览

> **不需要执行「构建 npm」。** 云服务 SDK 的小程序产物已内置为 `utils/wb-sdk.js`，
> 导入即可跑通真实模型调用。
>
> 想升级 SDK 时才需要：
> ```bash
> cd miniprogram
> npm install @tencent-ai/workbuddy-cloud-sdk@dev
> cp node_modules/@tencent-ai/workbuddy-cloud-sdk/miniprogram_dist/miniprogram.js utils/wb-sdk.js
> ```

### 3. 一键导入包

`MenuLens-微信小程序.zip` 已打包好（187 KB）：

```
miniprogram/    微信小程序工程（不含 node_modules，SDK 已内置）
docs/           PRD / UI-UX 规范 / 云服务接入指南 / Dify 指南
README.md
AI小程序.docx   原始提案
```

解压后用微信开发者工具导入 `miniprogram/` 即可。

---

## 🤖 AI 能力说明

小程序端**已接入 WorkBuddy 云服务**，五项能力全部走真实大模型：

| 能力 | 实现方式 |
|---|---|
| 菜单解析 | 结构化 JSON 输出，本地 schema 校验 |
| 拍照识菜 | 多模态识别 + 候选 + 置信度 |
| 点单方案 | 代码硬过滤 → 模型挑选 → 代码二次校验 |
| AI 菜谱 | 按现有食材生成可执行步骤 |
| AI 对话 | 多轮对话，带会话路由 |

**不需要填任何 Key。** 凭证就是开通云服务时返回的 `endpoint` + `publishableKey`。

> 🔒 **仓库里不含真实凭证。**
> `utils/cloud-config.local.js` 存放真实的 endpoint 与 publishableKey，已被 `.gitignore` 忽略；
> 仓库只保留 `utils/cloud-config.example.js`（占位值）。
> 想跑通云端模型，复制一份填上自己的值：
>
> ```bash
> cp miniprogram/utils/cloud-config.example.js miniprogram/utils/cloud-config.local.js
> # 然后编辑 cloud-config.local.js，填入你的 endpoint 与 publishableKey
> ```
>
> 没填也能跑——云端鉴权失败会自动降级到本地确定性引擎，功能不受影响。

想看当前状态：首页底部有引擎状态条，绿点＝云端在跑，黄点＝已降级到本地。
也可以去 **「我的 → AI 引擎与模型」** 看模型目录、切换模型、测连通性。

切换引擎只改 `app.js` 一行：

```js
const ENGINE = 'cloud';  // 'cloud'（默认，免密钥）| 'dify'（走 utils/api.js）
```

**H5 demo 仍是本地确定性引擎**——它要做到双击即开、离线可跑，联网不是它的
前提。两套共用同一套算法（`demo/ai-engine.js` 与 `miniprogram/utils/planner.js`），
改逻辑要两边都改。

---

## 🛡️ 两条安全底线

### 1. 过敏原过滤永远在代码层

模型**不允许**决定「这道菜能不能上桌」。顺序是：

```
hardFilter(items, ctx)   →  得到安全候选 kept
       ↓
模型只在 kept 里挑选 + 写理由
       ↓
assemblePlan() 二次校验：
  · 菜名必须真实存在于 kept，否则丢弃
  · 总价必须 ≤ 预算，否则丢弃
  · 缺理由用本地 pickReason 兜底
  · 结构非法返回 null → 触发降级
```

白切鸡在菜品本体里标了含蛋，但配料写「三黄鸡」——靠文本匹配必然漏。
这 9 条防线在 `tests/_unittest.js` 第 11 组逐条验证。

### 2. 前端不碰任何服务端密钥

`_mpcheck.js` 会扫描 `Bearer`/`sk-`/`app-` 形式的密钥，发现即报错。
唯一允许出现在前端的是 `publishableKey`，它只标识应用、不带权限。

---

## 🧪 测试

```bash
# 云服务 SDK 契约验证（不联网，用 wx 桩跑通 SDK 全链路）
node tests/_cloudcheck.js   # 6 项契约 + 流式解析

# 引擎 + 模型输出二次校验 + 对话安全
node tests/_unittest.js     # 50 项

# 小程序工程静态校验（含 11 项云服务接入规范）
node tests/_mpcheck.js      # 语法 / JSON / 页面 / 组件 / 事件 / 字段 / 接入规范

# H5 演示版关键中文串与重复定义检查
node tests/_syntax.js

# H5 全链路（需要本机 Chrome）
node tests/_smoke.js        # 18 项检查 + 21 张截图 → tests/_shots/
```

> 提示：`node` 用托管版 `C:\Users\Danny\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`。
> 冒烟测试跑之前先删掉 `tests/_shots/` 里的旧截图。
> Chrome 不在默认路径时，用 `CHROME_PATH` 环境变量指定。
> 所有测试脚本的路径都按自身位置推导，**换台机器也能直接跑**。
> 报告统一落在 `tests/*.txt`。

当前状态：**云服务契约 6 项全过 · 引擎 50 项全过 · 小程序校验全通过（含接入规范 11 项）· H5 18 项全过 0 报错**

测试覆盖的硬约束：
- 方案总价永远不超预算
- 忌口/过敏原菜品 0 出现在方案中
- 模型编造菜名 / 推荐忌口菜 / 超预算，**全部在代码层被拦下**
- 每道菜都有具体理由且不含「根据您的需求」这类套话
- 所有候选被过滤时给出明确说明而非白屏
- 过敏原以菜品本体字段为准（白切鸡标含蛋但配料写「三黄鸡」，仍正确命中）
- 越权指令在调用模型**之前**就被拦截，不给模型任何机会
- 请求只走 `/.cloud/llm/**`，不手写路径、不经 BFF
- `stream:true` 与 `messages[0]=system` 强制存在

---

## 📖 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 背景与问题、用户画像、场景剧本、功能范围（MoSCoW）、8 个功能的详细需求、菜品本体 Schema、置信度计算规则、Agent 架构与 4 个 Workflow 节点设计、模型选型路由、非功能需求（性能/成本/安全）、成功指标与埋点、竞品差异化、8 周里程碑、10 项风险缓解 |
| [`docs/UI-UX-设计规范.md`](docs/UI-UX-设计规范.md) | 设计理念、色板/字阶/间距/圆角/阴影 Token、8 大组件规格、7 个页面线框、动效参数表、完整状态机、可访问性、小程序适配注意事项 |
| [`docs/云服务接入指南.md`](docs/云服务接入指南.md) | 免密钥 LLM 通道原理、文件职责、两条底线规则、模型选择、验证方式、常见问题 |
| [`docs/Dify接入指南.md`](docs/Dify接入指南.md) | 备选方案：Dify 4 个 Workflow + 1 个 Agent + 知识库的逐节点搭建步骤与 Prompt 全文（已保留但未启用） |

---

## 💡 给下一阶段的建议

1. **知识库是最大的工作量**，不是模型。首期 500 道菜建议提前 2 周启动采集。
2. **置信度体系是这个产品的差异化**。竞品都在藏不确定性，把它摊开给用户看反而建立信任。
3. **忌口必须是硬过滤**。软性提示在真实场景下会出人命，这是不可妥协的。
4. **模型可以换，过滤不能交给模型**。这套代码在换任何模型供应商时都不用动。

---

*MenuLens v1.1 · 2026-10-23*
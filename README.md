# MenuLens · 你的 AI 美食伴侣

> 拍一张菜单，安心点一桌菜

一套完整的产品交付：**PRD + UI/UX 规范 + 两个可运行的 demo**（H5 /微信小程序原生工程）。
小程序接入WorkBuddy云服务大模型，但产品原型需要Dify，后续有意向拓展成网页。

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
│   └── Dify接入指南.md          初始方案：Dify Workflow
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
│   ├── _unittest.js            引擎+模型输出二次校验
│   ├── _mpcheck.js             小程序工程静态校验
│   ├── _cloudcheck.js          云服务SDK契约验证
│   ├── _difycheck.js           Dify指南代码片段校验
│   ├── _syntax.js              H5关键中文串与重复定义检查
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
    │   └── dish-card/          菜品卡
    ├── pages/
    │   ├── home/               首页（含AI引擎状态，但是目前一期AI助手还未接入）
    │   ├── menu/               菜单识别结果+约束面板
    │   ├── plan/               点单方案
    │   ├── dish/               拍照识菜
    │   ├── recipe/             AI菜谱
    │   ├── mine/               我的
    │   ├── history/            历史记录
    │   └── settings/           AI引擎与模型+忌口设置
    └── utils/
        ├── engine.js           引擎统一入口
        ├── cloud.js            云服务封装
        ├── ai-cloud.js         云服务版五项AI能力
        ├── api.js              旧Dify实现
        ├── cloud-config.js     云服务凭证
        ├── wb-sdk.js           官方SDK小程序产物
        ├── dishes.js           菜品本体
        ├── planner.js          点单引擎+过敏原硬过滤
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

# 3) 只有 H5 冒烟测试需要额外依赖（CDP 驱动真实 Chrome）
npm install ws
node tests/_smoke.js
```

> 冒烟测试默认找 `C:\Program Files\Google\Chrome\Application\chrome.exe`，
> 装在别处时用环境变量指定：`set CHROME_PATH=D:\...\chrome.exe`（Windows）/ `export CHROME_PATH=...`（macOS/Linux）。

**可选：升级云服务 SDK**（仅当你需要换 SDK 版本时）

```bash
cd miniprogram
npm install @tencent-ai/workbuddy-cloud-sdk@dev
cp node_modules/@tencent-ai/workbuddy-cloud-sdk/miniprogram_dist/miniprogram.js utils/wb-sdk.js
```

---

## 📖 文档索引

| 文档 | 内容 |
|---|---|
| [`docs/PRD.md`](docs/PRD.md) | 背景与问题、用户画像、场景剧本、功能范围（MoSCoW）、8个功能的详细需求、菜品本体 Schema、置信度计算规则、Agent 架构与4个 Workflow 节点设计、模型选型路由、非功能需求（性能/成本/安全）、成功指标与埋点、竞品差异化、8周里程碑、10项风险缓解 |
| [`docs/UI-UX-设计规范.md`](docs/UI-UX-设计规范.md) | 设计理念、色板/字阶/间距/圆角/阴影 Token、8大组件规格、7个页面线框、动效参数表、完整状态机、可访问性、小程序适配注意事项 |
| [`docs/云服务接入指南.md`](docs/云服务接入指南.md) | 免密钥 LLM 通道原理、文件职责、两条底线规则、模型选择、验证方式、常见问题 |
| [`docs/Dify接入指南.md`](docs/Dify接入指南.md) | 备选方案：Dify4个 Workflow+1个 Agent+知识库的逐节点搭建步骤与Prompt（已保留但未启用） |

---

*MenuLens v1.1 · 2026-10-23*

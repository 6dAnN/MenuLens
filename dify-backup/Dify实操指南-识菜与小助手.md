# Dify 接入实操指南（识菜 + AI 小助手）

> 本文档是「把 MenuLens 的 AI 识菜和小助手做成真的」的完整落地步骤。
> 你已经在 Edge 登录了 cloud.dify.ai，全程在这个站点操作。

---

## 0. 你需要准备的东西

| 项目 | 说明 |
|---|---|
| Dify 账号 | cloud.dify.ai（已登录） |
| OpenRouter API Key | 用于 Dify 里的模型供应商（视觉模型 + LLM） |
| 知识库文档 | `knowledge/` 目录下的两份 Markdown |

---

## 一、配置模型供应商（OpenRouter）

Dify 云服务默认没有模型，需要先接一个供应商。

1. 打开 cloud.dify.ai，右上角头像 → **设置** → **模型供应商**
2. 找到 **OpenRouter**，点「安装」/「添加」
3. 填入你的 OpenRouter API Key
4. 确认视觉模型可用（如 `openai/gpt-4o`、`anthropic/claude-3.5-sonnet`）和对话模型（`openai/gpt-4o-mini`、`openai/gpt-4o`）

> 识菜用视觉模型（能看图的），小助手用普通 LLM 即可。

---

## 二、建知识库

1. 顶部导航 → **知识库** → **创建知识库**
2. 名称：`MenuLens 食品知识库`
3. 上传 `knowledge/菜品知识库.md` 和 `knowledge/食材与过敏原知识.md`
4. 分段设置：选 **自定义**，分块长度 2000 token，或用默认「高质量」自动分段
5. 索引方式：**高质量**（向量模型选 `text-embedding-3-small` 或 `bge-m3`）
6. 检索设置：**Top-K = 5，Score 阈值 = 0.4**
7. 等待索引完成（几分钟）

> 记下知识库，后面两个应用都会引用它。

---

## 三、创建「识菜」Workflow

### 方式 A：导入 DSL（推荐，最快）

1. 顶部 → **创建应用** → **Workflow**
2. 名称填 `menulens-dish-recognize`
3. 进入编辑器后，点右上角 **...** 菜单 → **导入 DSL**
4. 上传 `dify-dsl/识菜-workflow.yml`
5. 导入后会看到 4 个节点：开始 → 视觉识别 → 知识库检索 → 结束

### 导入后必须手动做 2 件事

**① 把「视觉识别」节点换成能看图的模型**
- 点「视觉识别」节点 → 模型选一个**视觉模型**（如 `openai/gpt-4o`）
- 确认 `temperature = 0.1`，**开启视觉功能**（vision enabled）
- 注意：这个节点需要接收图片。如果 DSL 导入后图片输入没接上，把「开始」节点的 `image` 变量改成**文件类型**（单图），并把视觉识别节点的输入图片绑定到它。

**② 把「知识库检索」节点绑定到你的知识库**
- 点「知识库检索」节点 → 「知识库」下拉选 `MenuLens 食品知识库`
- Top-K = 3，Score 阈值 = 0.4

### 方式 B：手动搭建（如果 DSL 导入有问题）

节点链路：
```
开始(image: 文件/单图) → LLM(视觉模型, t=0.1, 结构化输出) → 知识库检索(Top-3) → 结束(result: 结构化JSON)
```
「视觉识别」节点的 System Prompt 照抄 `dify-dsl/识菜-workflow.yml` 里的那段。

### 测试

右上角 **运行**，上传一张菜品照片，确认输出是结构化的菜品 JSON（含 name / confidence / category / allergens 等字段）。

### 拿 API Key

应用详情页 → **API 访问** → 创建 API Key，记下：
- `API 基础地址`（形如 `https://api.dify.ai/v1`）
- `API Key`（`app-` 开头）

---

## 四、创建「AI 小助手」Chatflow

### 方式 A：导入 DSL

1. 顶部 → **创建应用** → **Chatflow**（或 Chatbot）
2. 名称填 `menulens-assistant`
3. 编辑器里 → **导入 DSL** → 上传 `dify-dsl/小助手-chatflow.yml`
4. 得到：开始 → 知识库检索 → 回答 → 结束

### 导入后手动做

**① 「回答」节点选 LLM 模型**（如 `openai/gpt-4o-mini`，`temperature = 0.3`）

**② 「知识库检索」节点绑定 `MenuLens 食品知识库`**，Top-K = 5，Score 阈值 = 0.4

### 测试

右上角 **预览**，问「麻婆豆腐辣不辣？」，确认回答引用了知识库内容。

### 拿 API Key

同上，**API 访问** → 创建 Key，记下地址和 Key。

---

## 五、把凭证填进小程序

打开 `miniprogram/utils/dify-config.js`，填三个值：

```js
module.exports = {
  difyDishEndpoint: 'https://api.dify.ai/v1/workflows/run',
  difyDishKey: 'app-你的识菜AppKey',

  difyChatEndpoint: 'https://api.dify.ai/v1/chat-messages',
  difyChatKey: 'app-你的小助手AppKey'
};
```

然后保护本机真实凭证不被提交：

```bash
git update-index --skip-worktree miniprogram/utils/dify-config.js
```

---

## 六、验证

1. 微信开发者工具导入 `miniprogram/` 目录
2. 「拍照识菜」页 → 拍照/选图 → 应走 Dify 视觉模型识别，展示真实菜品档案
3. 首页/识菜页/我的页右下角 → 点悬浮 ✦ 头像 → 展开 AI 小助手聊天页 → 提问 → 流式回答

---

## 常见问题

**Q：识菜结果总是降级到本地？**
检查 `dify-config.js` 三个值是否填对（不能是 `YOUR-` 占位），以及 Dify 应用是否已发布、API Key 是否有效。

**Q：小助手回答「这个我不确定」？**
说明知识库没检索到内容，检查知识库是否索引完成、检索节点是否绑定正确。

**Q：视觉模型报错？**
OpenRouter 上确认该模型支持 vision，且 Dify 里模型供应商配置正确。

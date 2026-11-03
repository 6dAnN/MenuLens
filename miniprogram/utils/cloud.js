/**
 * WorkBuddy 云服务接入层（LLM 模块）
 * ------------------------------------------------------------------
 * 本工程不接 Dify、不填任何 API Key。模型调用走 WorkBuddy 云服务的
 * 免密钥 LLM 通道，凭证就是下面这份 publicConfig（endpoint + publishableKey）。
 *
 * SDK 来源：@tencent-ai/workbuddy-cloud-sdk 的微信专用 CommonJS 产物
 * （package.json#miniprogram 入口）。为了让「导入工程即可跑」，该产物已内置为
 * utils/wb-sdk.js —— 不需要在开发者工具里额外执行「构建 npm」。
 * 想升级 SDK 时：npm install @tencent-ai/workbuddy-cloud-sdk@dev，
 * 再把 node_modules/@tencent-ai/workbuddy-cloud-sdk/miniprogram_dist/miniprogram.js
 * 覆盖到 utils/wb-sdk.js 即可。
 *
 * 安全约定：
 *   · publishableKey 只标识应用，本身不带权限，服务端会校验请求来源。
 *   · 这里绝不放任何长期服务端密钥。
 */
const store = require('./store.js');

/**
 * 云服务公开配置 —— 由开通云服务时返回的 publicConfig 原样落地。
 *
 * 配置放在 utils/cloud-config.js。该文件会入库，但仓库里保存的是占位值；
 * 本机跑通云端时把真实值填进去，再用 skip-worktree 保护它不被提交：
 *
 *   git update-index --skip-worktree miniprogram/utils/cloud-config.js
 *
 * 详见 cloud-config.js 顶部的说明。
 */
const CONFIG = require('./cloud-config.js');

const PUBLIC_CONFIG = {
  endpoint: (CONFIG && CONFIG.endpoint) || 'https://YOUR-ENDPOINT.app.workbuddy.host',
  publishableKey: (CONFIG && CONFIG.publishableKey) || 'YOUR_PUBLISHABLE_KEY'
};

let _cloud = null;
let _initErr = null;

/** 本次会话累计用量，展示在「AI 设置」页 */
const usage = {
  calls: 0,
  promptTokens: 0,
  completionTokens: 0,
  get total() { return this.promptTokens + this.completionTokens; },
  reset() {
    this.calls = 0;
    this.promptTokens = 0;
    this.completionTokens = 0;
  },
  add(u) {
    if (!u) return;
    this.calls += 1;
    this.promptTokens += u.prompt_tokens || 0;
    this.completionTokens += u.completion_tokens || 0;
  }
};

/**
 * 拿到 cloud 单例。SDK 不可用时返回 null，上层据此退回本地确定性引擎，
 * 而不是让功能直接崩掉。
 *
 * 加载顺序：内置的 utils/wb-sdk.js 优先；若被误删，退回开发者工具
 * 「构建 npm」生成的 miniprogram_npm 路径。
 */
function getCloud() {
  if (_cloud || _initErr) return _cloud;
  let sdk = null;

  try {
    sdk = require('./wb-sdk.js');
  } catch (e) {
    try {
      // eslint-disable-next-line
      sdk = require('@tencent-ai/workbuddy-cloud-sdk/miniprogram');
    } catch (e2) {
      _initErr = e2;
      console.warn('[cloud] SDK 不可用，将使用本地引擎：', e2 && e2.message);
      return null;
    }
  }

  try {
    if (!sdk || typeof sdk.createMiniProgramWorkBuddyCloud !== 'function') {
      throw new Error('SDK 导出异常：缺少 createMiniProgramWorkBuddyCloud');
    }
    // endpoint 与 publishableKey 都来自 publicConfig，缺一不可
    _cloud = sdk.createMiniProgramWorkBuddyCloud({
      endpoint: PUBLIC_CONFIG.endpoint,
      publishableKey: PUBLIC_CONFIG.publishableKey
    });
    return _cloud;
  } catch (e) {
    _initErr = e;
    console.warn('[cloud] 初始化失败，将使用本地引擎：', e && e.message);
    return null;
  }
}

/** SDK 是否可用 */
function available() {
  return !!getCloud();
}

/** 未加载到 SDK 时的可读提示 */
function notBuiltHint() {
  if (!_initErr) return null;
  return '云服务 SDK 不可用：' + ((_initErr && _initErr.message) || '未知原因') +
    '。当前使用本地引擎，功能仍完整可用。';
}

/**
 * 拉取可用模型目录。空数组是合法结果，必须显式处理，不许回退到写死的模型 id。
 */
async function listModels() {
  const cloud = getCloud();
  if (!cloud) return [];
  const models = await cloud.llm.models.list();
  return (models || []).map(m => ({
    id: m.id,
    name: m.name || m.id,
    description: m.descriptionZh || m.description || '',
    credits: m.credits || '',
    supportsImages: m.supportsImages === true,
    supportsReasoning: m.supportsReasoning === true,
    isDefault: m.isDefault === true,
    // disabled / enabled===false 一律不可选，也不能当降级目标
    selectable: m.disabled !== true && m.enabled !== false
  }));
}

/** 选一个当前可用的模型 id：优先用户设置，其次目录默认，最后第一个可选的 */
async function resolveModel() {
  const saved = store.get('aiModel');
  if (saved) return saved;

  let models = [];
  try {
    models = await listModels();
  } catch (e) {
    console.warn('[cloud] 模型目录拉取失败：', e && e.message);
  }
  if (!models.length) return null;

  const usable = models.filter(m => m.selectable);
  if (!usable.length) return null;
  const def = usable.find(m => m.isDefault) || usable[0];
  store.set('aiModel', def.id);
  return def.id;
}

/**
 * 统一的流式对话调用。
 *
 * ⚠ 云服务只支持流式（stream:true），非流式请求会在发出网络请求前
 *   就被 SDK 拒绝（request_stream_required），所以一次性任务也走流式再自行收集全文。
 *
 * @param {Object} opts
 *   system      必填，作为 messages[0]。缺 system 的请求会直接失败。
 *   messages    [{role:'user'|'assistant', content}]
 *   modelId     可选，覆盖默认模型
 *   json        true 时用 json_object 模式收集结构化输出
 *   onDelta     逐字回调（流式展示用）
 *   conversationId  可选，对话窗口要保持稳定路由时传应用自己生成并存下来的 id
 *   signal      可选，AbortController，用于中断生成
 * @returns {Promise<string>} 完整文本
 */
async function chat(opts) {
  const cloud = getCloud();
  if (!cloud) throw new Error(notBuiltHint() || '云服务不可用');

  const system = opts.system || 'You are a helpful assistant. Be concise and helpful.';
  const messages = [{ role: 'system', content: system }].concat(opts.messages || []);

  const model = opts.modelId || (await resolveModel());
  if (!model) throw new Error('没有可用模型，请在「我的 → AI 设置」里选一个');

  const body = {
    model,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.6
  };
  if (opts.conversationId) body.conversationId = opts.conversationId;
  if (opts.json) body.response_format = { type: 'json_object' };
  if (opts.signal) body.signal = opts.signal;

  let text = '';
  for await (const chunk of cloud.llm.chat.completions.create(body)) {
    const choice = chunk.choices && chunk.choices[0];
    const delta = choice && choice.delta;
    // 首帧是 role 占位，内容为空，不要当正文渲染
    if (delta && delta.content) {
      text += delta.content;
      if (opts.onDelta) opts.onDelta(delta.content);
    }
    if (chunk.usage) usage.add(chunk.usage);
  }
  return text;
}

/**
 * 一次性结构化任务：流式收集全文 → 解析 JSON。
 * 模型偶尔会在 JSON 前后带说明文字或 ```json 围栏，这里统一清洗。
 */
async function askJSON(opts) {
  const raw = await chat(Object.assign({}, opts, { json: true }));
  return parseLooseJSON(raw);
}

/** 从混杂文本里抠出 JSON（兼容 ```json 围栏、前后说明文字） */
function parseLooseJSON(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('模型返回为空');

  let candidate = text;
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidate = fence[1].trim();

  try {
    return JSON.parse(candidate);
  } catch (e) { /* 继续尝试 */ }

  // 截取最外层的 {...} 或 [...]
  const start = candidate.search(/[[{]/);
  const end = Math.max(candidate.lastIndexOf('}'), candidate.lastIndexOf(']'));
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(candidate.slice(start, end + 1));
    } catch (e2) { /* 落到下面 */ }
  }
  throw new Error('模型返回的不是合法 JSON');
}

/**
 * 错误归一化：把 CloudOpenAIError 的 error.code 翻成用户看得懂的话。
 * 只用公开的 error 字段，不碰 SDK 私有字段。
 */
function explainError(err) {
  if (!err) return '未知错误';
  const code = (err.error && err.error.code) || err.code || '';
  const msg = (err.error && err.error.message) || err.message || String(err);

  if (/^request_/.test(code)) return '模型参数不匹配：' + msg;
  if (/^auth_/.test(code)) return '云服务鉴权失败，请重新编译小程序后重试';
  if (/^quota_rate_limited/.test(code)) return '调用太频繁，请稍后再试';
  if (/^quota_/.test(code)) return '额度已用完，请稍后再试';
  if (/^model_/.test(code) || /^gateway_/.test(code)) return '模型服务暂时不可用，可重试一次';
  if (/^internal_/.test(code)) return '服务内部错误，请重试';
  if (/gateway_stream_interrupted/.test(code)) return '网络中断，生成被截断';
  return msg;
}

module.exports = {
  PUBLIC_CONFIG,
  getCloud,
  available,
  notBuiltHint,
  listModels,
  resolveModel,
  chat,
  askJSON,
  parseLooseJSON,
  explainError,
  usage
};
/**
 * Dify 服务层（识菜 Workflow + AI 小助手 Chatflow）
 * ------------------------------------------------------------------
 * 真实模型能力，走 Dify。失败自动降级到本地确定性引擎。
 * 本文件是新能力，不覆盖老的 utils/api.js（用户硬约束：旧版保留）。
 *
 * 两个接口：
 *  1. recognizeDish(imageBase64)  → 识菜 Workflow（/v1/workflows/run）
 *  2. chat(query, conversationId) → AI 小助手 Chatflow（/v1/chat-messages，SSE 流式）
 */
const cfg = require('./dify-config.backup.js');
const planner = require('./planner.js');
const dishes = require('./dishes.js');
const legacyApi = require('./api.js'); // 复用其 localReply 作为降级对话

/* 是否已配置真实凭证（占位值视为未配置） */
function isConfigured() {
  const host = (cfg.difyDishEndpoint || '');
  const key = (cfg.difyDishKey || '');
  return host.indexOf('YOUR-DIFY-HOST') < 0 && key.indexOf('YOUR_') < 0 && host && key;
}

function getDishConf() {
  return { endpoint: cfg.difyDishEndpoint, key: cfg.difyDishKey };
}

function getChatConf() {
  return { endpoint: cfg.difyChatEndpoint, key: cfg.difyChatKey };
}

/** 统一日志 */
function log(...args) {
  console.log('[MenuLens Dify]', ...args);
}

/* --------------------------------------------------------------------------
 * 1. 识菜 Workflow
 * -------------------------------------------------------------------------- */

/**
 * 调识菜 Workflow。
 * @param {string} imageBase64 不含 data: 前缀的 base64 字符串
 * @returns {Promise<Object>} 菜品档案（与 dishes.MOCK_DISH 同构）
 */
function callDishWorkflow(imageBase64) {
  const { endpoint, key } = getDishConf();
  return new Promise((resolve, reject) => {
    wx.request({
      url: endpoint,
      method: 'POST',
      timeout: 30000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      data: {
        inputs: {
          // Dify Workflow 里配置「文件」类型输入时，用 sys.files 传图；
          // 这里约定 inputs.image 为 base64，由 workflow 里的代码节点转成图片。
          image: imageBase64
        },
        response_mode: 'blocking',
        user: 'menulens_user'
      },
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.data) {
          const out = res.data.data.outputs || {};
          // 约定 workflow 输出 JSON 字符串，或直接输出对象
          const json = typeof out.result === 'string' ? JSON.parse(out.result) : out;
          resolve(json);
        } else {
          reject(new Error('识菜 Workflow 返回 ' + res.statusCode));
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '识菜请求失败'));
      }
    });
  });
}

/**
 * 拍照识菜：优先 Dify Workflow，失败降级本地。
 * @param {string} imageBase64 图片 base64（无 data: 前缀）
 * @param {Object} mockDish 降级用
 * @returns {Promise<Object>} 菜品档案
 */
async function recognizeDish(imageBase64, mockDish) {
  if (isConfigured() && imageBase64) {
    try {
      log('调用 Dify 识菜 Workflow');
      const result = await callDishWorkflow(imageBase64);
      if (result && result.name) {
        return normalizeDish(result);
      }
      log('⚠ 识菜结果缺少 name 字段，降级');
    } catch (e) {
      log('⚠ Dify 识菜失败，降级本地：', e.message);
    }
  }
  return mockDish || dishes.MOCK_DISH;
}

/** 归一化识菜结果，补齐缺失字段 */
function normalizeDish(d) {
  const db = dishes.lookupDish(d.name || '');
  return Object.assign({
    name: d.name || '未知菜品',
    en: d.name_en || d.en || db.nameEn || '',
    confidence: typeof d.confidence === 'number' ? d.confidence : 0.7,
    source: 'dify',
    cuisine: d.cuisine || db.cuisine || '家常菜',
    region: d.region || db.region || '—',
    category: d.category || db.category || '荤菜',
    flavorText: d.flavor_text || d.flavorText || db.desc || '',
    ingredients: d.ingredients || db.ingredients || [],
    methods: d.methods || db.methods || [],
    tips: d.tips || db.tips || '建议向服务员确认',
    pairWith: d.pair_with || d.pairWith || db.pairWith || [],
    allergens: d.allergens || db.allergens || [],
    spicy: typeof d.spicy === 'number' ? d.spicy : (db.spicy || 0),
    time: d.time || db.time || 20,
    difficulty: d.difficulty || db.difficulty || 1,
    servings: d.servings || db.servings || 2
  }, d);
}

/* --------------------------------------------------------------------------
 * 2. AI 小助手 Chatflow（SSE 流式）
 * -------------------------------------------------------------------------- */

/**
 * 调 Chatflow，SSE 流式返回。
 * @param {string} query 用户问题
 * @param {string} conversationId 会话 ID（多轮对话，空则新建）
 * @param {Function} onChunk 每收到一段文本回调
 * @returns {Promise<{answer:string, conversationId:string}>}
 */
function callChatflow(query, conversationId, onChunk) {
  const { endpoint, key } = getChatConf();
  return new Promise((resolve, reject) => {
    let answer = '';
    let convId = conversationId || '';
    let task = null;

    const data = {
      inputs: {},
      query,
      response_mode: 'streaming',
      user: 'menulens_user'
    };
    if (conversationId) data.conversation_id = conversationId;

    task = wx.request({
      url: endpoint,
      method: 'POST',
      timeout: 60000,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      data,
      enableChunked: true, // 开启分块传输，onChunkReceived 才会触发
      success() {
        // 流结束时，若还没 resolve 就补一次（防御：某些基础库不触发 onChunkReceived）
        if (answer) {
          resolve({ answer, conversationId: convId });
        }
      },
      fail(err) {
        reject(new Error(err.errMsg || '对话请求失败'));
      }
    });

    // 分块回调：拿到 SSE 帧
    task.onChunkReceived = (res) => {
      try {
        // res.data 可能是 ArrayBuffer
        let chunk = res.data;
        if (chunk instanceof ArrayBuffer) {
          chunk = decodeChunk(chunk);
        } else if (typeof chunk !== 'string') {
          chunk = String(chunk);
        }
        const parsed = parseSSE(chunk);
        parsed.forEach(ev => {
          if (ev.event === 'message' && ev.data) {
            try {
              const msg = JSON.parse(ev.data);
              if (msg.event === 'message' && msg.answer) {
                answer += msg.answer;
                if (onChunk) onChunk(msg.answer);
              }
              if (msg.conversation_id) convId = msg.conversation_id;
              if (msg.event === 'message_end') {
                resolve({ answer, conversationId: convId });
              }
              if (msg.event === 'error') {
                reject(new Error(msg.message || '对话出错'));
              }
            } catch (e) { /* 非 JSON 帧忽略 */ }
          }
        });
      } catch (e) {
        log('chunk 解析异常', e.message);
      }
    };
  });
}

/** ArrayBuffer → 字符串（UTF-8，逐字节解码，兼容中文） */
function decodeChunk(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    let cp, len;
    if (b < 0x80) { cp = b; len = 1; }
    else if ((b & 0xe0) === 0xc0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); len = 2; }
    else if ((b & 0xf0) === 0xe0) { cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f); len = 3; }
    else if ((b & 0xf8) === 0xf0) { cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f); len = 4; }
    else { cp = 0xfffd; len = 1; }
    s += String.fromCodePoint(cp);
    i += len;
  }
  return s;
}

/** 解析 SSE 文本流，按空行切帧 */
function parseSSE(text) {
  const events = [];
  const lines = text.split(/\r?\n/);
  let current = {};
  for (const line of lines) {
    if (line === '') {
      if (current.event || current.data !== undefined) {
        events.push(current);
      }
      current = {};
      continue;
    }
    if (line.startsWith('event:')) {
      current.event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      current.data = (current.data || '') + line.slice(5).trim();
    }
  }
  if (current.event || current.data !== undefined) events.push(current);
  return events;
}

/**
 * AI 小助手对话入口：优先 Dify Chatflow，失败降级本地 Agent。
 * @param {string} text 用户输入
 * @param {Object} ctx 点单上下文
 * @param {Object} plan 当前方案
 * @param {Array} items 当前菜单
 * @param {string} conversationId 会话 ID
 * @param {Function} onChunk 流式回调
 * @returns {Promise<Object>} { text, remote, conversationId, ... }
 */
async function chat(text, ctx, plan, items, conversationId, onChunk) {
  if (isConfigured()) {
    try {
      log('调用 Dify 小助手 Chatflow');
      const r = await callChatflow(text, conversationId, onChunk);
      if (r && r.answer && r.answer.trim()) {
        return { text: r.answer, remote: true, conversationId: r.conversationId };
      }
      log('⚠ 小助手返回空，降级本地');
    } catch (e) {
      log('⚠ Dify 小助手失败，降级本地：', e.message);
    }
  }
  const local = legacyApi.localReply(text, ctx, plan, items) || {};
  return Object.assign({ remote: false, conversationId: conversationId || '' }, local);
}

module.exports = {
  isConfigured, getDishConf, getChatConf,
  recognizeDish, chat,
  callDishWorkflow, callChatflow, normalizeDish,
  parseSSE, decodeChunk
};

/**
 * API 服务层
 * 优先调用 Dify Workflow；未配置或失败时自动降级到本地引擎。
 * 这样 demo 在没有后端的情况下也能完整跑通（PRD §8.2 的降级策略）。
 *
 * 配置位置：app.js → globalData.config
 *   difyEndpoint: Dify 应用 API 地址（形如 https://api.dify.ai/v1/workflows/run）
 *   difyKey:      Dify App API Key
 * 生产环境请把 key 放云函数，前端只留 endpoint。
 */
const planner = require('./planner.js');
const dishes = require('./dishes.js');

const config = {
  difyEndpoint: '',
  difyKey: '',
  timeout: 20000,
  /** 是否打印降级日志 */
  verbose: true
};

function configure(cfg) {
  Object.assign(config, cfg || {});
}

/** 统一日志 */
function log(...args) {
  if (config.verbose) console.log('[MenuLens API]', ...args);
}

/** 是否已配置真实服务 */
function hasRemote() {
  return !!(config.difyEndpoint && config.difyKey);
}

/**
 * 调Dify Workflow
 * @param {string} userInput 传给 workflow 的 query
 * @returns {Promise<string>} 纯文本输出
 */
function callDify(userInput) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: config.difyEndpoint,
      method: 'POST',
      timeout: config.timeout,
      header: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + config.difyKey
      },
      data: { inputs: {}, query: userInput, response_mode: 'blocking', user: 'mini_program_user' },
      success(res) {
        if (res.statusCode === 200 && res.data && res.data.data) {
          resolve(res.data.data.outputs ? (res.data.data.outputs.text || '') : '');
        } else {
          reject(new Error('Dify status ' + res.statusCode));
        }
      },
      fail(err) { reject(new Error(err.errMsg || 'network fail')); }
    });
  });
}

/**
 * 菜单识别（WF-1）
 * @returns {Promise<Object>}
 */
async function parseMenu(imagePath, rawMenu) {
  if (hasRemote()) {
    try {
      log('调用 Dify: menu-parse');
      const text = await callDify('请识别这张菜单图片，输出 JSON：' + JSON.stringify({ image: imagePath }));
      const json = JSON.parse(text);
      return planner.parseMenu(json);
    } catch (e) {
      log('⚠ Dify 菜单识别失败，降级本地：', e.message);
    }
  }
  // 演示/离线：上传的图不参与识别，返回预置菜单
  return planner.parseMenu(rawMenu || dishes.MOCK_MENU);
}

/**
 * 点单方案（WF-2）
 */
async function generatePlan(ctx, items) {
  if (hasRemote()) {
    try {
      log('调用 Dify: order-plan');
      const text = await callDify(JSON.stringify({
        task: 'order-plan', context: ctx, menu: items
      }));
      const json = JSON.parse(text);
      if (json && json.grouped) {
        return Object.assign({}, json, { remote: true });
      }
    } catch (e) {
      log('⚠ Dify 方案生成失败，降级本地：', e.message);
    }
  }
  return planner.generatePlan(ctx, items);
}

/**
 * 拍照识菜（WF-3）
 */
async function recognizeDish(imagePath, mockDish) {
  if (hasRemote()) {
    try {
      log('调用 Dify: dish-detail');
      const text = await callDify('识别这道菜并返回 JSON：' + JSON.stringify({ image: imagePath }));
      return JSON.parse(text);
    } catch (e) {
      log('⚠ Dify 识菜失败，降级本地：', e.message);
    }
  }
  return mockDish || dishes.MOCK_DISH;
}

/**
 * 菜谱生成（WF-4）
 */
async function generateRecipe(input, mockRecipes) {
  if (hasRemote()) {
    try {
      log('调用 Dify: recipe-gen');
      const text = await callDify(JSON.stringify({ task: 'recipe', input: input }));
      return JSON.parse(text);
    } catch (e) {
      log('⚠ Dify 菜谱生成失败，降级本地：', e.message);
    }
  }
  return mockRecipes || dishes.MOCK_RECIPES;
}

/* --------------------------------------------------------------------------
   Agent 对话：意图识别 + 约束解析（本地实现，PRD §8.4）
   -------------------------------------------------------------------------- */

const INTENT_RULES = [
  { intent: 'constraint', test: t => /不吃|不要|别|少|加点|去掉|换成|改成/.test(t) && /辣|预算|钱|人均|人吃|人数|香菜|花生|海鲜|清淡|素|肉|口味|贵|便宜/.test(t) },
  { intent: 'recipe', test: t => /怎么做|做法|食谱|菜谱|复刻|学做|在家做/.test(t) },
  { intent: 'explain', test: t => /为什么|凭什么|推荐理由|咋选|有什么区别/.test(t) },
  { intent: 'swap', test: t => /换一道|换一个|不好吃|不要这道|太贵/.test(t) },
  { intent: 'allergy', test: t => /过敏|能不能吃|忌口|安全|糖尿病|痛风/.test(t) },
  { intent: 'ingredient', test: t => /什么菜|有哪些菜|推荐|好吃|招牌/.test(t) }
];

function detectIntent(text) {
  for (const r of INTENT_RULES) if (r.test(text)) return r.intent;
  return 'unknown';
}

/** 越权指令检测（硬性规则，不可绕过） */
function isJailbreak(text) {
  const t = String(text || '');
  return /忽略(以上|之前|前面|上面|掉)|无视(之前|以上|前面|规则|指令)/
    .test(t) ||
    /输出(你的)?(提示词|prompt|系统|system|初始指令)|(显示|打印|复述|告诉我)(你的)?(提示词|prompt|系统提示)/
    .test(t) ||
    /你现在(是|扮演|作为)|扮演(一个|任何)|开发者模式|developer\s*mode|越狱|jailbreak|无视规则/i
    .test(t);
}

/** 从文本解析约束修改 */
function parseConstraintPatch(text, ctx) {
  const patch = {};
  const t = String(text).toLowerCase();

  const avoidMap = {
    香菜: '香菜', 花生: '花生', 海鲜: '海鲜', 牛肉: '牛肉', 猪肉: '猪肉',
    辣: '辣', 奶: '乳制品', 面筋: '麸质', 蛋: '蛋', 大豆: '大豆'
  };
  const found = Object.keys(avoidMap).filter(k => t.indexOf(k) >= 0);
  if (found.length) {
    patch.avoid = Array.from(new Set((ctx.avoid || []).concat(found)));
  }

  const bm = text.match(/(\d{2,5})\s*(?:元|块|rmb|¥)?/);
  if (bm && /预算|人均|块|元|rmb|¥|价|钱/.test(text)) {
    patch.budget = Math.min(5000, parseInt(bm[1], 10));
  }
  const sm = text.match(/(\d+)\s*(?:个人|人份|人吃|人)/);
  if (sm && /人/.test(text)) {
    patch.servings = Math.min(20, Math.max(1, parseInt(sm[1], 10)));
  }
  if (/不要辣|不辣|别辣/.test(t)) patch.spiceLevel = 'none';
  else if (/少辣|微辣|不太辣|清淡点/.test(t)) patch.spiceLevel = 'mild';
  else if (/中辣/.test(t)) patch.spiceLevel = 'medium';
  else if (/特辣|超辣|重辣|多辣/.test(t)) patch.spiceLevel = 'hot';

  return patch;
}

/** 本地 Agent 回复 */
function localReply(text, ctx, plan, items) {
  const intent = detectIntent(text);

  if (intent === 'constraint') {
    const patch = parseConstraintPatch(text, ctx);
    if (!Object.keys(patch).length) {
      return { text: '好的，你想调整什么？比如「不吃香菜」「预算 300」「3 个人吃」。' };
    }
    const changes = [];
    if (patch.avoid) {
      const added = patch.avoid.filter(a => (ctx.avoid || []).indexOf(a) < 0);
      if (added.length) changes.push('忌口 +' + added.join('、'));
    }
    if (patch.budget) changes.push('预算 ¥' + patch.budget);
    if (patch.servings) changes.push('人数 ' + patch.servings + ' 人');
    if (patch.spiceLevel) changes.push('辣度 ' + { none: '不辣', mild: '微辣', medium: '中辣', hot: '重辣' }[patch.spiceLevel]);
    return { text: '已更新：' + changes.join(' · ') + '。正在按新条件重新搭配…', patch: patch, replan: true };
  }

  if (intent === 'recipe') {
    const m = text.match(/([\u4e00-\u9fa5]{2,6})\s*(?:的)?(?:怎么做|做法|食谱)/);
    const target = m ? m[1] : '白切鸡';
    return { text: '「' + target + '」的做法已经在下面啦', recipe: target };
  }

  if (intent === 'swap') return { text: '好，我换一道，换成同价位里匹配度更高的选项', swap: true };

  if (intent === 'allergy') {
    return {
      text: '已按你的忌口「' + (ctx.avoid || []).join('、') + '」做了硬过滤：这些成分的菜一道都不会出现在方案里。\n\n不过要提醒一句——过敏原信息来自菜单识别，可能有漏。建议点单时跟服务员再确认一次。'
    };
  }

  if (intent === 'explain') {
    if (!plan || !plan.ok) return { text: '你先扫一份菜单，我就能告诉你每道菜为什么这么推荐了。' };
    const keys = Object.keys(plan.grouped);
    if (!keys.length) return { text: '方案还没生成，先点一下「生成点单方案」吧。' };
    const first = plan.grouped[keys[0]][0];
    return {
      text: '「' + first.name + '」被选中，主要三个原因：\n\n1. 定位对——它是' + first.role + '，在你的 ' + ctx.servings + ' 人预算 ¥' + ctx.budget + ' 里属于核心投入。\n2. 口味对——' + (dishes.lookupDish(first.name).desc || '') + '\n3. 搭配好——它和这桌其他菜在味型上错开，吃起来不腻。\n\n每道菜我都会给一句具体的理由，不会只说「推荐你点」。'
    };
  }

  if (intent === 'ingredient') {
    const cat = text.indexOf('素') >= 0 ? '素菜' : (text.indexOf('汤') >= 0 ? '汤' : null);
    const found = (items || []).filter(x => !cat || x.category === cat).slice(0, 5);
    if (!found.length) return { text: '这份菜单里没找到符合条件的菜。换一家试试？' };
    return {
      text: (cat ? '这份菜单的' + cat + '有这些：\n\n' : '这份菜单里比较值得点的：\n\n') +
        found.map(x => '· ' + x.name + ' ¥' + x.price).join('\n') +
        '\n\n想让我配一桌的话，说一声「帮我搭配」。'
    };
  }

  if (/帮我搭配|推荐一桌|点什么/.test(text)) {
    return { text: '好，我按你现在的条件配一桌', replan: true };
  }

  return {
    text: '我可以帮你做三件事：\n\n① 扫菜单 → 识别菜品并配一桌（预算/人数/忌口都能说）\n② 拍照识菜 → 问做法、来源、搭配\n③ 生成菜谱 → 用你现有的食材\n\n你想从哪个开始？'
  };
}

/**
 * Agent 对话入口：优先 Dify Agent，失败降级本地
 */
async function chat(text, ctx, plan, items) {
  if (hasRemote()) {
    try {
      log('调用 Dify Agent');
      const raw = await callDify(text);
      if (raw && raw.trim()) return { text: raw, remote: true };
    } catch (e) {
      log('⚠ Dify Agent 失败，降级本地：', e.message);
    }
  }
  return localReply(text, ctx, plan, items);
}

module.exports = {
  configure, hasRemote,
  parseMenu, generatePlan, recognizeDish, generateRecipe, chat,
  detectIntent, isJailbreak, parseConstraintPatch, localReply
};
/* ==========================================================================
   MenuLens · AI 引擎（本地推理 + 可切换真实大模型）
   ------------------------------------------------------------------
   本模块封装了 PRD §8 描述的 Agent 行为：
     · Workflow：菜单解析 / 点单方案 / 菜品详情 / 菜谱生成（确定性）
     · Agent：意图识别 + 约束修改 + 菜品问答（多轮）
   默认运行在本地确定性推理上（离线可用、演示稳定）；
   若 config.apiEndpoint 填入真实服务（Dify Workflow / 云端 LLM），
   会自动切到真实模型并保留本地兜底。
   ========================================================================== */

var MenuLensAI = (function () {

var DISH_DB = window.MenuLensData.DISH_DB;
var MOCK_MENU = window.MenuLensData.MOCK_MENU;
var MOCK_DISH = window.MenuLensData.MOCK_DISH;
var MOCK_RECIPES = window.MenuLensData.MOCK_RECIPES;
var lookupDish = window.MenuLensData.lookupDish;
var ALLERGENS = window.MenuLensData.ALLERGENS;

/**
 * 本地知识库检索（与微信小程序端算法同源，见 tools/build-demo-kb.js）。
 * kb.js 不存在时降级为空检索——H5 仍能跑，只是回答不带知识库依据。
 */
var KB = (typeof window !== 'undefined' && window.MenuLensKB) || null;

const config = {
  /** 真实服务地址。留空 = 本地确定性推理。 */
  apiEndpoint: '',
  /** 模型标识（接入云端通道时使用） */
  model: 'local-deterministic',
  /** 超时毫秒 */
  timeout: 20000
};

/* --------------------------------------------------------------------------
   1. 工具层：工具 = PRD §8.4 定义的 Function Calling 接口
   -------------------------------------------------------------------------- */

const tools = {
  searchDishes(query, menuItems, opts = {}) {
    const q = (query || '').toLowerCase();
    let list = menuItems.filter(it => {
      const inCat = !opts.category || it.category === opts.category;
      const inPrice = !opts.maxPrice || it.price <= opts.maxPrice;
      const inQuery = !q || it.name.toLowerCase().includes(q) || (it.en || '').toLowerCase().includes(q);
      return inCat && inPrice && inQuery;
    });
    // 置信度低的排后
    list = list.slice().sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    return list.slice(0, opts.limit || 8);
  },

  getDishDetail(name) {
    return lookupDish(name);
  },

  updateOrderContext(ctx, field, value) {
    ctx[field] = value;
    return ctx;
  },

  regeneratePlan() { return 'replan'; },

  getRecipe(nameOrIngredients) {
    if (Array.isArray(nameOrIngredients)) return MOCK_RECIPES;
    const r = MOCK_RECIPES.find(x => x.name.includes(nameOrIngredients));
    return r || MOCK_RECIPES[0];
  }
};

/* --------------------------------------------------------------------------
   2. 硬约束过滤：忌口/过敏原一律剔除（PRD §8.3 节点2，不可绕过）
   -------------------------------------------------------------------------- */

function hardFilter(menuItems, ctx) {
  const avoid = (ctx.avoid || []).map(x => x.toLowerCase());
  const allergenSeverity = ctx.allergenSeverity || {};
  const strictAllergens = Object.keys(allergenSeverity)
    .filter(k => allergenSeverity[k] === 'allergy').map(k => k.toLowerCase());

  const kept = [], excluded = [];

  for (const it of menuItems) {
    const d = lookupDish(it.name);
    const hay = [it.name, it.desc || '', (d.ingredients || []).join(' '), (d.methods || []).join(' ')].join(' ').toLowerCase();

    // 过敏原：以菜品本体 allergens 字段为准，不能靠配料文本里是否出现
    // 「蛋」来判断（白切鸡标注含蛋，配料写的是「三黄鸡」）
    const hitAllergen = (d.allergens || []).find(a => strictAllergens.includes(String(a).toLowerCase()));
    if (hitAllergen) {
      excluded.push({ ...it, _reason: `含过敏原「${hitAllergen}」` });
      continue;
    }

    // 忌口：关键词匹配
    const hitAvoid = avoid.find(a => {
      const map = { 香菜: '芫荽', 海鲜: '鱼', 辣: '椒', 牛肉: '牛', 猪肉: '猪', 花生: '花生', 蛋: '蛋', 大豆: '酱' };
      return hay.includes(a) || (map[a] && hay.includes(map[a]));
    });
    if (hitAvoid) {
      excluded.push({ ...it, _reason: `含「${hitAvoid}」` });
      continue;
    }

    kept.push(it);
  }
  return { kept, excluded };
}

/* --------------------------------------------------------------------------
   3. WF-2 order-plan：点单方案生成
   排序分 = 预算适配×0.35 + 口味匹配×0.3 + 类别多样性×0.2 + 招牌×0.15
   -------------------------------------------------------------------------- */

function scoreDish(item, ctx, allItems) {
  const d = lookupDish(item.name);
  let score = 0;

  // 预算适配：菜品价格占人均预算比例越接近 1/3 越合理
  const perHead = ctx.budget / Math.max(ctx.servings, 1);
  const ratio = item.price / Math.max(perHead, 1);
  const budgetFit = ratio <= 0.5 ? 1 : ratio <= 0.45 ? 0.8 : 0.5;
  score += budgetFit * 0.35;

  // 口味匹配
  let tasteFit = 0.6;
  const sp = item.price && d.spicy || 0;
  if (ctx.spiceLevel === 'none') tasteFit = sp === 0 ? 1 : 0.2;
  else if (ctx.spiceLevel === 'mild') tasteFit = sp <= 0.3 ? 1 : 0.5;
  else if (ctx.spiceLevel === 'medium') tasteFit = sp >= 0.2 && sp <= 0.8 ? 1 : 0.6;
  else if (ctx.spiceLevel === 'hot') tasteFit = sp >= 0.7 ? 1 : 0.4;
  score += tasteFit * 0.3;

  // 类别多样性：菜系里这道菜占比越低越好
  const sameCat = allItems.filter(x => x.category === item.category).length;
  score += (1 - sameCat / Math.max(allItems.length, 1)) * 0.2;

  // 招牌/置信度高
  score += (item.confidence || 0.6) * 0.15;

  return score;
}

function pickReason(item, ctx) {
  const d = lookupDish(item.name);
  const perHead = ctx.budget / Math.max(ctx.servings, 1);
  const reasons = [];

  if (item.price >= perHead * 0.4 && item.price <= perHead * 0.6) {
    reasons.push(`${item.name}是这道菜里的招牌，${d.desc}`);
  } else if (item.price < perHead * 0.35) {
    reasons.push(`${d.desc}，性价比高，压低整桌单价`);
  } else {
    reasons.push(d.desc);
  }
  return reasons[0];
}

function generatePlan(ctx, menuItems = MOCK_MENU.items) {
  const steps = [];
  const { kept, excluded } = hardFilter(menuItems, ctx);

  steps.push({ text: `过滤忌口与过敏原，剩余 ${kept.length} 道`, state: 'done' });
  if (excluded.length) steps.push({ text: `已排除 ${excluded.length} 道：${excluded.slice(0, 2).map(e => e.name).join('、')}`, state: 'done' });

  if (kept.length === 0) {
    return {
      ok: false, steps, excluded,
      emptyReason: '菜单里所有菜品都涉及你的忌口了，建议换一家，或让服务员推荐两道不冲突的菜。'
    };
  }

  // 预算预筛：单价超过人均预算一半的先降权
  const perHead = ctx.budget / Math.max(ctx.servings, 1);
  let candidates = kept.slice().sort((a, b) => scoreDish(b, ctx, kept) - scoreDish(a, ctx, kept));
  steps.push({ text: `按预算 ¥${ctx.budget} / ${ctx.servings} 人排序`, state: 'done' });

  // 目标道数：人数 * 1.3，荤素搭配
  const targetCount = Math.max(2, Math.min(Math.round(ctx.servings * 1.3), kept.length));
  let chosen = [];
  let total = 0;
  let adjusted = null;

  // 先保证荤素搭配：交替选
  const mains = candidates.filter(c => c.category === '荤菜' || c.category === '主食' || c.category === '凉菜');
  const vegs = candidates.filter(c => c.category === '素菜');
  const soups = candidates.filter(c => c.category === '汤' || c.category === '甜品');

  let mi = 0, vi = 0, si = 0;
  while (chosen.length < targetCount) {
    let pick = null;
    const mainsChosen = chosen.filter(c => ['荤菜', '主食', '凉菜'].includes(c.category)).length;
    const vegChosen = chosen.filter(c => c.category === '素菜').length;

    if (mains.length && mainsChosen < Math.ceil(targetCount * 0.62)) {
      pick = mains[mi++];
    } else if (vegs.length && vegChosen < Math.ceil(targetCount * 0.28)) {
      pick = vegs[vi++];
    } else {
      const pools = [mains, vegs, soups].filter(p => p.length);
      if (!pools.length) break;
      pick = pools.reduce((a, b) => (a.length ? a : b))[si++ % pools[0].length] || null;
      if (!pick) break;
    }
    if (!pick) break;
    if (chosen.includes(pick)) { si++; if (si > 20) break; continue; }
    if (total + pick.price > ctx.budget && chosen.length > 0) { si++; continue; }
    chosen.push(pick);
    total += pick.price;
    if (chosen.length >= targetCount) break;
  }

  // 预算兜底：若一道都加不进来
  if (chosen.length === 0) {
    chosen = [candidates[0]];
    total = candidates[0].price;
    adjusted = '预算偏紧，先推荐了这道招牌菜';
  }

  // 预算校验（节点6）：超预算则裁剪最贵
  while (total > ctx.budget && chosen.length > 1) {
    const idx = chosen.reduce((mx, c, i) => c.price > chosen[mx].price ? i : mx, 0);
    total -= chosen[idx].price;
    chosen.splice(idx, 1);
    adjusted = `为控制在预算内，去掉了较贵的「${candidates[0].name}」`;
  }

  steps.push({ text: total <= ctx.budget ? `预算校验通过 ¥${total}` : `预算已用尽 ¥${total}`, state: 'done' });

  // 份量校验
  const servings = chosen.reduce((s, c) => s + (lookupDish(c.name).servings || 0.7), 0);
  steps.push({ text: `份量估算 ${servings.toFixed(1)} 人份 / ${ctx.servings} 人`, state: 'done' });

  // 分组
  const order = { 荤菜: 0, 主食: 1, 凉菜: 2, 素菜: 3, 汤: 4, 甜品: 5 };
  chosen.sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9));

  const grouped = {};
  for (const c of chosen) {
    if (!grouped[c.category]) grouped[c.category] = [];
    grouped[c.category].push({
      key: c.key, name: c.name, price: c.price, en: c.en, desc: c.desc,
      category: c.category,
      role: lookupDish(c.name).role || c.category,
      reason: pickReason(c, ctx)
    });
  }

  // 冲突警告
  const warnings = [];
  for (const c of chosen) {
    const d = lookupDish(c.name);
    for (const a of (d.allergens || [])) {
      if ((ctx.avoid || []).includes(a)) warnings.push(`${c.name} 提到含「${a}」，请向服务员再确认一次`);
    }
  }
  if (ctx.budget < ctx.servings * 25) warnings.push('预算偏紧，菜品可能不够放开吃');
  if (servings < ctx.servings * 0.8) warnings.push(`菜单菜品较少，已按全部推荐（${servings.toFixed(1)} 人份）`);

  return {
    ok: true, steps, excluded, adjusted,
    total, perHead: total / ctx.servings, servings,
    grouped, warnings,
    dishCount: chosen.length
  };
}

/* --------------------------------------------------------------------------
   4. WF-1 menu-parse：模拟菜单解析（含置信度计算，PRD §7.3）
   -------------------------------------------------------------------------- */

function parseMenu() {
  return {
    meta: MOCK_MENU.meta,
    items: MOCK_MENU.items.map(it => {
      const d = lookupDish(it.name);
      const conf = computeConfidence(it);
      return {
        ...it, confidence: conf, allergens: d.allergens, spicy: d.spicy,
        flavor: d.flavor, uncertain: conf < 0.5, needsConfirm: conf < 0.8
      };
    })
  };
}

function computeConfidence(item) {
  // 视觉置信度（模拟）
  const vision = item.confidence > 0.7 ? item.confidence * 0.98 : item.confidence;
  // 知识库匹配置信度：有详情=0.95，无=0.3
  const hasKB = !!DISH_DB[item.name];
  const kb = hasKB ? 0.95 : 0.35;
  // OCR 加成：描述里出现具体描述词 = 命中
  const ocrBonus = item.desc && item.desc.length > 5 ? 0.1 : 0;

  let conf = vision * 0.6 + kb * 0.3 + ocrBonus;
  if (ocrBonus === 0) conf = conf * 0.95;
  return Math.min(0.99, Math.max(0.05, conf));
}

/* --------------------------------------------------------------------------
   5. Agent：意图识别 + 多轮对话（PRD §8.4）
   -------------------------------------------------------------------------- */

const INTENT_RULES = [
  {
    intent: 'constraint',
    test: t => {
      const hasVerb = /不吃|不要|别|少|加点|去掉|换成|改成|不要辣|不要太辣/.test(t);
      const hasField = /辣|预算|钱|人均|人吃|人数|香菜|花生|海鲜|清淡|素|肉|口味|贵|便宜/.test(t);
      return hasVerb && hasField;
    }
  },
  { intent: 'recipe', test: t => /怎么做|做法|食谱|菜谱|复刻|学做|在家做/.test(t) },
  { intent: 'explain', test: t => /为什么|凭什么|推荐理由|咋选|有什么区别/.test(t) },
  { intent: 'swap', test: t => /换一道|换一个|不好吃|不要这道|太贵|再来一道/.test(t) },
  { intent: 'allergy', test: t => /过敏|能不能吃|忌口|安全|糖尿病|痛风/.test(t) },
  { intent: 'ingredient', test: t => /什么菜|有哪些菜|推荐|好吃|招牌/.test(t) },
  { intent: 'chitchat', test: t => /^(你好|hi|hello|在吗|谢谢|哈哈)+$/i.test(t.trim()) }
];

function detectIntent(text) {
  for (const r of INTENT_RULES) if (r.test(text)) return r.intent;
  return 'unknown';
}

/** 越权指令检测（硬性规则，PRD §8.4） */
function isJailbreak(text) {
  const t = String(text || '');
  return /忽略(以上|之前|前面|上面|掉)|无视(之前|以上|前面|规则|指令)/.test(t)
    || /输出(你的)?(提示词|prompt|系统|system|初始指令)|(显示|打印|复述|告诉我)(你的)?(提示词|prompt|系统提示)/.test(t)
    || /你现在(是|扮演|作为)|扮演(一个|任何)|开发者模式|developer\s*mode|越狱|jailbreak|无视规则/i.test(t);
}

/** 超纲检测 */
function isOffTopic(text) {
  return /(股票|基金|汇率|天气|新闻|写个?诗|代码|编程|翻译成英文单词)/.test(text);
}

/** 从文本解析约束修改 → 返回 patch 对象 */
function parseConstraintPatch(text, ctx) {
  const patch = {};
  const t = text.toLowerCase();

  // 忌口
  const avoidMap = {
    香菜: '香菜', 花生: '花生', 海鲜: '海鲜', 牛肉: '牛肉', 猪肉: '猪肉',
    辣: '辣', 奶: '乳制品', 乳制品: '乳制品', 面筋: '麸质', 蛋: '蛋', 大豆: '大豆'
  };
  const found = Object.keys(avoidMap).filter(k => t.includes(k));
  if (found.length) {
    patch.avoid = Array.from(new Set([...(ctx.avoid || []), ...found]));
  }

  // 预算
  const bm = text.match(/(?:预算|人均|总价)?\s*(\d{2,5})\s*(?:元|块|rmb|¥)?/);
  if (bm && /预算|人均|块|元|rmb|¥|价|钱/.test(text)) {
    patch.budget = Math.min(5000, parseInt(bm[1], 10));
  }

  // 人数
  const sm = text.match(/(\d+)\s*(?:个人|人份|人吃|人)/);
  if (sm && /人/.test(text)) patch.servings = Math.min(20, Math.max(1, parseInt(sm[1], 10)));

  // 辣度
  if (/不要辣|不辣|不辣了|别辣/.test(t)) patch.spiceLevel = 'none';
  else if (/少辣|微辣|不太辣|清淡点/.test(t)) patch.spiceLevel = 'mild';
  else if (/中辣/.test(t)) patch.spiceLevel = 'medium';
  else if (/特辣|超辣|重辣|多辣/.test(t)) patch.spiceLevel = 'hot';
  else if (/清淡|素一点|少油/.test(t)) patch.spiceLevel = 'mild';

  return patch;
}

/**
 * 用本地知识库回答一道菜 / 一个主题的问题。
 *
 * 为什么不直接套模板：用户问「宫保鸡丁含花生吗」，模板只能回「含」；
 * 而知识库里有菜系、食材、过敏原、风味、吃法，能拼出一段真正有用的回答。
 * 这里把检索到的 chunk 的 markdown 表格解析成字段，再按问法挑重点。
 *
 * @returns {{text:string, hits:Array}|null} 没有检索结果时返回 null，交给原逻辑兜底
 */
function kbAnswer(text) {
  if (!KB) return null;
  const hits = KB.search(text, 3);
  if (!hits.length) return null;

  const top = hits[0];
  const fields = parseKbFields(top.text);
  const isDish = top.source && /^菜品知识库/.test(top.source);
  const lines = [];

  if (isDish) {
    const tag = [fields['菜系'], fields['类别'], fields['定位']].filter(Boolean).join(' · ');
    lines.push('**' + top.title + '**' + (tag ? '　' + tag : '') + '　' + (fields['参考价格'] || ''));
    if (fields['主要食材']) lines.push('主要食材：' + fields['主要食材']);

    // 按问法挑重点：问过敏原就先把过敏原顶上去，别让用户自己找。
    // 「含花生吗」「有没有花生」这类问法也要认，不能只认「过敏」两个字。
    const q = text;
    const askingAllergen = /过敏|忌口|不能吃|安全|含|有.*吗|有没有|哪些成分/.test(q);
    if (askingAllergen && fields['过敏原']) {
      lines.push('过敏原：' + fields['过敏原'] + '（来自菜品本体标注，不是配料文本推测）');
    }
    if (/辣|口味|什么味|好吃/.test(q)) {
      if (fields['辣度']) lines.push('辣度：' + fields['辣度'] + ' / 3 档');
      if (fields['风味']) lines.push('风味：' + fields['风味']);
    }
    if (/怎么做|做法|复刻|在家/.test(q)) {
      if (fields['烹饪方式']) lines.push('烹饪方式：' + fields['烹饪方式']);
      if (fields['耗时']) lines.push('耗时：' + fields['耗时']);
    }

    // 描述段落是「怎么认、什么味」，放最后当补充
    const desc = top.text.split('\n\n').pop();
    if (desc && desc.length > 10 && desc.indexOf('|') < 0) {
      lines.push('');
      lines.push(desc);
    }

    if (hits.length > 1) {
      lines.push('');
      lines.push('相关资料：' + hits.slice(1).map(h => '「' + h.title + '」').join('、'));
    }
    return { text: lines.join('\n'), hits };
  }

  // 主题型条目（人群建议 / 过敏原表 / 点单原则）：正文本身就是答案。
  // 但「营养成分与人群建议」是一张六行大表，整块贴出来用户要自己找行——
  // 所以先按问句里的人群词把相关行提出来，再附完整表格。
  lines.push('**' + top.title + '**');
  lines.push('');
  const focused = focusRow(text, top.text);
  if (focused) {
    lines.push(focused);
    lines.push('');
    lines.push('完整对照表：');
  }
  lines.push(top.text);
  if (hits.length > 1) {
    lines.push('');
    lines.push('另外还查到了：' + hits.slice(1).map(h => '「' + h.title + '」').join('、'));
  }
  return { text: lines.join('\n'), hits };
}

/**
 * 从 markdown 表格里挑出与问句人群/条件相关的那一行。
 * 例：「孕妇能吃生鱼片吗」→ 命中「孕妇」那行，转成一句话。
 */
function focusRow(query, tableText) {
  const ROWS = {
    孕妇: /孕妇|怀孕|备孕|哺乳/,
    儿童: /儿童|小孩|孩子|宝宝|娃/,
    三高: /三高|血压|血脂|血糖|糖尿病/,
    痛风: /痛风|尿酸/,
    减脂期: /减脂|减肥|低卡|瘦身/,
    素食者: /素食|吃素/
  };
  const key = Object.keys(ROWS).find(k => ROWS[k].test(query));
  if (!key) return '';

  const lines = String(tableText || '').split('\n');
  const row = lines.find(l => l.indexOf('| ' + key) >= 0 || l.indexOf('|' + key) >= 0);
  if (!row) return '';
  const cells = row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  if (cells.length < 3) return '';

  const out = ['**' + (cells[0] || key) + '**'];
  if (cells[1]) out.push('可以点：' + cells[1]);
  if (cells[2]) out.push('要避开：' + cells[2]);
  if (cells[3]) out.push('原因：' + cells[3]);
  return out.join('\n');
}

/** 把知识库 chunk 的 markdown 字段表解析成对象 */
function parseKbFields(text) {
  const out = {};
  String(text || '').split('\n').forEach(line => {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/);
    if (m && m[1] !== '字段' && !/^-+$/.test(m[1])) out[m[1]] = m[2];
  });
  return out;
}

/** Agent 生成回复文本 */
function agentReply(text, ctx, plan, menuItems) {
  const intent = detectIntent(text);

  // 知识库优先：能答上来的事实类问题不该走模板。
  // 约束修改 / 换菜 / 重新配桌这些「动作」必须先于知识库处理，
  // 否则用户说「不吃辣」会被当成在问辣度。
  const ACTION = { constraint: 1, swap: 1, recipe: 1 };
  if (!ACTION[intent]) {
    const kb = kbAnswer(text);
    if (kb) return { text: kb.text, hits: kb.hits, kb: true };
  }

  switch (intent) {
    case 'constraint': {
      const patch = parseConstraintPatch(text, ctx);
      if (!Object.keys(patch).length) return { text: '好的，你想调整什么？比如「不吃香菜」「预算 300」「3 个人吃」。', patch: null };
      const changes = [];
      if (patch.avoid) {
        const added = patch.avoid.filter(a => !(ctx.avoid || []).includes(a));
        if (added.length) changes.push(`忌口 +${added.join('、')}`);
      }
      if (patch.budget) changes.push(`预算 ¥${patch.budget}`);
      if (patch.servings) changes.push(`人数 ${patch.servings} 人`);
      if (patch.spiceLevel) changes.push(`辣度 ${{ none: '不辣', mild: '微辣', medium: '中辣', hot: '重辣' }[patch.spiceLevel]}`);
      return {
        text: `已更新：${changes.join(' · ')}。正在按新条件重新搭配…`,
        patch, replan: true
      };
    }

    case 'recipe': {
      const nameMatch = text.match(/([\u4e00-\u9fa5]{2,6})\s*(?:的)?(?:怎么做|做法|食谱)/);
      // 知识库里有这道菜时，先把「烹饪方式 / 耗时 / 关键点」说出来，
      // 再引导去底部看完整步骤——比只说「做法在下面」有信息量。
      const kb = nameMatch ? kbAnswer(nameMatch[1]) : null;
      if (kb) {
        const f = parseKbFields(kb.hits[0].text);
        const bits = [];
        if (f['烹饪方式']) bits.push('方式：' + f['烹饪方式']);
        if (f['耗时']) bits.push('耗时：' + f['耗时']);
        if (f['难度']) bits.push('难度：' + f['难度'] + ' / 5');
        const head = bits.length ? '\n核心信息　' + bits.join('　') + '\n' : '';
        return {
          text: kb.text + head + '\n完整步骤在下面 👇',
          recipe: kb.hits[0].title,
          hits: kb.hits
        };
      }
      const target = nameMatch ? nameMatch[1] : Object.keys(DISH_DB)[Math.floor(Math.random() * 8)];
      return { text: `「${target}」的做法已经在下面啦 👇`, recipe: target };
    }

    case 'swap': {
      return { text: '好，我换一道。这道换成了同价位里匹配度更高的选项 👇', swap: true };
    }

    case 'allergy': {
      const allergenHit = (ctx.avoid || []).join('、');
      return {
        text: `已按你的忌口「${allergenHit}」做了硬过滤：这些成分的菜一道都不会出现在方案里。\n\n不过要提醒一句——过敏原信息来自菜单识别，可能有漏。建议点单时跟服务员再确认一次，尤其是你标了过敏的那几项。`
      };
    }

    case 'explain': {
      if (!plan || !plan.ok) return { text: '你先扫一份菜单，我就能告诉你每道菜为什么这么推荐了。' };
      const first = Object.values(plan.grouped)[0]?.[0];
      if (!first) return { text: '方案还没生成，先点一下「生成点单方案」吧。' };
      return {
        text: `「${first.name}」被选中，主要三个原因：\n\n1. 定位对——它是${first.role}，在你的 ${ctx.servings} 人预算 ¥${ctx.budget} 里属于核心投入。\n2. 口味对——${lookupDish(first.name).desc}，跟你的偏好能对上。\n3. 搭配好——它和这桌其他菜在味型上错开，吃起来不腻。\n\n每道菜我都会给一句具体的理由，不会只说「推荐你点」。`
      };
    }

    case 'ingredient': {
      const cat = text.includes('素') ? '素菜' : text.includes('汤') ? '汤' : null;
      const found = tools.searchDishes('', menuItems, { category: cat || undefined, limit: 5 });
      if (!found.length) return { text: '这份菜单里没找到符合条件的菜。换一家试试？' };
      return {
        text: `${cat ? `这份菜单的${cat}有这些：` : '这份菜单里比较值得点的：'}\n\n${found.map(x => `· ${x.name} ¥${x.price}`).join('\n')}\n\n想让我配一桌的话，说一声「帮我搭配」。`,
        dishes: found
      };
    }

    case 'chitchat':
      return { text: '在的～你可以扫一份菜单让我帮你看，或者直接问我菜的做法。' };

    default:
      if (text.includes('帮我搭配') || text.includes('推荐一桌') || text.includes('点什么')) {
        return { text: '好，我按你现在的条件配一桌 👇', replan: true };
      }
      return {
        text: '我可以帮你做三件事：\n\n① 扫菜单 → 识别菜品并配一桌（预算/人数/忌口都能说）\n② 拍照识菜 → 问做法、来源、搭配\n③ 生成菜谱 → 用你现有的食材\n\n你想从哪个开始？'
      };
  }
}

/* --------------------------------------------------------------------------
   6. 真实服务调用（可选）：若配置了 apiEndpoint 则走远端
   -------------------------------------------------------------------------- */

async function callRemote(payload, onDelta) {
  if (!config.apiEndpoint) throw new Error('no_endpoint');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), config.timeout);
  try {
    const res = await fetch(config.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, model: config.model }),
      signal: ctrl.signal
    });
    if (!res.ok || !res.body) throw new Error('bad_status');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let acc = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      acc += chunk;
      if (onDelta) onDelta(chunk, acc);
    }
    return acc;
  } finally {
    clearTimeout(timer);
  }
}

/** 统一的 AI 入口：优先真实服务，失败自动降级本地 */
async function ask(text, ctx, plan, menuItems, onDelta) {
  if (config.apiEndpoint) {
    try {
      const r = await callRemote({ task: 'agent', message: text, context: ctx }, onDelta);
      if (r && r.trim()) return { text: r, remote: true };
    } catch (e) {
      console.warn('[MenuLens] 远端调用失败，降级本地推理：', e.message);
    }
  }
  return agentReply(text, ctx, plan, menuItems);
}

async function planRemote(ctx, menuItems) {
  if (config.apiEndpoint) {
    try {
      const r = await callRemote({ task: 'order-plan', context: ctx, menu: menuItems });
      const j = JSON.parse(r);
      if (j && j.grouped) return { ...j, remote: true, steps: [{ text: '由远端模型生成', state: 'done' }] };
    } catch (e) {
      console.warn('[MenuLens] 远端方案失败，降级本地：', e.message);
    }
  }
  return generatePlan(ctx, menuItems);
}

  return {
    config, tools, generatePlan, parseMenu,
    detectIntent, isJailbreak, isOffTopic, parseConstraintPatch,
    agentReply, callRemote, ask, planRemote
  };
})();

if (typeof window !== 'undefined') window.MenuLensAI = MenuLensAI;
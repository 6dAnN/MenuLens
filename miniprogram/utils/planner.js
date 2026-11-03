/**
 * 点单方案引擎（对应 PRD §8.3 WF-2 order-plan）
 * 纯函数、无网络依赖，可直接单测。
 * 实际项目中这一层应交给 Dify Workflow，此处保留为：
 *   1) 单元测试基准
 *   2) Dify 不可用时的本地降级
 */
const { lookupDish } = require('./dishes.js');

/**
 * 硬约束过滤：忌口与过敏原一律剔除，不可绕过（PRD §8.3 节点2）
 * @returns {{kept: Array, excluded: Array}}
 */
function hardFilter(items, ctx) {
  const avoid = (ctx.avoid || []).map(x => String(x).toLowerCase());
  const severity = ctx.allergenSeverity || {};
  const strictAllergens = Object.keys(severity)
    .filter(k => severity[k] === 'allergy')
    .map(k => String(k).toLowerCase());

  const kept = [];
  const excluded = [];

  for (const it of items) {
    const d = lookupDish(it.name);
    const hay = [it.name, it.desc || '', (d.ingredients || []).join(' '), (d.methods || []).join(' ')]
      .join(' ').toLowerCase();

    // 过敏原：硬过滤。
    // 以菜品本体 allergens 字段为准——不能靠 ingredients 文本里是否出现
    // 「蛋」来判断，因为白切鸡标注含蛋但配料写的是「三黄鸡」。
    const hitAllergen = (d.allergens || []).find(a =>
      strictAllergens.indexOf(String(a).toLowerCase()) >= 0
    );
    if (hitAllergen) {
      excluded.push(Object.assign({}, it, { _reason: '含过敏原「' + hitAllergen + '」' }));
      continue;
    }

    // 忌口：关键词匹配（含常见别名）
    const aliasMap = {
      香菜: '芫荽', 海鲜: '鱼', 辣: '椒', 牛肉: '牛', 猪肉: '猪',
      花生: '花生', 蛋: '蛋', 大豆: '酱'
    };
    const hitAvoid = avoid.find(a => {
      const al = aliasMap[a] || a;
      return hay.indexOf(String(a).toLowerCase()) >= 0 || hay.indexOf(String(al).toLowerCase()) >= 0;
    });
    if (hitAvoid) {
      excluded.push(Object.assign({}, it, { _reason: '含「' + hitAvoid + '」' }));
      continue;
    }

    kept.push(it);
  }
  return { kept, excluded };
}

/** 排序分 = 预算适配×0.35 + 口味匹配×0.30 + 类别多样性×0.20 + 招牌×0.15 */
function scoreDish(item, ctx, allItems) {
  const d = lookupDish(item.name);
  let score = 0;

  const perHead = ctx.budget / Math.max(ctx.servings, 1);
  const ratio = item.price / Math.max(perHead, 1);
  const budgetFit = ratio <= 0.45 ? 1 : (ratio <= 0.6 ? 0.8 : 0.5);
  score += budgetFit * 0.35;

  let tasteFit = 0.6;
  const sp = d.spicy || 0;
  const lv = ctx.spiceLevel;
  if (lv === 'none') tasteFit = sp === 0 ? 1 : 0.2;
  else if (lv === 'mild') tasteFit = sp <= 0.3 ? 1 : 0.5;
  else if (lv === 'medium') tasteFit = (sp >= 0.2 && sp <= 0.8) ? 1 : 0.6;
  else if (lv === 'hot') tasteFit = sp >= 0.7 ? 1 : 0.4;
  score += tasteFit * 0.30;

  const sameCat = allItems.filter(x => x.category === item.category).length;
  score += (1 - sameCat / Math.max(allItems.length, 1)) * 0.20;

  score += (item.confidence || 0.6) * 0.15;
  return score;
}

/** 生成推荐理由——必须包含具体信息，禁止套话 */
function pickReason(item, ctx) {
  const d = lookupDish(item.name);
  const perHead = ctx.budget / Math.max(ctx.servings, 1);
  if (item.price >= perHead * 0.4 && item.price <= perHead * 0.62) {
    return item.name + '是这道菜里的招牌，' + d.desc;
  }
  if (item.price < perHead * 0.35) {
    return d.desc + '，性价比高，压低整桌单价';
  }
  return d.desc;
}

/**
 * 生成点单方案
 * @returns {{ok:boolean, total:number, grouped:Object, warnings:Array, excluded:Array}}
 */
function generatePlan(ctx, items) {
  const filtered = hardFilter(items, ctx);
  const kept = filtered.kept;
  const excluded = filtered.excluded;
  const steps = [];

  steps.push({ text: '过滤忌口与过敏原，剩余 ' + kept.length + ' 道', state: 'done' });
  if (excluded.length) {
    steps.push({
      text: '已排除 ' + excluded.length + ' 道：' + excluded.slice(0, 2).map(e => e.name).join('、'),
      state: 'done'
    });
  }

  if (kept.length === 0) {
    return {
      ok: false, steps, excluded,
      emptyReason: '菜单里所有菜品都涉及你的忌口了，建议换一家，或让服务员推荐两道不冲突的菜。'
    };
  }

  const candidates = kept.slice().sort((a, b) => scoreDish(b, ctx, kept) - scoreDish(a, ctx, kept));
  steps.push({ text: '按预算 ¥' + ctx.budget + ' / ' + ctx.servings + ' 人排序', state: 'done' });

  const targetCount = Math.max(2, Math.min(Math.round(ctx.servings * 1.3), kept.length));
  const mains = candidates.filter(c => ['荤菜', '主食', '凉菜'].indexOf(c.category) >= 0);
  const vegs = candidates.filter(c => c.category === '素菜');
  const soups = candidates.filter(c => ['汤', '甜品'].indexOf(c.category) >= 0);

  const chosen = [];
  let total = 0;
  let adjusted = null;

  const maxMains = Math.ceil(targetCount * 0.62);
  const maxVegs = Math.ceil(targetCount * 0.28);

  for (const pool of [mains, vegs, soups]) {
    for (const cand of pool) {
      if (chosen.length >= targetCount) break;
      if (chosen.indexOf(cand) >= 0) continue;
      const mainsChosen = chosen.filter(c => ['荤菜', '主食', '凉菜'].indexOf(c.category) >= 0).length;
      const vegChosen = chosen.filter(c => c.category === '素菜').length;
      if (pool === mains && mainsChosen >= maxMains) continue;
      if (pool === vegs && vegChosen >= maxVegs) continue;
      if (total + cand.price > ctx.budget && chosen.length > 0) continue;
      chosen.push(cand);
      total += cand.price;
    }
    if (chosen.length >= targetCount) break;
  }

  if (chosen.length === 0) {
    chosen.push(candidates[0]);
    total = candidates[0].price;
    adjusted = '预算偏紧，先推荐了这道招牌菜';
  }

  // 预算校验：超预算则裁剪最贵的一道
  let guard = 0;
  while (total > ctx.budget && chosen.length > 1 && guard++ < 3) {
    let idx = 0;
    for (let i = 1; i < chosen.length; i++) if (chosen[i].price > chosen[idx].price) idx = i;
    const removed = chosen[idx];
    total -= removed.price;
    chosen.splice(idx, 1);
    adjusted = '为控制在预算内，去掉了较贵的「' + removed.name + '」';
  }

  steps.push({ text: '预算校验 ' + (total <= ctx.budget ? '通过' : '已用尽') + ' ¥' + total, state: 'done' });

  const servings = chosen.reduce((s, c) => s + (lookupDish(c.name).servings || 0.7), 0);
  steps.push({ text: '份量估算 ' + servings.toFixed(1) + ' 人份 / ' + ctx.servings + ' 人', state: 'done' });

  const order = { 荤菜: 0, 主食: 1, 凉菜: 2, 素菜: 3, 汤: 4, 甜品: 5 };
  chosen.sort((a, b) => (order[a.category] === undefined ? 9 : order[a.category]) -
                        (order[b.category] === undefined ? 9 : order[b.category]));

  const grouped = {};
  for (const c of chosen) {
    if (!grouped[c.category]) grouped[c.category] = [];
    const d = lookupDish(c.name);
    grouped[c.category].push({
      key: c.key, name: c.name, price: c.price, en: c.en, desc: c.desc,
      category: c.category, role: d.role || c.category,
      reason: pickReason(c, ctx)
    });
  }

  // 冲突警告
  const warnings = [];
  for (const c of chosen) {
    const d = lookupDish(c.name);
    const hay = [c.name, c.desc || '', (d.ingredients || []).join(' ')].join(' ');
    for (const a of (d.allergens || [])) {
      if ((ctx.avoid || []).some(x => x === a) && hay.indexOf(a) >= 0) {
        warnings.push(c.name + ' 提到含「' + a + '」，请向服务员再确认一次');
      }
    }
  }
  if (ctx.budget < ctx.servings * 25) warnings.push('预算偏紧，菜品可能不够放开吃');
  if (servings < ctx.servings * 0.8) {
    warnings.push('菜单菜品较少，已按全部推荐（' + servings.toFixed(1) + ' 人份）');
  }

  return {
    ok: true, steps, excluded, adjusted,
    total: total, perHead: total / ctx.servings, servings,
    grouped: grouped, warnings: warnings, dishCount: chosen.length
  };
}

/** 置信度计算（PRD §7.3） */
function computeConfidence(item) {
  const vision = item.confidence > 0.7 ? item.confidence * 0.98 : item.confidence;
  const hasKB = !!require('./dishes.js').DISH_DB[item.name];
  const kb = hasKB ? 0.95 : 0.35;
  const ocrBonus = (item.desc && item.desc.length > 5) ? 0.1 : 0;
  let conf = vision * 0.6 + kb * 0.3 + ocrBonus;
  if (!ocrBonus) conf = conf * 0.95;
  return Math.min(0.99, Math.max(0.05, conf));
}

/** 菜单解析（模拟 WF-1 输出） */
function parseMenu(rawMenu) {
  return {
    meta: rawMenu.meta,
    items: rawMenu.items.map(function (it) {
      const d = lookupDish(it.name);
      const conf = computeConfidence(it);
      return Object.assign({}, it, {
        confidence: conf, allergens: d.allergens, spicy: d.spicy, flavor: d.flavor,
        uncertain: conf < 0.5, needsConfirm: conf < 0.8
      });
    })
  };
}

module.exports = { hardFilter, generatePlan, computeConfidence, parseMenu, scoreDish, pickReason };
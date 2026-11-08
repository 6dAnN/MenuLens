/**
 * 识菜对账（Photo → 知识库 一致性校验）
 * ------------------------------------------------------------------
 * 为什么需要这一层：
 *   视觉模型给出「宫保鸡丁」，但模型也可能给出「宫爆鸡丁」「Kung Pao Chicken」
 *   或者干脆给一个知识库里根本没有的名字。前两种情况其实是同一道菜，
 *   第三种则意味着后面所有依赖知识库的能力（过敏原过滤、点单排序、菜谱）
 *   都会退化成「猜」。
 *
 * 所以这里做三件事：
 *   1. **菜名归一**：模型自由写法的菜名 → 知识库标准菜名（同义、别名、英文名、去修饰）；
 *   2. **字段对账**：模型声称的菜系 / 过敏原 / 辣度，与知识库记录比对，
 *      不一致时以知识库为准，并**下调置信度**——不一致本身就是「识别可疑」的证据；
 *   3. **候选注入**：为提示词生成一份候选清单，让模型优先在库内匹配。
 *
 * 设计原则与过敏原硬过滤一致：**能靠代码判定的，就不交给模型**。
 * 模型只负责「看图说出最像什么」，对账是代码的事。
 */
const KB = require('./kb-data.js');
const dishes = require('./dishes.js');

/* ==========================================================================
   1. 从知识库建立菜名索引
   ========================================================================== */

/** 只取菜品条目（排除「食材与过敏原知识」里的主题型 chunk） */
function isDishChunk(c) {
  return /^菜品知识库/.test(c.source) && c.title && c.title.length <= 12;
}

let NAME_INDEX = null;

/** 去掉括号补充语与常见修饰，得到菜名核心 */
function coreName(name) {
  return String(name || '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/^(泰式|日式|粤式|港式|川味|家常|经典|秘制|京式|杭式|苏式|台式|韩式|意式|法式)/, '')
    .replace(/\s+/g, '')
    .trim();
}

/** 极简拼音首字母（只覆盖常见字，用于「gongbaojiding」这类输入兜底） */
const PINYIN = null; // 不引第三方库，拼音匹配暂不做；保留位置说明原因

function buildNameIndex() {
  const exact = {};       // 标准名 / 核心名 → 条目
  const alias = {};       // 别名 / 英文名（小写）→ 标准名
  const rows = [];

  (KB.chunks || []).forEach(c => {
    if (!isDishChunk(c)) return;
    const row = {
      name: c.title,
      core: coreName(c.title),
      text: c.text,
      keywords: c.keywords || [],
      en: '',
      cuisine: '',
      category: '',
      spicy: null,
      allergens: []
    };
    // 从 markdown 表格里抽字段（格式固定，见 tools/build-kb.js）
    const get = re => {
      const m = c.text.match(re);
      return m ? m[1].trim() : '';
    };
    row.en = get(/\|\s*英文名\s*\|\s*([^|\n]+)\|/);
    row.cuisine = get(/\|\s*菜系\s*\|\s*([^|\n]+)\|/);
    row.category = get(/\|\s*类别\s*\|\s*([^|\n]+)\|/);
    const spicyRaw = get(/\|\s*辣度\s*\|\s*([^|\n]+)\|/);
    row.spicy = spicyRaw ? Number(spicyRaw) : null;
    const alRaw = get(/\|\s*过敏原\s*\|\s*([^|\n]+)\|/);
    row.allergens = alRaw && alRaw !== '无'
      ? alRaw.split(/[、,，]/).map(s => s.trim()).filter(Boolean)
      : [];

    rows.push(row);
    exact[c.title] = row;
    if (row.core && !exact[row.core]) exact[row.core] = row;
    if (row.en) alias[row.en.toLowerCase()] = row.name;

    // 括号里的内容也算别名：「盐焗鸡（港式）」→「港式盐焗鸡」不是常见说法，
    // 但「冬阴功（泰式）」这类括号内容本身就是用户会说的词
    const inner = (c.title.match(/[（(]([^)）]+)[)）]/) || [])[1];
    if (inner && inner.length >= 2) alias[inner] = c.title;
  });

  // 老 15 道菜的 DISH_DB 里可能有知识库还没收录的名字，补进来做兜底
  Object.keys(dishes.DISH_DB || {}).forEach(k => {
    if (!exact[k]) {
      const d = dishes.DISH_DB[k];
      const row = {
        name: k, core: coreName(k), text: '', keywords: d.ingredients || [],
        en: d.nameEn || '', cuisine: d.cuisine || '', category: d.category || '',
        spicy: typeof d.spicy === 'number' ? d.spicy : null,
        allergens: d.allergens || []
      };
      rows.push(row);
      exact[k] = row;
      if (d.nameEn) alias[String(d.nameEn).toLowerCase()] = k;
    }
  });

  NAME_INDEX = { exact, alias, rows };
  return NAME_INDEX;
}

function getIndex() {
  return NAME_INDEX || buildNameIndex();
}

/* ==========================================================================
   2. 菜名归一
   ========================================================================== */

/**
 * 把任意来源的菜名匹配到知识库标准名。
 *
 * 匹配优先级（严格 → 宽松，越往后置信折扣越大）：
 *   1. 完全等于标准名            → exact
 *   2. 完全等于核心名（去修饰）  → core
 *   3. 英文名大小写不敏感        → en
 *   4. 别名                      → alias
 *   5. 一方包含另一方且长度 ≥2   → contains
 *   6. 汉字二元组 Jaccard ≥ 0.5  → fuzzy（兜「宫爆鸡丁 / 宫保鸡丁」这类错字）
 *
 * @returns {{name:string, row:Object, how:string, ratio:number}|null}
 */
function matchDish(rawName) {
  const name = String(rawName || '').trim();
  if (!name) return null;
  const idx = getIndex();

  if (idx.exact[name]) return { name: idx.exact[name].name, row: idx.exact[name], how: 'exact', ratio: 1 };

  const core = coreName(name);
  if (core && idx.exact[core]) {
    return { name: idx.exact[core].name, row: idx.exact[core], how: 'core', ratio: 0.97 };
  }

  const lower = name.toLowerCase();
  if (idx.alias[lower]) {
    const std = idx.alias[lower];
    return { name: std, row: idx.exact[std], how: 'en', ratio: 0.95 };
  }

  // 包含关系：只在长度 ≥2 时成立，避免「鱼」匹配到「水煮鱼」
  let best = null;
  for (const row of idx.rows) {
    if (name.length < 2 || row.name.length < 2) continue;
    if (row.name.indexOf(name) >= 0 || name.indexOf(row.name) >= 0) {
      const shorter = Math.min(name.length, row.name.length);
      const longer = Math.max(name.length, row.name.length);
      const ratio = shorter / longer;
      if (ratio >= 0.5 && (!best || ratio > best.ratio)) {
        best = { name: row.name, row, how: 'contains', ratio: Math.min(0.9, ratio) };
      }
    }
  }
  if (best) return best;

  // 编辑距离兜错别字。
  // 为什么不用 bigram Jaccard：「宫爆鸡丁」vs「宫保鸡丁」的二元组只有「鸡丁」共用，
  // Jaccard 只有 1/4 = 0.25，全被阈值挡掉。但中文菜名的错字几乎都是**同音替换单字**，
  // 长度不变、只有一个字不同——编辑距离才是对的度量。
  // 约束「长度差 ≤1 且距离 ≤1」是为了避免「鱼香肉丝」被算成「鱼香茄子」（距离 2）。
  let bestE = null;
  for (const row of idx.rows) {
    const a2 = core || name;
    const b2 = row.core || row.name;
    if (Math.abs(a2.length - b2.length) > 1) continue;
    if (a2.length < 2 || b2.length < 2) continue;
    const dist = editDistance(a2, b2);
    const allowed = a2.length >= 4 ? 1 : 0;
    if (dist <= allowed && dist < Math.max(a2.length, b2.length)) {
      const ratio = 1 - dist / Math.max(a2.length, b2.length);
      if (!bestE || ratio > bestE.ratio) {
        bestE = { name: row.name, row, how: 'typo', ratio: 0.6 + ratio * 0.3 };
      }
    }
  }
  if (bestE) return bestE;

  return null;
}

/** 编辑距离（Levenshtein），菜名都很短，直接算 */
function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = [];
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[n];
}

/* ==========================================================================
   3. 字段对账
   ========================================================================== */

/** 模型说的菜系与知识库不一致时，是否属于可接受的近义 */
const CUISINE_GROUP = {
  川菜: ['川菜', '四川', '重庆', '川味'],
  粤菜: ['粤菜', '广东', '港式', '广府', '潮汕'],
  湘菜: ['湘菜', '湖南'],
  鲁菜: ['鲁菜', '山东'],
  苏菜: ['苏菜', '江苏', '淮扬', '南京', '苏州'],
  浙菜: ['浙菜', '浙江', '杭州', '宁波'],
  闽菜: ['闽菜', '福建', '福州', '厦门'],
  徽菜: ['徽菜', '安徽'],
  东北菜: ['东北菜', '东北', '黑龙江', '吉林', '辽宁'],
  西北菜: ['西北菜', '陕西', '甘肃', '新疆', '宁夏', '青海'],
  云贵菜: ['云贵菜', '云南', '贵州'],
  京菜: ['京菜', '北京'],
  家常菜: ['家常菜', '家常', '全国']
};

function sameCuisine(a, b) {
  if (!a || !b) return true;                 // 一方没给，不算冲突
  if (a === b) return true;
  const groups = Object.keys(CUISINE_GROUP).filter(k =>
    CUISINE_GROUP[k].some(x => a.indexOf(x) >= 0 || x.indexOf(a) >= 0) ||
    CUISINE_GROUP[k].some(x => b.indexOf(x) >= 0 || x.indexOf(b) >= 0)
  );
  // 只要两者落在同一个菜系组里就算一致
  return groups.some(k =>
    CUISINE_GROUP[k].some(x => a.indexOf(x) >= 0) &&
    CUISINE_GROUP[k].some(x => b.indexOf(x) >= 0)
  );
}

/**
 * 对账：把模型输出与知识库记录比对，返回修正后的字段与调整说明。
 *
 * @param {Object} d      模型的原始输出
 * @param {Object} match  matchDish 的返回（可为 null）
 * @returns {{ name, cuisine, category, spicy, allergens, adjust, discount, reasons }}
 */
function reconcile(d, match) {
  const reasons = [];
  let discount = 1;   // 置信度折扣，累乘

  if (!match) {
    // 知识库里没有这道菜。不是错，但意味着后续能力都会打折扣，
    // 所以置信度必须下调——用户有权知道「这个答案没有资料支撑」。
    return {
      name: String(d.name || '').trim(),
      cuisine: d.cuisine || '',
      category: d.category || '',
      spicy: typeof d.spicy === 'number' ? d.spicy : null,
      allergens: null,
      adjust: [],
      discount: 0.82,
      reasons: ['知识库未收录「' + String(d.name || '').trim() + '」，以下信息来自模型推断']
    };
  }

  const row = match.row;
  const adjust = [];

  // 菜名归一：模型写法与标准名不同就纠正，并记一笔
  if (match.name !== String(d.name || '').trim()) {
    adjust.push({ field: 'name', from: String(d.name || '').trim(), to: match.name });
    // 错字/模糊匹配说明模型没看准，折扣更大
    if (match.how === 'typo') discount *= 0.88;
    else if (match.how === 'contains') discount *= 0.94;
  }

  // 菜系
  let cuisine = d.cuisine || row.cuisine || '';
  if (row.cuisine && d.cuisine && !sameCuisine(d.cuisine, row.cuisine)) {
    adjust.push({ field: 'cuisine', from: d.cuisine, to: row.cuisine });
    cuisine = row.cuisine;
    discount *= 0.9;
    reasons.push('菜系判断与知识库不符（模型说' + d.cuisine + '，资料是' + row.cuisine + '）');
  } else if (row.cuisine && !d.cuisine) {
    cuisine = row.cuisine;
  }

  // 类别
  let category = d.category || row.category || '';
  if (row.category && d.category && d.category !== row.category) {
    adjust.push({ field: 'category', from: d.category, to: row.category });
    category = row.category;
    discount *= 0.95;
  }

  // 辣度：知识库是 0-3 档，模型给的是 0-1，先换算再比对
  let spicy = typeof d.spicy === 'number' ? Math.max(0, Math.min(1, d.spicy)) : null;
  if (row.spicy !== null && !isNaN(row.spicy)) {
    const kbSpicy = Math.min(1, row.spicy / 3);
    if (spicy === null) {
      spicy = kbSpicy;
    } else if (Math.abs(spicy - kbSpicy) >= 0.34) {
      // 差一档以上才纠，差半档属于正常主观差异
      adjust.push({ field: 'spicy', from: spicy, to: kbSpicy });
      reasons.push('辣度判断与资料差一档以上，已按资料修正');
      spicy = kbSpicy;
      discount *= 0.95;
    }
  }
  if (spicy === null) spicy = 0;

  // 过敏原：**以知识库为并集基准**。模型看到了额外线索要保留（宁多勿少），
  // 但知识库记录的绝不能因为模型没提到就丢掉——这是硬过滤的输入。
  const kbAll = row.allergens || [];
  const modelAll = Array.isArray(d.allergens) ? d.allergens : [];

  return {
    name: match.name,
    cuisine,
    category,
    spicy,
    allergens: { kb: kbAll, model: modelAll, merged: mergeAllergens(kbAll, modelAll) },
    adjust,
    discount,
    reasons
  };
}

/** 过敏原合并：知识库全保留，模型多给的也保留 */
function mergeAllergens(kbList, modelList) {
  const out = kbList.slice();
  modelList.forEach(a => { if (out.indexOf(a) < 0) out.push(a); });
  return out;
}

/* ==========================================================================
   4. 候选清单（注入提示词）
   ========================================================================== */

/**
 * 按关键词给知识库菜品排序，取前 N 个作为「候选清单」喂给视觉模型。
 *
 * 为什么不把 730 道全塞进提示词：那会占掉 1 万多 token，
 * 而且模型面对长列表反而更倾向于随手挑一个。给 40 个强相关候选，
 * 模型会认真比对，识别质量更高。
 *
 * 候选来源优先级：模型自己给的 alternatives > 菜单上的菜 > 全局高频。
 */
function candidateList(hints, limit) {
  const n = limit || 40;
  const idx = getIndex();
  const seen = {};
  const out = [];

  const push = row => {
    if (!row || seen[row.name]) return;
    seen[row.name] = true;
    out.push(row.name);
  };

  // 1) 显式提示（模型给的 alternatives、菜单上的菜名）
  (hints || []).forEach(h => {
    const m = matchDish(h);
    if (m) push(m.row);
  });

  // 2) 老库里的高频菜（点单 demo 常用，识别率天然高）
  Object.keys(dishes.DISH_DB || {}).forEach(k => {
    if (out.length < n) push(idx.exact[k]);
  });

  // 3) 按知识库顺序补齐（顺序即菜系聚类，保证候选覆盖多个菜系）
  for (const row of idx.rows) {
    if (out.length >= n) break;
    push(row);
  }
  return out.slice(0, n);
}

/** 候选清单格式化成提示词片段 */
function candidatePrompt(hints, limit) {
  const list = candidateList(hints, limit);
  if (!list.length) return '';
  return '【候选菜品清单（知识库已收录，优先从这里选）】\n' + list.join('、') +
    '\n如果照片里的菜明确属于清单中的某一项，name 必须原样使用清单里的写法；' +
    '如果清单里没有合适的，再给出你自己的判断，并把"in_kb"设为 false。';
}

function stats() {
  const idx = getIndex();
  return { dishes: idx.rows.length, index: Object.keys(idx.exact).length };
}

module.exports = {
  matchDish, reconcile, mergeAllergens, candidateList, candidatePrompt,
  coreName, sameCuisine, stats
};

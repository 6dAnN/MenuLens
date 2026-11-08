/**
 * 本地 RAG 检索（Retrieval-Augmented Generation 的 R 部分）
 * ------------------------------------------------------------------
 * 为什么不用向量库：
 *   · 语料只有 26 条 chunk，BM25 的召回质量已经够用，而且零延迟、零成本；
 *   · 小程序里跑嵌入模型要额外几 MB 的包体，收益不成比例；
 *   · 断网时 RAG 依然工作——知识库不该是联网才有的能力。
 *
 * 中文检索的关键：中文没有空格分词，这里用「单字 + 二元组（bigram）」
 * 构造检索词项。单字保证召回，bigram 保证精度，两者一起 BM25 打分。
 *
 * 检索结果会拼进 system prompt，让模型「看着资料回答」而不是凭记忆编。
 */
const KB = require('./kb-data.js');

const K1 = 1.5;   // BM25 词频饱和参数
const B = 0.75;   // BM25 长度归一化参数

/** 中文停用词（高频但几乎没有区分度，留着会稀释打分） */
const STOP = {};
('的 了 吗 呢 吧 啊 是 我 你 他 她 它 这 那 有 和 与 或 都 也 就 还 要 会 能 可以 怎么 什么 为什么 ' +
 '请问 一下 一个 这个 那个 是不 不是 没有 有没 哪些 哪个 如何 多少 几个 吃 点 想 要 说').split(/\s+/)
  .forEach(w => { if (w) STOP[w] = true; });

/**
 * 非饮食意图词
 * ------------------------------------------------------------------
 * 「香港旅游攻略」这类问题会靠单字「港」碰上一堆「港式」菜名，
 * 三道闸门拦不住——因为它确实命中了 bigram「香港」（知识库里有「香港」）。
 * 与其无限调阈值，不如先判断意图：出现这些词且没有饮食类词时，
 * 直接认定不是知识库该回答的问题。
 */
const OFF_TOPIC = /(攻略|旅游|景点|机票|酒店|签证|天气|股票|基金|汇率|编程|代码|python|javascript|考试|论文|招聘|简历)/i;
const FOOD_HINT = /(菜|吃|点|辣|过敏|食材|做|煮|炒|蒸|味|口感|热量|价格|多少|推荐|搭配|饭店|餐厅|忌口|素|荤|汤|饭|面)/;

/**
 * 同义词 / 口语 → 语料用词
 * ------------------------------------------------------------------
 * 用户不会说「点单搭配原则」，他说的是「怎么点菜」；
 * 也不会说「营养成分与人群建议」，他说的是「小孩能吃什么」。
 *
 * 语料是「书面语 + 分类标题」，用户输入是「口语 + 场景」，中间这层落差
 * 靠调 BM25 参数是补不上的——单字和 bigram 都不共享。
 * 所以显式做一层词表映射：命中左边的说法，就把右边的语料词补进检索词。
 *
 * 这张表是**产品资产**，不是临时补丁：新语料里出现新的口语说法就补一行。
 */
const SYNONYM = [
  // 点单策略
  [/点菜|点单|怎么点|配几个|点什么好|几人份|几个菜/, ['点单', '搭配', '原则']],
  // 人群禁忌
  [/孕妇|怀孕|备孕|哺乳/, ['孕妇', '人群']],
  [/小孩|儿童|宝宝|孩子|娃/, ['儿童', '人群']],
  [/老人|长辈|老年/, ['人群', '清淡']],
  [/痛风|尿酸/, ['痛风', '嘌呤']],
  [/三高|血压|血脂|血糖|糖尿病/, ['三高', '人群']],
  [/减脂|减肥|低卡|热量控制|瘦身/, ['减脂', '热量']],
  [/素食|吃素|素斋/, ['素食']],
  // 过敏与忌口
  [/过敏|忌口|不能吃|能不能吃/, ['过敏原']],
  [/花生过敏/, ['花生']],
  [/辣度|多辣|会不会辣|不辣/, ['辣度', '麻辣']],
  // 其他高频问法
  [/多少钱|贵不贵|价格|预算/, ['价格']],
  [/热量|卡路里|胖不胖|长胖/, ['热量']],
  [/怎么搭|一起点|配什么|搭配/, ['搭配']],
  [/酒|啤酒|白酒|红酒/, ['酒水']]
];

function expand(query, tokens) {
  const q = String(query || '');
  const extra = [];
  SYNONYM.forEach(([re, words]) => {
    if (re.test(q)) words.forEach(w => { if (tokens.indexOf(w) < 0) extra.push(w); });
  });
  return extra;
}

/** 把一句话切成检索词项：中文单字 + bigram，英文/数字按词 */
function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const tokens = [];

  // 英文与数字
  const latin = s.match(/[a-z0-9]+/g) || [];
  latin.forEach(w => { if (w.length > 1) tokens.push(w); });

  // 中文连续片段
  const han = s.match(/[\u4e00-\u9fa5]+/g) || [];
  for (const seg of han) {
    for (let i = 0; i < seg.length; i++) {
      const ch = seg[i];
      if (!STOP[ch]) tokens.push(ch);
      if (i + 1 < seg.length) {
        const bi = seg.slice(i, i + 2);
        if (!STOP[bi]) tokens.push(bi);
      }
    }
  }
  return tokens;
}

/** 预建索引：文档词频、文档长度、平均长度、倒排表 */
let INDEX = null;

function buildIndex() {
  const docs = KB.chunks || [];
  const df = {};              // 词项 → 出现过的文档数
  const postings = [];        // [{ tf: {term:count}, len }]
  let totalLen = 0;

  for (const d of docs) {
    const tokens = tokenize(d.title + ' ' + d.text + ' ' +
      (d.keywords || []).join(' ') + ' ' + (d.keywords || []).join(' '));
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    Object.keys(tf).forEach(t => { df[t] = (df[t] || 0) + 1; });
    postings.push({ tf, len: tokens.length });
    totalLen += tokens.length;
  }

  INDEX = {
    docs,
    df,
    postings,
    avgLen: docs.length ? totalLen / docs.length : 1,
    N: docs.length
  };
  return INDEX;
}

function getIndex() {
  return INDEX || buildIndex();
}

/**
 * BM25 检索
 *
 * 只靠单字命中会误召回——「明天天气如何」里的「天」「气」都碰得上菜品描述，
 * 但语义完全无关。所以这里加两道相关性闸门：
 *   1. 必须命中一定比例的问题词项（coverage），否则整条丢弃；
 *   2. 必须至少命中一个 bigram 或标题，纯单字命中的不算。
 *
 * @param {string} query 用户问题
 * @param {number} topK  返回条数
 * @param {Object} opts  { minScore, minCoverage }
 * @returns {Array<{title, text, source, score}>}
 */
function search(query, topK, opts) {
  const k = topK || 3;
  const minScore = (opts && opts.minScore) || 0.01;
  const idx = getIndex();
  if (!idx.N) return [];

  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  // 意图闸门：明显与「吃」无关的问题不进检索。
  // 「香港旅游攻略」会靠「香港」这个 bigram 命中「盐焗鸡（港式）」，闸门拦不住，
  // 但语义上它根本不是知识库要回答的问题——先判意图比事后调阈值更可靠。
  if (OFF_TOPIC.test(query) && !FOOD_HINT.test(query)) return [];

  // 同一个词在 query 里出现多次只算一次权重，避免长问题被自身长度带偏
  let qTerms = Array.from(new Set(qTokens));

  // 同义词扩展：口语问法 → 语料用词。扩展出来的词单独记一份，
  // 用来判断「文档是否命中了用户真正关心的那一类」，但不算进 bigram 闸门
  // （否则「怎么点菜」会靠「点菜」这个 bigram 蒙上一堆讲做法的条目）。
  const synTerms = expand(query, qTerms).filter(w => idx.df[w]);
  const synSet = {};
  synTerms.forEach(w => { synSet[w] = true; });

  // 问题里的 bigram 集合：用来判断是不是只有零散单字蒙上
  const qBigrams = qTerms.filter(t => t.length === 2 && /[\u4e00-\u9fa5]{2}/.test(t));

  const scores = new Array(idx.N).fill(0);
  const covered = new Array(idx.N).fill(0);       // 命中的问题词项数
  const bigramHit = new Array(idx.N).fill(0);     // 命中的 bigram 数
  const synHit = new Array(idx.N).fill(0);        // 命中的同义词项数

  let queryTermCount = 0;
  for (const term of qTerms) {
    const df = idx.df[term];
    if (!df) continue;
    queryTermCount++;
    const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));

    for (let i = 0; i < idx.N; i++) {
      const p = idx.postings[i];
      const f = p.tf[term];
      if (!f) continue;
      const denom = f + K1 * (1 - B + B * (p.len / idx.avgLen));
      scores[i] += idf * ((f * (K1 + 1)) / denom);
      covered[i]++;
      if (qBigrams.indexOf(term) >= 0) bigramHit[i]++;
    }
  }

  // 同义词项按 0.6 的权重叠加（它们是推断出来的意图，不是用户原话）
  for (const term of synTerms) {
    const df = idx.df[term];
    const idf = Math.log(1 + (idx.N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < idx.N; i++) {
      const p = idx.postings[i];
      const f = p.tf[term];
      if (!f) continue;
      const denom = f + K1 * (1 - B + B * (p.len / idx.avgLen));
      scores[i] += 0.6 * idf * ((f * (K1 + 1)) / denom);
      synHit[i]++;
    }
  }

  // 问题里根本没有任何词出现在语料中 → 不可能是知识库能回答的问题
  if (!queryTermCount) return [];

  // ---------- 标题锚点 ----------
  //
  // 「命中了某个菜名」是这里最强的信号：用户明确说出了某一项，那一条必须排第一，
  // 而不是被「常见菜品问答速查」「口味与辣度分级说明」这类泛化条目靠词项堆分压过去。
  //
  // 早先用的是「+25 固定加成」，那在 26 条语料下刚好够用（泛化条目裸分上限约 22）。
  // 但语料扩到 700+ 条之后，泛化条目会同时命中好几个检索词，裸分涨到 46，
  // 固定 25 就不够用了。所以改成**相对加成**：
  //   命中标题的条目，基准分取「本次检索的最高裸分 × 1.3 + 5」，
  // 保证无论语料多大都稳稳压过任何非标题条目，而不需要按语料规模调常数。
  // 若没有标题命中，这条规则自然不生效，走后面的相关性闸门。
  //
  // 注意知识库里的标题常带修饰（「泰式冬阴功」「盐焗鸡（港式）」），而用户只说
  // 「冬阴功」「盐焗鸡」，所以要双向判断：用户提到了标题，或标题的核心词
  // 出现在问题里。只做单向 indexOf 会漏掉一大类。
  const qLower = String(query || '').toLowerCase();

  /** 去掉括号补充说明与常见修饰词，得到标题的核心部分 */
  function coreOf(title) {
    return title
      .replace(/[（(].*?[)）]/g, '')                        // 括号里的限定语
      .replace(/^(泰式|日式|粤式|港式|川味|家常|经典|秘制|京式|杭式|苏式|港式)/, '')
      .trim();
  }

  const titleHits = idx.docs.map(d => {
    const title = d.title.toLowerCase();
    if (!title) return false;

    // 1) 用户直接说出了完整标题
    if (qLower.indexOf(title) >= 0) return true;

    // 2) 标题的核心部分被提到（「蒜蓉炒时蔬」→「炒时蔬」，「盐焗鸡（港式）」→「盐焗鸡」）
    const core = coreOf(title);
    if (core && core !== title && core.length >= 2 && qLower.indexOf(core) >= 0) return true;

    // 3) 反向：问题里的某个中文片段是标题的一部分
    //    （「冬阴功」⊂「泰式冬阴功」，「番茄炒蛋」⊂「番茄炒蛋」）
    const m = qLower.match(/[\u4e00-\u9fa5（）]{2,10}/g) || [];
    if (m.some(seg => seg.length >= 3 && title.indexOf(seg) >= 0)) return true;

    // 4) 问题片段与标题核心片段有 ≥3 字的重叠（兜住「西红柿炒蛋」vs「番茄炒蛋」这类别名）
    return m.some(seg => {
      const s = seg.length > 3 ? seg : '';
      return s && core.indexOf(s) >= 0;
    });
  });

  const maxBare = scores.reduce((a, b) => (b > a ? b : a), 0);
  const anchorBase = maxBare * 1.3 + 5;

  // 同义词命中阈值：命中 ≥2 个同义词项、且覆盖了扩展词的相当一部分，
  // 说明这条文档确实是用户想要的那一类（「孕妇」+「人群」）。
  const synTotal = synTerms.length;
  const synNeed = Math.max(1, Math.ceil(synTotal * 0.6));

  // ---------- 覆盖度加成 ----------
  //
  // BM25 有个和检索直觉相反的性质：文档越长，同样的词频得分被压得越低。
  // 「孕妇能吃生鱼片吗」里「孕妇」「孕」这两个词只出现在「营养成分与人群建议」，
  // 但那条文档长 1200 字，裸分 17.3；而「口水鱼片」只靠「生/鱼/鱼片/片」这种
  // 到处都有的单字，因为文档短、词频高，反而拿到 21.5 排第一。
  //
  // 用户问的是「孕妇」，模型却拿到「口水鱼片」的资料——这就是答非所问的根源。
  // 修法不是调 BM25 参数（那会连带影响所有查询），而是承认**覆盖度是独立信号**：
  // 一条文档命中的问题词项越多，越可能是用户要的那类答案。所以按
  // 「命中数 / 问题词项数」给一笔加成，量级与单条词项的 idf 贡献相当。
  //
  // 只对命中 ≥2 个词项的文档生效：命中 1 个词是巧合，命中 3 个以上基本就是主题吻合。
  const maxIdf = Math.log(1 + (idx.N + 0.5) / 0.5);
  const coverBonus = covered.map(c => (c >= 2 ? (c / queryTermCount) * maxIdf * 0.55 : 0));

  const scored = scores.map((s, i) => {
    if (titleHits[i]) return { i, s: anchorBase + s * 0.01, ok: true };

    // 相关性闸门：命中问题词项太少，或只蒙到单字，一律不算
    const cov = covered[i] / queryTermCount;
    const hasStrong = bigramHit[i] > 0 || (qBigrams.length === 0 && covered[i] >= 1);

    // 同义词路径：用户原话的字面词项没命中，但扩展出的意图词命中了，
    // 也放行——「怎么点菜」→「点单」「原则」都在这条文档里。
    // 这条路径要求：同义词命中达阈值，且 synHit 同时带来足够裸分（避免只碰上一个泛词）。
    const synOk = synTotal > 0 && synHit[i] >= synNeed;

    if (!(hasStrong && cov >= 0.34) && !synOk) return { i, s: -1, ok: false };

    let bonus = 0;
    (idx.docs[i].keywords || []).forEach(kw => {
      if (kw && kw.length >= 2 && qLower.indexOf(kw.toLowerCase()) >= 0) bonus += 1.5;
    });
    // 意图词命中也算覆盖：用户问「孕妇」时，含「孕妇」的条目必须比只含「鱼片」的靠前
    const intentBonus = synTotal ? (synHit[i] / synTotal) * maxIdf * 0.6 : 0;
    return { i, s: s + bonus + coverBonus[i] + intentBonus, ok: true };
  });

  return scored
    .filter(x => x.ok && x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map(x => ({
      title: idx.docs[x.i].title,
      text: idx.docs[x.i].text,
      source: idx.docs[x.i].source,
      score: Math.round(x.s * 100) / 100
    }));
}

/** 检索并拼成给模型的资料段落 */
function buildContext(query, topK) {
  const hits = search(query, topK || 3);
  if (!hits.length) return { hits: [], text: '' };

  const text = hits.map((h, i) =>
    '【资料 ' + (i + 1) + '：' + h.title + '】\n' + h.text
  ).join('\n\n');

  return { hits, text };
}

/** 语料统计，给「我的 → AI 设置」展示用 */
function stats() {
  const idx = getIndex();
  const files = {};
  idx.docs.forEach(d => { files[d.source] = (files[d.source] || 0) + 1; });
  return { chunks: idx.N, files, version: KB.version };
}

module.exports = { tokenize, search, buildContext, stats };

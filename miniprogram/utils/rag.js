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

  // 同一个词在 query 里出现多次只算一次权重，避免长问题被自身长度带偏
  const qTerms = Array.from(new Set(qTokens));

  // 问题里的 bigram 集合：用来判断是不是只有零散单字蒙上
  const qBigrams = qTerms.filter(t => t.length === 2 && /[\u4e00-\u9fa5]{2}/.test(t));

  const scores = new Array(idx.N).fill(0);
  const covered = new Array(idx.N).fill(0);       // 命中的问题词项数
  const bigramHit = new Array(idx.N).fill(0);     // 命中的 bigram 数

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

  // 问题里根本没有任何词出现在语料中 → 不可能是知识库能回答的问题
  if (!queryTermCount) return [];

  // 标题命中给一个明确的加成——问「麻婆豆腐辣不辣」时那条 chunk 必须排第一。
  // 菜名是用户问题里最有信息量的锚点，权重必须压过「问答速查」这类泛化条目。
  //
  // 注意知识库里的标题常带修饰（「泰式冬阴功」「蒜蓉炒时蔬」），而用户只说
  // 「冬阴功」「炒时蔬」，所以要双向判断：用户提到了标题，或标题的核心词
  // 出现在问题里。只做单向 indexOf 会漏掉一大类。
  const qLower = String(query || '').toLowerCase();
  const titleHits = idx.docs.map(d => {
    const title = d.title.toLowerCase();
    if (!title) return false;
    if (qLower.indexOf(title) >= 0) return true;

    // 标题去掉常见前缀/后缀后，看核心词是否被提到
    const core = title.replace(/^(泰式|日式|粤式|川味|家常|经典|秘制)/, '')
      .replace(/(汤|粉|饭|面|菜)$/, '');
    if (core && core !== title && core.length >= 2 && qLower.indexOf(core) >= 0) return true;

    // 反向：问题里的菜名是不是标题的一部分（「干炒牛河」⊂「干炒牛河」直接命中；
    // 「冬阴功」⊂「泰式冬阴功」也要算）
    const m = qLower.match(/[\u4e00-\u9fa5]{2,8}/g) || [];
    return m.some(seg => seg.length >= 3 && title.indexOf(seg) >= 0);
  });

  const scored = scores.map((s, i) => {
    // 标题命中是强信号：用户明确说出了某个条目名，那这条必须压过任何
    // 靠零散词项堆分堆上来的泛化条目（「常见问答速查」这类）。
    // 加成取 25，高于实测中泛化条目的 BM25 上限（约 22）。
    if (titleHits[i]) return { i, s: s + 25, ok: true };

    // 相关性闸门：命中问题词项太少，或只蒙到单字，一律不算
    const cov = covered[i] / queryTermCount;
    const hasStrong = bigramHit[i] > 0 || (qBigrams.length === 0 && covered[i] >= 1);
    if (!hasStrong || cov < 0.34) return { i, s: -1, ok: false };

    let bonus = 0;
    (idx.docs[i].keywords || []).forEach(kw => {
      if (kw && kw.length >= 2 && qLower.indexOf(kw.toLowerCase()) >= 0) bonus += 1.5;
    });
    return { i, s: s + bonus, ok: true };
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

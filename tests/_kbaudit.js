/**
 * 体积与检索质量评估（扩到 700+ 道菜后必跑）
 * ------------------------------------------------------------------
 * 关注三件事：
 *   1. kb-data.js 体积 —— 小程序主包 2MB 硬限制，SDK 已占 170KB；
 *   2. 检索质量 —— 语料放大 27 倍后，BM25 的 IDF 与闸门阈值是否还成立；
 *   3. 首屏开销 —— 索引是懒构建的，但 tokenize 727 条 chunk 的耗时要知道量级。
 *
 * 用法：node tests/_kbaudit.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KB_FILE = path.join(ROOT, 'miniprogram', 'utils', 'kb-data.js');

const KB = require(KB_FILE);
const rag = require(path.join(ROOT, 'miniprogram', 'utils', 'rag.js'));

const lines = [];
function say(s) { lines.push(s); }

/* ---------- 1. 体积 ---------- */
const bytes = fs.statSync(KB_FILE).size;
const raw = fs.readFileSync(KB_FILE, 'utf8');
say('== 体积 ==');
say('kb-data.js        ' + (bytes / 1024).toFixed(0) + ' KB（' + bytes + ' B）');
say('chunk 数          ' + KB.chunks.length);

// 估算：如果 JSON 紧凑（去掉缩进），能省多少
const compactLen = 'module.exports = ' + JSON.stringify({ version: KB.version, chunks: KB.chunks }) + ';';
say('紧凑 JSON 估算     ' + (Buffer.byteLength(compactLen, 'utf8') / 1024).toFixed(0) + ' KB');
say('缩进浪费           ' + ((bytes - Buffer.byteLength(compactLen, 'utf8')) / 1024).toFixed(0) + ' KB');

// keywords 占比
let kwLen = 0, textLen = 0, titleLen = 0;
KB.chunks.forEach(c => {
  kwLen += JSON.stringify(c.keywords || []).length;
  textLen += c.text.length;
  titleLen += c.title.length;
});
say('keywords 字段占用  ' + (kwLen / 1024).toFixed(0) + ' KB');
say('text 字段占用      ' + (textLen * 3 / 1024).toFixed(0) + ' KB（按 UTF-8 中文 3 字节）');

/* ---------- 2. 索引构建耗时 ---------- */
say('');
say('== 索引构建 ==');
const t0 = Date.now();
rag.search('宫保鸡丁含花生吗', 3);   // 触发懒构建
const buildMs = Date.now() - t0;
say('首次构建 + 单次检索 ' + buildMs + ' ms');

const t1 = Date.now();
for (let i = 0; i < 20; i++) rag.search('麻婆豆腐辣不辣', 3);
say('后续单次检索       ' + ((Date.now() - t1) / 20).toFixed(2) + ' ms');

/* ---------- 3. 检索质量 ---------- */
say('');
say('== 检索质量 ==');

// 期望：[问题, 期望命中的标题片段或内容片段...]
// 后半段是「语义题」——问的是人群禁忌 / 点单策略，答案在知识库的说明性条目里，
// 标题自然对不上菜名，只要召回的资源里确实含答案关键词就算通过。
const CONTENT = {
  '孕妇能吃生鱼片吗': ['孕妇', '生食'],
  '痛风能吃海鲜吗': ['痛风', '嘌呤'],
  '三个人三百块怎么点菜': ['点单', '搭配'],
  '减脂期能点什么': ['减脂'],
  '有什么不辣的川菜': ['不辣'],
  '小孩适合吃什么': ['儿童'],
  '对花生过敏要避开什么': ['花生']
};

const CASES = [
  ['宫保鸡丁含花生吗', '宫保鸡丁'],
  ['麻婆豆腐辣不辣', '麻婆豆腐'],
  ['白切鸡是什么味道', '白切鸡'],
  ['冬阴功是什么味道', '冬阴功'],
  ['寿司拼盘过敏原有哪些', '寿司拼盘'],
  ['干炒牛河用什么做的', '干炒牛河'],
  ['蒜泥白肉肥不肥', '蒜泥白肉'],
  ['水煮鱼有多辣', '水煮鱼'],
  ['可乐鸡翅怎么做', '可乐鸡翅'],
  ['番茄炒蛋含鸡蛋吗', '番茄炒蛋'],
  ['佛跳墙大概多少钱', '佛跳墙'],
  ['东坡肉是哪里的菜', '东坡肉'],
  ['松鼠鳜鱼是苏菜吗', '松鼠鳜鱼'],
  ['锅包肉是东北菜吗', '锅包肉'],
  ['过桥米线是什么', '过桥米线'],
  ['肉夹馍含麸质吗', '肉夹馍'],
  ['提拉米苏含乳制品吗', '提拉米苏'],
  ['刺身含海鲜吗', '刺身'],
  ['麻辣香锅辣度多少', '麻辣香锅'],
  ['回锅肉用什么肉', '回锅肉'],
  ['酸菜鱼能吃吗', '酸菜鱼'],
  ['小笼包怎么吃', '小笼包'],
  ['虾饺含麸质吗', '虾饺'],
  ['蛋挞含乳制品吗', '蛋挞'],
  ['羊肉泡馍是西安的吗', '羊肉泡馍'],
  ['夫妻肺片辣不辣', '夫妻肺片'],
  ['地三鲜是哪里的菜', '地三鲜'],
  ['皮蛋豆腐含蛋吗', '皮蛋豆腐'],
  ['干煸四季豆是川菜吗', '干煸四季豆'],
  ['八大常见过敏原有哪些', '过敏原'],
  ['孕妇能吃生鱼片吗', null],
  ['痛风能吃海鲜吗', null],
  ['三个人三百块怎么点菜', null],
  ['减脂期能点什么', null],
  ['有什么不辣的川菜', null],
  ['小孩适合吃什么', null],
  ['对花生过敏要避开什么', null]
];

let pass = 0, fail = 0;
const fails = [];
CASES.forEach(([q, expect]) => {
  const hits = rag.search(q, 3);
  const titles = hits.map(h => h.title);
  const blob = titles.join(' ') + ' ' + hits.map(h => h.text).join(' ');

  let ok;
  if (expect) {
    ok = titles.some(t => t.indexOf(expect) >= 0 || expect.indexOf(t) >= 0);
  } else {
    const keys = CONTENT[q] || [];
    ok = hits.length > 0 && keys.some(k => blob.indexOf(k) >= 0);
  }
  if (ok) pass++;
  else { fail++; fails.push(q + '  →  ' + (titles.join(' / ') || '(无召回)')); }
});
say('命中 ' + pass + '/' + (pass + fail));
fails.forEach(f => say('   x ' + f));

/* ---------- 4. 不应召回 ---------- */
say('');
say('== 无关问题不应召回 ==');
const NOISE = ['今天股市怎么样', '明天天气如何', '帮我写一段 Python 代码', '怎么学英语', '香港旅游攻略'];
let noiseOk = 0;
NOISE.forEach(q => {
  const hits = rag.search(q, 3);
  if (!hits.length) noiseOk++;
  else say('   x 「' + q + '」误召回 → ' + hits.map(h => h.title + '(' + h.score + ')').join(' / '));
});
say('正确拒绝 ' + noiseOk + '/' + NOISE.length);

/* ---------- 5. 输出 ---------- */
const out = path.join(__dirname, '_kbaudit.txt');
fs.writeFileSync(out, lines.join('\n'), 'utf8');
console.log(lines.join('\n'));

if (fail > 0 || noiseOk < NOISE.length) process.exit(1);

/**
 * 知识库构建脚本
 * ------------------------------------------------------------------
 * 把 knowledge/*.md 编译成 miniprogram/utils/kb-data.js，
 * 让小程序离线也能做 RAG 检索（不依赖任何向量数据库服务）。
 *
 * 为什么不用云端知识库：
 *   1. 语料只有几十条，本地 BM25 检索质量足够，且零延迟、零成本；
 *   2. 断网/降级时仍然可用——知识库不该是联网才有的能力；
 *   3. 检索结果直接拼进 prompt，模型负责「用」知识，不负责「记」知识。
 *
 * 用法：
 *   node tools/build-kb.js
 *   node tools/build-kb.js --check   # 只校验是否已是最新，不写文件
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KB_DIR = path.join(ROOT, 'knowledge');
const OUT = path.join(ROOT, 'miniprogram', 'utils', 'kb-data.js');

/** 按 `## 标题` 切 chunk；`---` 是分隔符不算内容 */
function splitChunks(md, source) {
  const lines = md.split(/\r?\n/);
  const chunks = [];
  let cur = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      if (cur) chunks.push(cur);
      cur = { title: h2[1].trim(), source, lines: [] };
      continue;
    }
    if (!cur) continue;                 // 文件头的说明文字不进 chunk
    if (/^---+\s*$/.test(line)) continue;
    cur.lines.push(line);
  }
  if (cur) chunks.push(cur);

  return chunks
    .map(c => {
      const body = c.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
      return { title: c.title, source: c.source, text: body };
    })
    .filter(c => c.text.length > 0);
}

/** 从 chunk 里抽关键词，方便检索时加权（菜名、食材、过敏原等专有名词） */
function extractKeywords(chunk) {
  const kw = new Set();
  const blob = chunk.title + '\n' + chunk.text;

  // 表格里「主要食材」那一行的值
  const ing = blob.match(/主要食材\s*\|\s*(.+?)\s*\|/);
  if (ing) ing[1].split(/[、,，]/).forEach(x => x.trim() && kw.add(x.trim()));

  // 过敏原
  const al = blob.match(/过敏原\s*\|\s*(.+?)\s*\|/);
  if (al) al[1].split(/[、,，]/).forEach(x => x.trim() && x.trim() !== '无' && kw.add(x.trim()));

  // 菜系
  const cu = blob.match(/菜系\s*\|\s*(.+?)\s*\|/);
  if (cu) kw.add(cu[1].trim());

  return Array.from(kw).slice(0, 12);
}

function build() {
  const files = fs.readdirSync(KB_DIR).filter(f => f.endsWith('.md')).sort();
  const all = [];
  const meta = [];

  for (const f of files) {
    const md = fs.readFileSync(path.join(KB_DIR, f), 'utf8');
    const chunks = splitChunks(md, f);
    meta.push({ file: f, chunks: chunks.length });
    for (const c of chunks) {
      all.push({
        id: f.replace(/\.md$/, '') + '#' + all.length,
        title: c.title,
        source: c.source,
        text: c.text,
        keywords: extractKeywords(c)
      });
    }
  }

  const body = [
    '/**',
    ' * 知识库数据（自动生成，勿手工编辑）',
    ' * ------------------------------------------------------------------',
    ' * 来源：knowledge/*.md',
    ' * 生成：node tools/build-kb.js',
    ' * 共 ' + all.length + ' 条 chunk，来自 ' + files.length + ' 个文档。',
    ' */',
    'module.exports = {',
    '  version: ' + JSON.stringify(new Date().toISOString().slice(0, 10)) + ',',
    '  chunks: ' + JSON.stringify(all, null, 2).replace(/\n/g, '\n  '),
    '};',
    ''
  ].join('\n');

  return { body, count: all.length, meta };
}

const checking = process.argv.includes('--check');
const { body, count, meta } = build();

if (checking) {
  const old = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  const same = old.trim() === body.trim();
  console.log('[kb] ' + (same ? '已是最新' : '需要重建') + '，共 ' + count + ' 条 chunk');
  meta.forEach(m => console.log('     ' + m.file + ' → ' + m.chunks + ' 条'));
  process.exit(same ? 0 : 1);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, body, 'utf8');
console.log('[kb] 已生成 ' + path.relative(ROOT, OUT) + '，共 ' + count + ' 条 chunk');
meta.forEach(m => console.log('     ' + m.file + ' → ' + m.chunks + ' 条'));

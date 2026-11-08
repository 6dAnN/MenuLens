/**
 * 构建 H5 demo 的知识库模块（demo/kb.js）
 * ------------------------------------------------------------------
 * 为什么要构建而不直接 require：
 *   H5 demo 必须能**双击 index.html 直接打开**。浏览器在 file:// 下会拦截
 *   ES module，也会拦截 XHR 读本地 JSON，所以数据必须编译进一个普通
 *   <script> 能加载的 IIFE 文件，挂到 window.MenuLensKB 上。
 *
 * 检索逻辑不在本脚本里重写，而是**内联 miniprogram/utils/rag.js 的实现**——
 * 两个前端必须算法同源，否则「小程序搜得到、H5 搜不到」这种问题查不完。
 * 做法是：读 rag.js 源码 → 去掉 CommonJS 头尾 → 包进 IIFE。
 * 因此 rag.js 顶部的 `require('./kb-data.js')` 会换成对本地 KB 的引用。
 *
 * 运行：node tools/build-demo-kb.js
 * 输出：demo/kb.js
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KB_FILE = path.join(ROOT, 'miniprogram', 'utils', 'kb-data.js');
const RAG_FILE = path.join(ROOT, 'miniprogram', 'utils', 'rag.js');
const OUT_FILE = path.join(ROOT, 'demo', 'kb.js');

// 1) 加载并序列化知识库数据
delete require.cache[require.resolve(KB_FILE)];
const KB = require(KB_FILE);

const compact = JSON.stringify(KB.chunks, null, 0);   // 不缩进，省 77KB

// 2) 取 rag.js 的实现体，去掉模块语法
let ragSrc = fs.readFileSync(RAG_FILE, 'utf8');

// 头部的 require 换成内部变量
ragSrc = ragSrc.replace(/^const KB = require\('\.\/kb-data\.js'\);\s*$/m, '');
// 尾部的 module.exports 去掉
ragSrc = ragSrc.replace(/module\.exports\s*=\s*\{[\s\S]*?\};?\s*$/m, '');

if (/require\(/.test(ragSrc)) {
  const bad = ragSrc.match(/.*require\(.*/g);
  throw new Error('rag.js 里还有未处理的 require，需要更新本构建脚本：\n' + bad.join('\n'));
}
if (/module\.exports/.test(ragSrc)) {
  throw new Error('rag.js 里还有 module.exports，需要更新本构建脚本');
}

const banner = `/**
 * MenuLens · 本地知识库检索（H5 版，自动生成勿手改）
 * ------------------------------------------------------------------
 * 生成：node tools/build-demo-kb.js
 * 来源：miniprogram/utils/rag.js（检索算法）+ miniprogram/utils/kb-data.js（语料）
 *
 * 算法与小程序端完全同源：中文「单字 + bigram」双路索引 + BM25，
 * 三道相关性闸门（命中率 / bigram / 标题锚点）+ 意图闸门 + 同义词扩展。
 * 语料 ${KB.chunks.length} 条，编译进文件，断网可用，不依赖任何网络请求。
 */
`;

const code = banner +
  'var MenuLensKB = (function () {\n' +
  "'use strict';\n\n" +
  '/* ---------- 语料（由 tools/build-kb.js 生成） ---------- */\n' +
  'var KB = { version: ' + JSON.stringify(KB.version) + ', chunks: ' + compact + ' };\n\n' +
  '/* ---------- 检索实现（来自 miniprogram/utils/rag.js） ---------- */\n' +
  ragSrc + '\n' +
  'return { tokenize: tokenize, search: search, buildContext: buildContext, stats: stats };\n' +
  '})();\n\n' +
  "if (typeof window !== 'undefined') window.MenuLensKB = MenuLensKB;\n";

fs.writeFileSync(OUT_FILE, code, 'utf8');

const bytes = Buffer.byteLength(code, 'utf8');
console.log('[demo-kb] 已生成 demo/kb.js');
console.log('          语料 ' + KB.chunks.length + ' 条，文件 ' + Math.round(bytes / 1024) + ' KB');

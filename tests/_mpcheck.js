/**
 * 小程序工程静态校验
 * 1) 所有 .js 语法可编译
 * 2) app.json / 各 page.json 合法
 * 3) pages 中列出的页面文件齐全
 * 4) usingComponents 指向的组件存在
 * 5) require 的模块存在
 * 6) WXML 里的 data-act / bindtap 关键元素能在 js 中找到处理函数
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const cp = require('child_process');

// ---------- 定位 git 可执行文件 ----------
// 不能直接用 execSync('git ...')：Windows 上会经过 cmd.exe，
// 中文路径会被 GBK 编码搞坏，报 "Command failed"；execFileSync 又要求
// git 在 PATH 里，而很多机器上 git 只装了但没进 Node 的 PATH。
// 所以这里显式探测常见安装位置。
function findGit() {
  const env = process.env.GIT_PATH;
  if (env && fs.existsSync(env)) return env;
  const cands = [
    'C:\\Program Files\\Git\\cmd\\git.exe',
    'C:\\Program Files\\Git\\bin\\git.exe',
    'C:\\Program Files (x86)\\Git\\cmd\\git.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'cmd', 'git.exe')
  ].filter(Boolean);
  for (const c of cands) if (fs.existsSync(c)) return c;
  return null;   // 交由 PATH 兜底
}
const GIT = findGit();

function gitOut(args, cwd) {
  try {
    const opts = { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] };
    if (GIT) return cp.execFileSync(GIT, args, opts);
    return cp.execSync('git ' + args.join(' '), opts);
  } catch (e) {
    return null;
  }
}

const ROOT = path.resolve(__dirname, '..', 'miniprogram');
const out = [];
let errCount = 0;
const err = m => { out.push('  [FAIL] ' + m); errCount++; };
const ok = m => out.push('  [OK] ' + m);

// ---------- 1. JS 语法 ----------
out.push('== 1. JS 语法 ==');
function walk(dir, exts) {
  let files = [];
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    const st = fs.statSync(p);
    if (st.isDirectory()) files = files.concat(walk(p, exts));
    else if (exts.some(e => f.endsWith(e))) files.push(p);
  }
  return files;
}
const jsFiles = walk(ROOT, ['.js']).filter(f => {
  // 跳过 node_modules（第三方 SDK 产物，不是我们的代码）
  if (f.indexOf('node_modules') >= 0) return false;
  // 跳过内置的 SDK bundle（压缩产物，单独用 _cloudcheck.js 验证）
  if (path.basename(f) === 'wb-sdk.js') return false;
  return true;
});
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  try {
    new vm.Script(src, { filename: path.basename(f) });
    ok(path.relative(ROOT, f));
  } catch (e) {
    err(path.relative(ROOT, f) + ' → ' + e.message);
  }
}

// ---------- 2. JSON 合法性 ----------
out.push('');
out.push('== 2. JSON 合法性 ==');
const jsonFiles = walk(ROOT, ['.json']).filter(f => f.indexOf('node_modules') < 0);
for (const f of jsonFiles) {
  try { JSON.parse(fs.readFileSync(f, 'utf8')); ok(path.relative(ROOT, f)); }
  catch (e) { err(path.relative(ROOT, f) + ' → ' + e.message); }
}

// ---------- 3. 页面文件齐全 ----------
out.push('');
out.push('== 3. 页面文件齐全 ==');
const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'app.json'), 'utf8'));
const { pages, tabBar, usingComponents } = appJson;
const declaredPages = pages.slice();
(tabBar.list || []).forEach(t => {
  if (declaredPages.indexOf(t.pagePath) < 0) declaredPages.push(t.pagePath);
});

// app.json 里 pages 之外的页面（被 navigateTo 访问的）
const extraPages = ['pages/plan/plan', 'pages/history/history', 'pages/settings/settings'];

for (const p of declaredPages.concat(extraPages)) {
  const base = path.join(ROOT, p);
  const exists = ['.js', '.wxml', '.wxss', '.json'].every(ext => fs.existsSync(base + ext));
  exists ? ok(p) : err('页面文件不完整: ' + p);
}

// 页面必须在 app.json 或被正确 navigateTo
out.push('');
out.push('== 4. 页面注册一致性 ==');
for (const p of extraPages) {
  declaredPages.indexOf(p) >= 0
    ? out.push('  [OK] ' + p + ' 已在 app.json 注册')
    : out.push('  [NOTE] ' + p + ' 未在 app.json 注册（仅通过 navigateTo 进入，不出现在 tabBar）');
}

// ---------- 5. usingComponents ----------
out.push('');
out.push('== 5. usingComponents 指向存在 ==');
function checkComponents(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) { checkComponents(p); continue; }
    if (!f.endsWith('.json')) continue;
    let j;
    try { j = JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { continue; }
    const uc = j.usingComponents || {};
    for (const [name, target] of Object.entries(uc)) {
      // 绝对路径以 / 开头，相对路径以 ../ 开头
      const base = target.startsWith('/')
        ? path.join(ROOT, target)
        : path.resolve(path.dirname(p), target);
      const stem = base.replace(/\.json$/, '');
      const all = ['.js', '.wxml', '.wxss', '.json'].every(ext => fs.existsSync(stem + ext));
      all ? ok(path.relative(ROOT, p) + ' → ' + name + ' (' + target + ')')
          : err(path.relative(ROOT, p) + ' → ' + name + ' (' + target + ') 文件缺失');
    }
  }
}
checkComponents(ROOT);

// ---------- 6. require 路径 ----------
out.push('');
out.push('== 6. require 路径存在 ==');
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  const re = /require\(['"]([^'"]+)['"]\)/g;
  let m;
  while ((m = re.exec(src))) {
    if (!m[1].startsWith('.')) continue;
    const target = path.resolve(path.dirname(f), m[1]);
    const exists = fs.existsSync(target) ||
                   fs.existsSync(target + '.js') ||
                   fs.existsSync(path.join(target, 'index.js'));
    exists ? ok(path.relative(ROOT, f) + ' → ' + m[1])
            : err(path.relative(ROOT, f) + ' → ' + m[1] + ' 找不到');
  }
}

// ---------- 7. WXML 事件处理函数存在 ----------
out.push('');
out.push('== 7. WXML 事件处理函数存在 ==');
for (const f of walk(ROOT, ['.wxml'])) {
  const wxml = fs.readFileSync(f, 'utf8');
  const jsFile = f.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(jsFile)) continue;
  const js = fs.readFileSync(jsFile, 'utf8');
  const handlers = new Set();
  let m;
  const re = /(?:bind|catch)(?::)?[a-zA-Z]+\s*=\s*["']([a-zA-Z_$][\w$]*)["']/g;
  while ((m = re.exec(wxml))) handlers.add(m[1]);
  // 自定义组件事件
  const re2 = /bind:[a-zA-Z]+\s*=\s*["']([a-zA-Z_$][\w$]*)["']/g;
  while ((m = re2.exec(wxml))) handlers.add(m[1]);

  const missing = [...handlers].filter(h => !new RegExp('\\b' + h + '\\s*[(:]').test(js));
  if (missing.length) err(path.relative(ROOT, f) + ' 缺少处理函数: ' + missing.join(', '));
  else ok(path.relative(ROOT, f) + ' (' + handlers.size + ' 个事件)');
}

// ---------- 8. WXML 数据字段粗查 ----------
out.push('');
out.push('== 8. WXML 中引用的顶层 data 字段 ==');
for (const f of walk(ROOT, ['.wxml'])) {
  const wxml = fs.readFileSync(f, 'utf8');
  const jsFile = f.replace(/\.wxml$/, '.js');
  if (!fs.existsSync(jsFile)) continue;
  const js = fs.readFileSync(jsFile, 'utf8');
  const fields = new Set();
  let m;
  const re = /\{\{([a-zA-Z_$][\w$]*)/g;
  while ((m = re.exec(wxml))) fields.add(m[1]);
  const reserved = new Set(['item', 'index', 'i', 'dish', 'true', 'false', 'null', 'undefined']);
  const missing = [...fields].filter(fld =>
    !reserved.has(fld) &&
    !new RegExp('\\b' + fld + '\\s*:').test(js) &&
    !new RegExp('\\b' + fld + '\\s*=').test(js)
  );
  if (missing.length) out.push('  [WARN] ' + path.relative(ROOT, f) + ' 未在 js 中定义: ' + missing.join(', '));
  else ok(path.relative(ROOT, f) + ' (' + fields.size + ' 个字段)');
}

// ---------- 9. 云服务接入规范 ----------
out.push('');
out.push('== 9. 云服务接入规范 ==');
const cloudSrc = fs.readFileSync(path.join(ROOT, 'utils', 'cloud.js'), 'utf8');

// 9.1 endpoint 与 publishableKey 必须同时出现，且不能硬编码其他域名
const hasEndpoint = /endpoint\s*:\s*PUBLIC_CONFIG\.endpoint/.test(cloudSrc) ||
                    /endpoint\s*:\s*PUBLIC_CONFIG\['endpoint'\]/.test(cloudSrc);
const hasKey = /publishableKey\s*:\s*PUBLIC_CONFIG\.publishableKey/.test(cloudSrc) ||
               /publishableKey\s*:\s*PUBLIC_CONFIG\['publishableKey'\]/.test(cloudSrc);
hasEndpoint ? ok('create* 调用传了 publicConfig.endpoint') : err('create* 调用缺 endpoint');
hasKey ? ok('create* 调用传了 publicConfig.publishableKey') : err('create* 调用缺 publishableKey');

// 不允许出现别的 workbuddy 域名（endpoint 只能来自 publicConfig）
// 9.1 仓库【已提交版本】里不得出现真实云服务域名 / 真实 publishableKey
//     机制：凭证统一放 utils/cloud-config.js，工作区（= 本机）里填真实值，
//     已提交版本保存占位值；本机用 skip-worktree 保护改动不被提交。
//
//     所以判定对象是「git 仓库里存的内容」，不是当前磁盘状态——
//     后者本来就该是真实凭证才能跑通云端。
const domainHits = [];
const keyHits = [];

function scanCommitted(relPath) {
  const committed = gitOut(['show', 'HEAD:' + relPath], path.join(ROOT, '..'));
  if (committed === null) return null;   // 该文件尚未提交，跳过
  // 去掉注释，只看代码
  const code = committed.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const u of (code.match(/https?:\/\/[a-z0-9.-]+/gi) || [])) {
    if (!/workbuddy/i.test(u)) continue;
    if (!/your|placeholder|example/i.test(u)) domainHits.push(relPath + ': ' + u);
  }
  for (const k of (code.match(/wbpk_[A-Za-z0-9_]{16,}/g) || [])) {
    keyHits.push(relPath + ': ' + k.slice(0, 12) + '…');
  }
  return committed;
}

// 所有入库的 js 都查一遍
let checked = 0;
const lsOut = gitOut(['ls-files', '*.js'], path.join(ROOT, '..'));
const jsList = lsOut
  ? lsOut.split('\n').map(s => s.trim()).filter(Boolean)
  : [];
for (const rel of jsList) {
  if (rel.indexOf('wb-sdk.js') >= 0) continue;   // SDK 官方产物跳过
  if (rel.indexOf('tests/') === 0 || rel.indexOf('tests\\') === 0) continue;  // 测试桩 key 不算真实凭证
  if (scanCommitted(rel) !== null) checked++;
}

if (!GIT && !lsOut) {
  out.push('  [SKIP]  未找到 git，跳过版本历史检查');
} else {
  domainHits.length === 0
    ? ok('已提交版本里没有真实云服务域名（' + checked + ' 个 js 全为占位值）')
    : err('已提交版本含疑似真实域名: ' + [...new Set(domainHits)].join(', '));

  keyHits.length === 0
    ? ok('已提交版本里没有真实 publishableKey')
    : err('已提交版本含疑似真实 publishableKey: ' + [...new Set(keyHits)].join(', '));
}

// 9.2 前端不得出现服务端密钥
const secretish = [];
for (const f of jsFiles) {
  if (f.indexOf('wb-sdk.js') >= 0) continue;      // SDK 自身产物跳过
  const src = fs.readFileSync(f, 'utf8');
  const hits = src.match(/Bearer\s+[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9]{16,}|app-[A-Za-z0-9]{12,}/g);
  if (hits) secretish.push(path.relative(ROOT, f) + ': ' + hits.join(','));
}
secretish.length === 0 ? ok('未发现服务端密钥/Bearer token') : err('疑似密钥: ' + secretish.join(' | '));

// 9.3 每个 chat.completions.create 调用都必须有 system 首条消息
//     （cloud.js 统一封装了 system 注入，这里检查调用方是否传了 system）
let cc = 0;
for (const f of jsFiles) {
  if (f.indexOf('wb-sdk.js') >= 0) continue;
  const src = fs.readFileSync(f, 'utf8');
  const re = /cloud\.chat\(\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    cc++;
    const seg = src.slice(m.index, m.index + 400);
    if (!/system\s*:/.test(seg)) err(path.relative(ROOT, f) + ' cloud.chat 调用缺 system');
  }
}
cc === 0
  ? err('未找到 cloud.chat 调用——云服务接入层可能没被用上')
  : ok(cc + ' 处 cloud.chat 调用均带 system');

// 9.4 绝不能手写 /.cloud/ 路径或 BFF 代理
let manual = [];
for (const f of jsFiles) {
  if (f.indexOf('wb-sdk.js') >= 0) continue;
  const src = fs.readFileSync(f, 'utf8');
  if (/\/\.cloud\//.test(src)) manual.push(path.relative(ROOT, f));
}
manual.length === 0
  ? ok('未手写 /.cloud/ 路径（全部走 SDK）')
  : err('手写了 /.cloud/ 路径，应改用 SDK 方法: ' + manual.join(', '));

// 9.5 页面不得直接 require 具体引擎，必须走 engine.js 统一入口
out.push('');
out.push('== 10. 页面引擎入口统一 ==');
for (const f of walk(path.join(ROOT, 'pages'), ['.js'])) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(ROOT, f);
  if (/require\(['"]\.\.\/\.\.\/utils\/(api|ai-cloud)\.js['"]\)/.test(src)) {
    err(rel + ' 直接 require 了具体引擎，应改为 utils/engine.js');
  } else if (/require\(['"]\.\.\/\.\.\/utils\/engine\.js['"]\)/.test(src)) {
    ok(rel);
  }
}

// 9.6 过敏原硬过滤必须在代码层，且不能被交给模型
out.push('');
out.push('== 11. 过敏原硬过滤在代码层 ==');
const plannerSrc = fs.readFileSync(path.join(ROOT, 'utils', 'planner.js'), 'utf8');
plannerSrc.includes('function hardFilter')
  ? ok('planner.hardFilter 存在')
  : err('planner.hardFilter 缺失');
const cloudAISrc = fs.readFileSync(path.join(ROOT, 'utils', 'ai-cloud.js'), 'utf8');
/hardFilter\(items,\s*ctx\)/.test(cloudAISrc)
  ? ok('云服务方案生成前调用了 hardFilter')
  : err('云服务方案生成未调用 hardFilter——过敏原过滤不能交给模型');

// ---------- 汇总 ----------
out.unshift('小程序工程校验：' + (errCount ? errCount + ' 个问题' : ' 全部通过') + '\n');

fs.writeFileSync(path.join(ROOT, '..', 'tests', '_mpcheck.txt'), out.join('\n'), 'utf8');
console.log('done, errors=' + errCount);
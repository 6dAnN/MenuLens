/**
 * Dify 服务层契约验证（Node + wx 桩，不联网）
 * ------------------------------------------------------------------
 * 验证 utils/dify-service.js 的：
 *   1. isConfigured 占位判断
 *   2. recognizeDish 未配置时降级
 *   3. chat 未配置时降级本地
 *   4. parseSSE / decodeChunk 正确解析流式帧（含中文）
 *   5. callDishWorkflow / callChatflow 请求契约（URL/header/body）
 */
const path = require('path');
const fs = require('fs');

const MP = path.resolve(__dirname, '..', 'miniprogram');
// Dify 已降级为备选方案（页面不再引用），服务层在 utils/ 下保留为 *.backup.js，测试仍覆盖它
const DIFY = path.join(MP, 'utils');
const REPORT = path.join(__dirname, '_difysvc.txt');
const out = [];
const ok = m => out.push('  PASS  ' + m);
const bad = m => { out.push('  FAIL  ' + m); process.exitCode = 1; };

/* ---- wx 桩 ---- */
global.wx = {
  request(opts) {
    global.__lastRequest = opts;
    const task = {
      onChunkReceived: null
    };
    // 模拟成功响应
    if (opts._mockSuccess) opts.success(opts._mockSuccess);
    return task;
  },
  getFileSystemManager() {
    return { readFile(o) { o.success && o.success({ data: 'BASE64DATA' }); } };
  }
};

const dify = require(path.join(DIFY, 'dify-service.backup.js'));
const cfg = require(path.join(DIFY, 'dify-config.backup.js'));

async function main() {
  /* ---- 1. isConfigured 占位判断 ---- */
  out.push('== 1. 配置占位判断 ==');
  if (dify.isConfigured() === false) ok('占位值正确判定为「未配置」');
  else bad('占位值未被识别，isConfigured 应返回 false');

  const host = cfg.difyDishEndpoint || '';
  if (host.indexOf('YOUR-DIFY-HOST') >= 0) ok('dish endpoint 为占位值');
  else bad('dish endpoint 疑似填了真实值（入库应为占位）');

  const key = cfg.difyDishKey || '';
  if (key.indexOf('YOUR_') >= 0) ok('dish key 为占位值');
  else bad('dish key 疑似填了真实值');

  const chatKey = cfg.difyChatKey || '';
  if (chatKey.indexOf('YOUR_') >= 0) ok('chat key 为占位值');
  else bad('chat key 疑似填了真实值');

  /* ---- 2. 识菜降级 ---- */
  out.push('== 2. 识菜降级 ==');
  const d1 = await dify.recognizeDish(null, { name: 'MOCK', source: 'mock' });
  if (d1.name === 'MOCK') ok('未配置时 recognizeDish 返回 mock 兜底');
  else bad('recognizeDish 未正确降级');

  const d2 = await dify.recognizeDish('AAAA', { name: 'MOCK2' });
  if (d2.name === 'MOCK2') ok('传 base64 但未配置时仍降级');
  else bad('传 base64 未配置时未降级');

  /* ---- 3. chat 降级 ---- */
  out.push('== 3. chat 降级 ==');
  const r = await dify.chat('麻婆豆腐辣不辣', { servings: 2, budget: 200, avoid: [] }, null, [], '', null);
  if (r && r.remote === false) ok('未配置时 chat 降级到本地（remote=false）');
  else bad('chat 未正确降级');

  /* ---- 4. parseSSE / decodeChunk ---- */
  out.push('== 4. SSE 解析 ==');
  const sseText = 'event: message\ndata: {"event":"message","answer":"麻辣"}\n\nevent: message\ndata: {"event":"message","answer":"鲜香","conversation_id":"abc"}\n\nevent: message_end\ndata: {"event":"message_end"}\n\n';
  const events = dify.parseSSE(sseText);
  if (events.length === 3) ok('parseSSE 切出 3 帧');
  else bad('parseSSE 帧数错误: ' + events.length);

  const answers = events.filter(e => e.event === 'message').map(e => JSON.parse(e.data).answer).join('');
  if (answers === '麻辣鲜香') ok('中文流式文本拼接正确');
  else bad('中文拼接错误: ' + answers);

  const buf = Buffer.from('麻辣豆腐', 'utf8');
  const decoded = dify.decodeChunk(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  if (decoded === '麻辣豆腐') ok('decodeChunk 中文 UTF-8 解码正确');
  else bad('decodeChunk 解码错误: ' + decoded);

  /* ---- 5. 请求契约 ---- */
  out.push('== 5. 请求契约 ==');
  const realCfg = {
    difyDishEndpoint: 'https://api.dify.ai/v1/workflows/run',
    difyDishKey: 'app-test123',
    difyChatEndpoint: 'https://api.dify.ai/v1/chat-messages',
    difyChatKey: 'app-test456'
  };
  // 直接测 callDishWorkflow / callChatflow 的请求构造（用真实格式配置 mock 内部 cfg）
  // 通过临时替换 require 缓存 + 重建 dify-service 模块来拿到真实配置路径
  const cfgPath = require.resolve(path.join(DIFY, 'dify-config.backup.js'));
  const svcPath = require.resolve(path.join(DIFY, 'dify-service.backup.js'));
  const origCfg = require.cache[cfgPath];
  const origSvc = require.cache[svcPath];
  require.cache[cfgPath] = { id: cfgPath, filename: cfgPath, loaded: true, exports: realCfg };
  delete require.cache[svcPath];
  const dify2 = require(path.join(DIFY, 'dify-service.backup.js'));

  // 识菜 workflow 请求契约
  global.__lastRequest = null;
  dify2.callDishWorkflow('BASE64DATA');
  const req1 = global.__lastRequest;
  if (req1) {
    if (req1.url === 'https://api.dify.ai/v1/workflows/run') ok('识菜 URL 正确');
    else bad('识菜 URL 错误: ' + req1.url);
    if (req1.header && req1.header.Authorization === 'Bearer app-test123') ok('识菜 Authorization 头正确');
    else bad('识菜 Authorization 头错误: ' + JSON.stringify(req1.header));
    if (req1.data && req1.data.inputs && req1.data.inputs.image === 'BASE64DATA') ok('识菜 body 含 image base64');
    else bad('识菜 body 缺少 image');
  } else {
    bad('识菜未发出请求');
  }

  // 小助手 chatflow 请求契约
  global.__lastRequest = null;
  dify2.callChatflow('麻婆豆腐辣不辣', '', null);
  const req2 = global.__lastRequest;
  if (req2) {
    if (req2.url === 'https://api.dify.ai/v1/chat-messages') ok('小助手 URL 正确');
    else bad('小助手 URL 错误: ' + req2.url);
    if (req2.data && req2.data.query === '麻婆豆腐辣不辣') ok('小助手 body query 正确');
    else bad('小助手 body query 错误');
    if (req2.data && req2.data.response_mode === 'streaming') ok('小助手 streaming 模式');
    else bad('小助手非 streaming');
    if (req2.data && !req2.data.conversation_id) ok('首轮不带 conversation_id');
    else bad('首轮不应带 conversation_id');
  } else {
    bad('小助手未发出请求');
  }

  // 多轮：带 conversation_id
  global.__lastRequest = null;
  dify2.callChatflow('那宫保鸡丁呢', 'conv_123', null);
  const req3 = global.__lastRequest;
  if (req3 && req3.data && req3.data.conversation_id === 'conv_123') ok('多轮携带 conversation_id');
  else bad('多轮未携带 conversation_id');

  // 恢复 require 缓存
  require.cache[cfgPath] = origCfg;
  require.cache[svcPath] = origSvc;

  finish();
}

function finish() {
  fs.writeFileSync(REPORT, out.join('\n'), 'utf8');
  console.log(out.join('\n'));
  process.exit(process.exitCode || 0);
}

main().catch(e => { bad('unexpected: ' + e.message); finish(); });

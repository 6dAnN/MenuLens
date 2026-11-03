/**
 * 云服务接入验证脚本（Node 环境下验证小程序集成的正确性）
 * ------------------------------------------------------------------
 * 目的：在不打开微信开发者工具的前提下，尽早发现集成错误。
 *
 * 小程序 require 与 Node CommonJS 语义基本一致，所以这里直接 require
 * SDK 的小程序产物，再用一个最小 fetch stub 打一次 models.list() 与一次
 * chat，验证：
 *   1. miniprogram 入口可加载、能拿到 createMiniProgramWorkBuddyCloud
 *   2. 初始化不抛异常、模块齐全
 *   3. 请求确实发得出去（核对 URL / header / body 是否符合契约）
 *   4. 流式解析能从 SSE 帧正确取到 content，且跳过 role 占位帧
 *
 * ⚠ 这里只验证「集成是否正确」，不代表验证了服务端真实返回。
 *   真实连通性需要在开发者工具或真机上点「测试连接」。
 */
const path = require('path');
const fs = require('fs');

const MP = path.resolve(__dirname, '..', 'miniprogram');
const PKG_BUNDLE = path.resolve(MP, 'node_modules', '@tencent-ai', 'workbuddy-cloud-sdk', 'miniprogram_dist', 'miniprogram.js');
const VENDORED = path.resolve(MP, 'utils', 'wb-sdk.js');
const REPORT = path.join(__dirname, '_cloudcheck.txt');

const out = [];
const ok = (m) => out.push('  PASS  ' + m);
const bad = (m) => { out.push('  FAIL  ' + m); process.exitCode = 1; };

/**
 * SDK 包声明了 "type":"module"，Node 不会把它的 .js 当 CommonJS 载入。
 * 微信开发者工具用自己的模块系统所以不受影响，但在这里验证时必须先
 * 转成 .cjs 才能 require——验证的仍然是同一份字节。
 */
function loadBundle() {
  if (!fs.existsSync(VENDORED)) return null;
  const tmp = path.join(require('os').tmpdir(), 'wb-sdk-verify.cjs');
  fs.copyFileSync(VENDORED, tmp);
  return require(tmp);
}

out.push('== 1. load SDK bundle (vendored) ==');
if (!fs.existsSync(VENDORED)) {
  bad('utils/wb-sdk.js missing');
  out.push('  The mini program would fall back to the local engine.');
  fs.writeFileSync(REPORT, out.join('\n'), 'utf8');
  process.exit(1);
}
ok('vendored bundle present (' + Math.round(fs.statSync(VENDORED).size / 1024) + ' KB)');

let sdk;
try {
  sdk = loadBundle();
  ok('bundle loads as CommonJS');
} catch (e) {
  bad('bundle load failed: ' + e.message);
  fs.writeFileSync(REPORT, out.join('\n'), 'utf8');
  process.exit(1);
}

out.push('  exports: ' + Object.keys(sdk).join(', '));
if (typeof sdk.createMiniProgramWorkBuddyCloud !== 'function') bad('createMiniProgramWorkBuddyCloud missing');
else ok('createMiniProgramWorkBuddyCloud present');

out.push('');
out.push('== 2. init client ==');
const captured = [];

/**
 * 小程序端 SDK 把请求体放在哪，取决于它怎么适配 wx.request —— 可能是 data，
 * 也可能是 header 里的字符串，甚至 enableChunked 之外的私有字段。
 * 这里不猜：直接把整个 opt 记录下来，再从所有字段里找出能解析成 JSON 的那个。
 */
function findPayload(rec) {
  const candidates = [rec.data, rec.payload, rec.body, rec.requestBody];
  for (const c of candidates) {
    if (!c) continue;
    if (typeof c === 'object') return c;
    if (typeof c === 'string') {
      try { return JSON.parse(c); } catch (e) { /* 继续找 */ }
    }
  }
  for (const v of Object.values(rec.header || {})) {
    if (typeof v === 'string' && v.trim().charAt(0) === '{') {
      try { return JSON.parse(v); } catch (e) { /* 继续找 */ }
    }
  }
  return null;
}

/**
 * 关键发现：小程序环境下 SDK 走的是 wx.request + RequestTask.onChunkReceived
 * 做流式分片，不是 fetch。所以这里必须按小程序真实机制打桩，
 * 否则测出来的路径和请求形状都不是小程序里实际会发生的。
 */
/**
 * 依据 SDK 内SSEDecoder / LineDecoder 的实现构造：
 *   · 帧以空行分隔（decode 收到 "" 才产出事件）
 *   · 事件之间用 \n\n
 *   · [DONE] 之后还要有一个收尾空行，否则最后一个事件不会被 flush
 */
function sseBody() {
  const frame = (o) => 'data: ' + JSON.stringify(o);
  return [
    frame({ choices: [{ delta: { role: 'assistant', content: '' } }] }),
    frame({ choices: [{ delta: { content: 'PART1-' } }] }),
    frame({ choices: [{ delta: { content: 'PART2' } }] }),
    frame({
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 11, completion_tokens: 2, total_tokens: 13 }
    }),
    'data: [DONE]',
    '',
    ''
  ].join('\n\n');
}

function makeWx() {
  const mem = new Map();
  return {
    getStorageSync: (k) => (mem.has(k) ? mem.get(k) : ''),
    setStorageSync: (k, v) => mem.set(k, v),
    removeStorageSync: (k) => mem.delete(k),
    getAccountInfoSync: () => ({ miniProgram: { envVersion: 'develop', version: '1.0.0' } }),
    getSystemInfoSync: () => ({ platform: 'devtools', SDKVersion: '3.0.0' }),
    getRandomValues: (n) => require('crypto').randomBytes(n),

    request(opt) {
      const url = String(opt.url || '');
      captured.push({ url, method: opt.method, header: opt.header || {}, data: opt.data, raw: opt });

      const isLlm = url.indexOf('/llm/') >= 0;
      const isModels = url.indexOf('/llm/models') >= 0;

      // wx.request 返回 RequestTask；分片走 onChunkReceived。
      // 依据 SDK 源码（createMiniProgramFetch）：回调收到的是 res.data 本身，
      // SDK 内部执行 b.push(new Uint8Array(res.data))，所以这里必须传裸 ArrayBuffer。
      const task = {
        onHeadersReceived(cb) {
          if (isLlm) cb({ header: { 'content-type': 'text/event-stream' } });
        },
        onChunkReceived(cb) {
          if (!isLlm) return;
          const buf = Buffer.from(sseBody(), 'utf8');
          // 刻意切成 3 块，验证 SDK 能跨分片正确拼接 SSE
          const size = Math.ceil(buf.length / 3);
          let off = 0;
          const push = () => {
            if (off >= buf.length) {
              // 分片推完后必须触发 wx.request 的 success，
              // SDK 才会 close 可读流，迭代器读到 done:true 正常收尾。
              if (!settled) {
                settled = true;
                if (opt.success) opt.success({ statusCode: 200, header: {}, data: '' });
                if (opt.complete) opt.complete();
              }
              return;
            }
            const slice = buf.slice(off, off + size);
            off += size;
            const ab = slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength);
            cb({ data: ab });
            setTimeout(push, 0);
          };
          setTimeout(push, 0);
        },
        abort() {}
      };
      let settled = false;

      setTimeout(() => {
        if (isModels) {
          const data = [{ id: 'auto', name: 'Auto', isDefault: true, enabled: true, supportsImages: true }];
          if (opt.success) opt.success({ statusCode: 200, header: {}, data });
          if (opt.complete) opt.complete();
        } else if (isLlm) {
          // LLM 分片流不在这里收尾——由 onChunkReceived 推完后触发 success
        } else {
          if (opt.success) opt.success({ statusCode: 200, header: {}, data: {} });
          if (opt.complete) opt.complete();
        }
      }, 0);

      return task;
    }
  };
}

global.wx = makeWx();

/**
 * 凭证从 utils/cloud-config.js 读，仓库里保存的是占位值。
 * 本机若用 skip-worktree 填了真实凭证，这里会读到真实值；
 * 契约验证只检查请求形状，不校验真实鉴权，占位值同样能跑完全流程。
 */
const CFG_FILE = path.join(MP, 'utils', 'cloud-config.js');
let CFG = { endpoint: 'https://placeholder.workbuddy.host', publishableKey: 'placeholder_key' };
if (fs.existsSync(CFG_FILE)) {
  try {
    CFG = require(CFG_FILE);
  } catch (e) {
    out.push('  WARN  config unreadable: ' + e.message);
  }
} else {
  out.push('  WARN  utils/cloud-config.js missing, using placeholder values');
}

let cloud;
try {
  cloud = sdk.createMiniProgramWorkBuddyCloud({
    endpoint: CFG.endpoint,
    publishableKey: CFG.publishableKey
  });
  ok('client constructed (wx stub supplied)');
} catch (e) {
  bad('constructor threw: ' + e.message);
}
out.push('  modules: ' + Object.keys(cloud || {}).join(', '));

(async () => {
  out.push('');
  out.push('== 3. models.list() ==');
  try {
    const models = await cloud.llm.models.list();
    const n = models ? models.length : 0;
    out.push('  model count: ' + n);
    if (Array.isArray(models) && n > 0) ok('catalog is a non-empty array');
    else bad('catalog empty or not an array (empty is legal but must be handled explicitly)');
  } catch (e) {
    bad('models.list failed: ' + e.message);
  }

  out.push('');
  out.push('== 4. chat.completions streaming ==');
  try {
    let acc = '';
    for await (const chunk of cloud.llm.chat.completions.create({
      model: 'auto',
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'ping' }
      ],
      stream: true,
      stream_options: { include_usage: true }
    })) {
      const d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta;
      if (d && d.content) acc += d.content;
    }
    out.push('  accumulated: ' + JSON.stringify(acc));
    if (acc === 'PART1-PART2') ok('SSE content accumulated, role placeholder frame skipped');
    else bad('stream parsing mismatch');
  } catch (e) {
    bad('chat call failed: ' + e.message);
  }

  out.push('');
  out.push('== 5. request contract ==');
  captured.forEach((c, i) => {
    out.push('  [' + i + '] ' + c.method + ' ' + c.url);
  });

  const llmReq = captured.find(c => c.url.indexOf('/llm/chat/completions') >= 0);
  if (llmReq) {
    // 断言「用的是配置里的 endpoint」，而不是某个写死的域名
    if (llmReq.url.indexOf(CFG.endpoint) >= 0) ok('uses publicConfig.endpoint, no hardcoded alternate domain');
    else bad('endpoint is not the publicConfig value');

    if (llmReq.url.indexOf('/.cloud/llm/chat/completions') >= 0) ok('hits /.cloud/llm/chat/completions');
    else bad('unexpected LLM path');

    const payload = findPayload(llmReq);
    if (payload) {
      if (payload.stream === true || payload.stream === 'true') ok('stream:true sent (required by the API)');
      else bad('stream:true missing (payload keys: ' + Object.keys(payload).join(',') + ')');

      const msgs = payload.messages || [];
      if (msgs.length && msgs[0] && msgs[0].role === 'system') ok('messages[0] is system (required)');
      else bad('no system message as messages[0]');
    } else {
      bad('could not locate request payload in the wx.request options');
    }

    const hasKey = Object.keys(llmReq.header || {}).some(k => /access-key/i.test(k));
    if (hasKey) ok('publishable key header present');
    else bad('publishable key header missing');

    // 绝不能把服务端密钥或 Bearer token 发出去
    const leaked = Object.keys(llmReq.header || {}).filter(k => /authorization|bearer|secret|appkey/i.test(k));
    if (leaked.length) bad('secret-looking headers leaked: ' + leaked.join(','));
    else ok('no Authorization/Bearer/secret headers leaked');
  } else {
    bad('no LLM chat request captured');
  }

  out.push('');
  out.push(process.exitCode ? '=== RESULT: FAILURES PRESENT ===' : '=== RESULT: ALL PASS ===');
  fs.writeFileSync(REPORT, out.join('\n'), 'utf8');
})();
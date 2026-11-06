/**
 * Node 侧 wx.request 桩 —— 让 utils/cloud.js 能在命令行里真跑
 * 仅用于测试与本地验证，小程序运行时用真实 wx.request。
 */
const http = require('http');
const https = require('https');
const { URL } = require('url');

function toBuffer(data) {
  if (data == null) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (typeof data === 'string') return Buffer.from(data, 'utf8');
  return Buffer.from(JSON.stringify(data), 'utf8');
}

/**
 * @returns {{request:Function}} 可直接挂到 global.wx.request
 */
function makeRequestImpl() {
  return function request(opts) {
    // SDK 先拿到 RequestTask、同步发起请求、之后才挂 onChunkReceived，
    // 所以不能等赋值——用 handler 容器在数据到达时读当前值。
    // 注意：SDK 把返回值存成 T 再调 T.onChunkReceived(...)，
    // 方法必须挂在返回对象自身的属性上（getter 取值再调用会丢 this）。
    // SDK 会在拿到 task 之后才挂 onChunkReceived，且用 T.onChunkReceived(...) 直接调用，
    // 所以这里直接给可调用的函数占位，挂载时替换实现（保住 this 绑到返回值）。
    const handlers = { chunk: null, headers: null, aborted: false };
    const task = {
      onChunkReceived(fnOrData) {
        // 被当作 setter 用（挂载回调）→ 存起来；SDK 不会以数据形式调用它
        if (typeof fnOrData === 'function') { handlers.chunk = fnOrData; return; }
      },
      onHeadersReceived(fn) { if (typeof fn === 'function') handlers.headers = fn; },
      abort() { handlers.aborted = true; }
    };
    const u = new URL(opts.url);
    const body = opts.data === undefined ? null : toBuffer(opts.data);
    const headers = Object.assign({}, opts.header || {});
    if (body && !headers['Content-Length'] && !headers['content-length']) {
      headers['Content-Length'] = String(body.length);
    }

    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      method: (opts.method || 'GET').toUpperCase(),
      headers
    }, (res) => {
      if (handlers.headers) handlers.headers.call(task, { header: res.headers, statusCode: res.statusCode });
      const chunks = [];
      res.on('data', (d) => {
        chunks.push(d);
        if (opts.enableChunked && handlers.chunk) {
          // 与小程序一致：回调参数是 { data: ArrayBuffer }
          const ab = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength);
          handlers.chunk.call(task, { data: ab });
        }
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (opts.success) {
          opts.success({ statusCode: res.statusCode, header: res.headers, data: text });
        }
        if (opts.complete) opts.complete();
      });
      res.on('error', (e) => { if (opts.fail) opts.fail({ errMsg: 'request:fail ' + e.message }); });
    });

    req.on('error', (e) => {
      if (opts.fail) opts.fail({ errMsg: 'request:fail ' + e.message });
    });
    if (body) req.write(body);
    req.end();
    return task;
  };
}

/** 安装到 global.wx（缺的 API 用空实现补齐） */
function install(store) {
  const s = store || {};
  global.wx = {
    getStorageSync: k => (k in s ? s[k] : ''),
    setStorageSync: (k, v) => { s[k] = v; },
    removeStorageSync: k => { delete s[k]; },
    request: makeRequestImpl()
  };
  return global.wx;
}

module.exports = { makeRequestImpl, install };

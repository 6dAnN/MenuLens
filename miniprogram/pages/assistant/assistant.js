/**
 * AI 小助手聊天页
 * ------------------------------------------------------------------
 * 走 WorkBuddy 云服务的真实大模型 + 本地 RAG 知识库检索。
 * 每条回答都带「依据」，用户可以点开看模型引用了哪条资料——
 * 这是产品对「AI 说的话可核查」的承诺，不是装饰。
 *
 * 交互要点（第二版）：
 *   · **可中断**：模型一边输出一边可点「停止」，已生成的内容保留，不丢；
 *   · **可重试**：出错的消息下方直接给「重试」，不用重新打字；
 *   · **分组快捷问**：开场按「点单 / 忌口 / 做法 / 营养」四组给问题，
 *     新人不用想「我该问什么」；
 *   · **多轮上下文**：历史消息随请求带上，追问「那它辣吗」能接住。
 *
 * 降级：云端不可用时，先回退到本地确定性引擎的回复，
 * 并把状态如实标黄，不假装在走模型。
 */
const app = getApp();
const engine = require('../../utils/engine.js');

/** 开场白里的分组快捷提问：按用户真实意图分组，而不是随手给四句 */
const SUGGESTION_GROUPS = [
  {
    key: 'order',
    label: '点单',
    icon: '🍽',
    items: [
      '两个人 180 预算怎么点？',
      '我们不吃辣，有什么推荐？',
      '四个人想吃得清淡一点'
    ]
  },
  {
    key: 'avoid',
    label: '忌口',
    icon: '⚠️',
    items: [
      '宫保鸡丁含花生吗？',
      '哪些菜含麸质？',
      '海鲜过敏要注意什么'
    ]
  },
  {
    key: 'cook',
    label: '做法',
    icon: '🍳',
    items: [
      '麻婆豆腐能不能做成不辣的？',
      '干炒牛河为什么容易粘锅',
      '白切鸡的鸡皮怎么才脆'
    ]
  },
  {
    key: 'health',
    label: '营养',
    icon: '💡',
    items: [
      '孕妇能吃什么？',
      '痛风能吃海鲜吗',
      '减脂期能点什么'
    ]
  }
];

Page({
  data: {
    statusBarHeight: 20,
    messages: [],       // { role, text, remote, pending, hits, failed, stopped, question }
    inputValue: '',
    sending: false,
    canStop: false,     // 只有真的在流式输出时才给「停止」
    conversationId: '',
    remoteLive: false,  // 是否真的在走云端模型
    groups: SUGGESTION_GROUPS,
    activeGroup: 'order',
    showSuggestions: true,
    kbStats: null,
    expanded: -1,      // 展开「依据」的消息索引
    stoppedTip: false
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    let stats = null;
    try { stats = engine.rag.stats(); } catch (e) { /* 语料缺失不影响聊天 */ }

    this.setData({
      statusBarHeight: info.statusBarHeight || 20,
      remoteLive: engine.isCloudLive(),
      kbStats: stats,
      conversationId: 'ml_' + Date.now().toString(36),
      messages: [{
        role: 'assistant',
        text: '你好呀，我是 MenuLens 的 AI 小助手。\n\n' +
          '我读过 ' + (stats ? stats.chunks : 0) + ' 条菜品与食材知识，' +
          '可以回答做法、口味、过敏原、营养和搭配问题。\n\n' +
          '不确定的时候我会直说，不会编。',
        remote: true
      }]
    });
  },

  onUnload() {
    // 离开页面时中断未完成的请求，避免回调打到已销毁的页面
    this.abortPending();
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  switchGroup(e) {
    const key = e.currentTarget.dataset.key;
    if (key) this.setData({ activeGroup: key });
  },

  quickAsk(e) {
    const q = e.currentTarget.dataset.q;
    if (!q) return;
    this.send(q);
  },

  /** 展开/收起某条回答的检索依据 */
  toggleHits(e) {
    const i = Number(e.currentTarget.dataset.i);
    this.setData({ expanded: this.data.expanded === i ? -1 : i });
  },

  /** 中断当前生成：保留已经流出来的文字，标记为「已停止」 */
  stopGenerate() {
    if (!this.data.sending) return;
    this.abortPending();
    const idx = this._pendingIdx;
    const patch = { sending: false, canStop: false, stoppedTip: true };
    if (typeof idx === 'number' && idx >= 0) {
      patch['messages[' + idx + '].pending'] = false;
      patch['messages[' + idx + '].stopped'] = true;
      // 一个字都没出来就停了，给一句交代，别留空气泡
      if (!this.data.messages[idx] || !this.data.messages[idx].text) {
        patch['messages[' + idx + '].text'] = '（已停止生成）';
      }
    }
    this.setData(patch);
  },

  abortPending() {
    if (this._abort) {
      try { this._abort.abort(); } catch (e) { /* 已结束 */ }
      this._abort = null;
    }
  },

  /** 出错后重试：复用上一轮的问题，不生成新的用户气泡 */
  retry(e) {
    const idx = Number(e.currentTarget.dataset.i);
    const msg = this.data.messages[idx];
    if (!msg || this.data.sending) return;
    const question = msg.question;
    if (!question) return;

    // 删掉失败的这条和它前面的用户气泡，重新走一遍 send
    const msgs = this.data.messages.slice(0, idx);
    // 末尾大概是那条用户提问，一并去掉，交给 send 重新追加
    while (msgs.length && msgs[msgs.length - 1].role === 'user') msgs.pop();
    this.setData({ messages: msgs }, () => this.send(question));
  },

  /**
   * @param {string} overrideText 快捷提问传入的问题；不传则读输入框
   */
  send(overrideText) {
    const text = (overrideText || this.data.inputValue || '').trim();
    if (!text || this.data.sending) return;

    // 历史只取已完结的对话轮次；失败/停止的不进上下文，免得模型被自己的半句话带偏
    const history = this.data.messages
      .filter(m => m.text && !m.pending && !m.failed && !m.stopped)
      .map(m => ({ role: m.role, text: m.text }));

    const msgs = this.data.messages.concat([
      { role: 'user', text, remote: true },
      { role: 'assistant', text: '', remote: true, pending: true, hits: [], question: text }
    ]);

    this.setData({
      messages: msgs,
      inputValue: '',
      sending: true,
      canStop: false,
      stoppedTip: false,
      showSuggestions: false,
      expanded: -1
    });

    const pendingIdx = msgs.length - 1;
    this._pendingIdx = pendingIdx;
    let streamed = '';
    let aborted = false;

    // 流式回调：原地更新最后一条，不要整表重渲染（会丢滚动位置）
    const onChunk = (delta) => {
      if (aborted) return;
      streamed += delta;
      const patch = {};
      patch['messages[' + pendingIdx + '].text'] = streamed;
      patch['messages[' + pendingIdx + '].pending'] = false;
      // 第一个字回来才允许「停止」，否则按钮闪一下就没意义
      if (!this.data.canStop) patch.canStop = true;
      this.setData(patch);
      // 流式过程中跟随滚动，但不要太频繁
      if (!this._scrollLock) {
        this._scrollLock = setTimeout(() => {
          this._scrollLock = null;
          this.scrollToBottom();
        }, 200);
      }
    };

    const ctx = app.globalData.orderContext || {};
    const plan = app.globalData.plan || null;
    const items = (app.globalData.menu && app.globalData.menu.items) || [];

    // AbortController：小程序的 wx.request 支持 abort，SDK 已把它透传成 signal
    let ctrl = null;
    try {
      if (typeof AbortController !== 'undefined') ctrl = new AbortController();
    } catch (e) { ctrl = null; }
    this._abort = ctrl;

    const onAbort = () => { aborted = true; };

    engine.chat(text, ctx, plan, items, history, {
      onChunk,
      conversationId: this.data.conversationId,
      signal: ctrl ? ctrl.signal : undefined
    })
      .then(r => {
        if (aborted) return;
        const patch = {
          sending: false,
          canStop: false,
          remoteLive: !!r.remote,
          ['messages[' + pendingIdx + '].pending']: false,
          ['messages[' + pendingIdx + '].hits']: r.hits || []
        };
        // 流式已经写进去的内容不要覆盖；只有没流出来时才用最终文本
        if (!streamed || streamed.length < (r.text || '').length) {
          patch['messages[' + pendingIdx + '].text'] = r.text || '（没有生成内容）';
        }
        patch['messages[' + pendingIdx + '].remote'] = !!r.remote;
        this.setData(patch);
        this.scrollToBottom();
      })
      .catch(err => {
        if (aborted) return;
        const friendly = (err && (err.name === 'AbortError'))
          ? '（已停止）'
          : '抱歉，出了点问题：' + (err.message || '未知错误') + '\n\n可以点下面的「重试」，或换个说法。';
        this.setData({
          sending: false,
          canStop: false,
          ['messages[' + pendingIdx + '].pending']: false,
          ['messages[' + pendingIdx + '].failed']: !(err && err.name === 'AbortError'),
          ['messages[' + pendingIdx + '].text']: streamed || friendly
        });
        this.scrollToBottom();
      });
  },

  scrollToBottom() {
    // 小程序没有 scrollToBottom API，用 scroll-into-view 到末尾占位元素
    this.setData({ scrollInto: 'msg-end' });
    setTimeout(() => this.setData({ scrollInto: '' }), 120);
  },

  clearAll() {
    wx.showModal({
      title: '清空对话',
      content: '会删除本次会话的所有消息，确定吗？',
      success: (res) => {
        if (!res.confirm) return;
        this.abortPending();
        this.setData({
          messages: [{
            role: 'assistant',
            text: '好，我们重新开始。想聊哪道菜？',
            remote: true
          }],
          showSuggestions: true,
          sending: false,
          canStop: false,
          conversationId: 'ml_' + Date.now().toString(36)
        });
      }
    });
  },

  onBack() {
    const pages = getCurrentPages();
    if (pages.length > 1) wx.navigateBack();
    else wx.switchTab({ url: '/pages/home/home' });
  }
});

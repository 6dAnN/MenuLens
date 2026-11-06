/**
 * AI 小助手聊天页
 * ------------------------------------------------------------------
 * 走 WorkBuddy 云服务的真实大模型 + 本地 RAG 知识库检索。
 * 每条回答都带「依据」，用户可以点开看模型引用了哪条资料——
 * 这是产品对「AI 说的话可核查」的承诺，不是装饰。
 *
 * 降级：云端不可用时，先回退到本地确定性引擎的回复，
 * 并把状态如实标黄，不假装在走模型。
 */
const app = getApp();
const engine = require('../../utils/engine.js');

/** 开场白里的快捷提问，点一下直接发问 */
const SUGGESTIONS = [
  '宫保鸡丁含花生吗？',
  '麻婆豆腐能不能做成不辣的？',
  '两个人 180 预算怎么点？',
  '孕妇能吃什么？'
];

Page({
  data: {
    statusBarHeight: 20,
    messages: [],       // { role, text, remote, pending, hits, failed }
    inputValue: '',
    sending: false,
    conversationId: '',
    remoteLive: false,  // 是否真的在走云端模型
    suggestions: SUGGESTIONS,
    showSuggestions: true,
    kbStats: null,
    expanded: -1       // 展开「依据」的消息索引
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

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
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

  /**
   * @param {string} overrideText 快捷提问传入的问题；不传则读输入框
   */
  send(overrideText) {
    const text = (overrideText || this.data.inputValue || '').trim();
    if (!text || this.data.sending) return;

    const history = this.data.messages
      .filter(m => m.text && !m.pending)
      .map(m => ({ role: m.role, text: m.text }));

    const msgs = this.data.messages.concat([
      { role: 'user', text, remote: true },
      { role: 'assistant', text: '', remote: true, pending: true, hits: [] }
    ]);

    this.setData({
      messages: msgs,
      inputValue: '',
      sending: true,
      showSuggestions: false,
      expanded: -1
    });

    const pendingIdx = msgs.length - 1;
    let streamed = '';

    // 流式回调：原地更新最后一条，不要整表重渲染（会丢滚动位置）
    const onChunk = (delta) => {
      streamed += delta;
      const key = 'messages[' + pendingIdx + '].text';
      this.setData({ [key]: streamed, ['messages[' + pendingIdx + '].pending']: false });
    };

    const ctx = app.globalData.orderContext || {};
    const plan = app.globalData.plan || null;
    const items = (app.globalData.menu && app.globalData.menu.items) || [];

    engine.chat(text, ctx, plan, items, history, {
      onChunk,
      conversationId: this.data.conversationId
    })
      .then(r => {
        const patch = {
          sending: false,
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
        this.setData({
          sending: false,
          ['messages[' + pendingIdx + '].pending']: false,
          ['messages[' + pendingIdx + '].failed']: true,
          ['messages[' + pendingIdx + '].text']: '抱歉，出了点问题：' +
            (err.message || '未知错误') + '\n\n可以再问一次，或换个说法。'
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
        this.setData({
          messages: [{
            role: 'assistant',
            text: '好，我们重新开始。想聊哪道菜？',
            remote: true
          }],
          showSuggestions: true,
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

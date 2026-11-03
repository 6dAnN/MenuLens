const app = getApp();
const dishes = require('../../utils/dishes.js');
const store = require('../../utils/store.js');
const cloud = require('../../utils/cloud.js');
const engine = require('../../utils/engine.js');

Page({
  data: {
    avoidChips: [], allergenChips: [],

    /* AI 引擎状态 */
    engineName: '',
    engineHint: '',
    cloudReady: false,
    loadingModels: false,
    models: [],
    currentModel: '',
    testing: false,
    testResult: '',
    usageText: ''
  },

  onLoad() {
    const gAvoid = app.globalData.globalAvoid || [];
    const allergens = app.globalData.allergens || [];

    this.setData({
      avoidChips: dishes.AVOID_OPTIONS.map(v => ({ v, on: gAvoid.indexOf(v) >= 0 })),
      allergenChips: dishes.ALLERGENS.map(v => ({ v, on: allergens.indexOf(v) >= 0 }))
    });

    this.refreshStatus();
  },

  onShow() {
    this.refreshStatus();
  },

  /** 刷新引擎状态 + 用量 */
  refreshStatus() {
    const live = engine.isCloudLive();
    const name = engine.engineName();
    const u = cloud.usage;

    this.setData({
      engineName: name,
      cloudReady: live,
      engineHint: live
        ? '模型走 WorkBuddy 云服务，调用不需要任何 API Key。'
        : '云服务不可用，已退回本地确定性引擎，功能完整但没有真实模型推理。',
      usageText: u.calls ? (u.calls + ' 次调用 · ' + u.total + ' tokens') : '本次会话还没有调用'
    });
  },

  /* ---------------- 模型目录 ---------------- */

  loadModels() {
    if (this.data.loadingModels) return;
    if (!cloud.available()) {
      wx.showToast({ title: '云服务 SDK 不可用', icon: 'none' });
      return;
    }
    this.setData({ loadingModels: true, testResult: '' });

    cloud.listModels().then(list => {
      const current = store.get('aiModel') || '';
      this.setData({
        loadingModels: false,
        models: list.map(m => Object.assign({}, m, { on: m.id === current }))
      });
      if (!list.length) {
        wx.showToast({ title: '模型目录为空', icon: 'none' });
      }
    }).catch(err => {
      this.setData({ loadingModels: false });
      wx.showToast({ title: cloud.explainError(err).slice(0, 20), icon: 'none' });
    });
  },

  pickModel(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    store.set('aiModel', id);
    this.setData({
      models: this.data.models.map(m => Object.assign({}, m, { on: m.id === id })),
      currentModel: id,
      testResult: ''
    });
    wx.showToast({ title: '已切换', icon: 'success' });
  },

  useAuto() {
    store.remove('aiModel');
    this.setData({ currentModel: '', testResult: '' });
    wx.showToast({ title: '已恢复自动选择', icon: 'none' });
  },

  /* ---------------- 测试连接 ---------------- */

  testConnection() {
    if (this.data.testing) return;
    this.setData({ testing: true, testResult: '' });

    // 发一次最短的真实请求，端到端验证到底通不通
    cloud.chat({
      system: 'You are a helpful assistant. Be concise and helpful.',
      messages: [{ role: 'user', content: '回复两个字：正常' }],
      temperature: 0.2
    }).then(reply => {
      this.setData({
        testing: false,
        testResult: (reply && reply.trim()) ? ('连接正常 · 回复：' + reply.trim().slice(0, 20)) : '已连通但回复为空'
      });
      this.refreshStatus();
    }).catch(err => {
      this.setData({
        testing: false,
        testResult: '连接失败：' + cloud.explainError(err)
      });
    });
  },

  resetUsage() {
    cloud.usage.reset();
    this.refreshStatus();
    wx.showToast({ title: '已清零', icon: 'none' });
  },

  /* ---------------- 忌口设置 ---------------- */

  toggleAvoid(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({
      avoidChips: this.data.avoidChips.map(x => (x.v === v ? { v, on: !x.on } : x))
    });
  },

  toggleAllergen(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({
      allergenChips: this.data.allergenChips.map(x => (x.v === v ? { v, on: !x.on } : x))
    });
  },

  save() {
    const avoid = this.data.avoidChips.filter(x => x.on).map(x => x.v);
    const allergens = this.data.allergenChips.filter(x => x.on).map(x => x.v);
    const severity = {};
    allergens.forEach(a => { severity[a] = 'allergy'; });

    app.globalData.globalAvoid = avoid;
    app.globalData.allergens = allergens;
    app.globalData.orderContext.avoid = avoid.slice();
    app.globalData.orderContext.allergenSeverity = severity;
    store.set('globalAvoid', avoid);
    store.set('allergens', allergens);
    app.saveCtx();

    wx.showToast({ title: '已保存', icon: 'success' });
    setTimeout(() => wx.navigateBack(), 700);
  }
});
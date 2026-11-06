const app = getApp();
const api = require('../../utils/engine.js');
const dishes = require('../../utils/dishes.js');
const store = require('../../utils/store.js');

const CATS = ['荤菜', '凉菜', '主食', '素菜', '汤', '甜品'];
const SPICE_TEXT = { none: '不辣', mild: '微辣', medium: '中辣', hot: '重辣' };

Page({
  data: {
    scanning: true,
    scanTime: '0.0s',
    scanSteps: [
      { text: '上传图片', state: 'done' },
      { text: '识别菜单版式与文字', state: 'doing' },
      { text: '匹配菜品知识库', state: '' },
      { text: '计算每项置信度', state: '' }
    ],
    meta: {}, items: [], groupedList: [], riskyList: [],
    expandedKey: null,
    ctx: {}, spiceText: '中辣', avoidText: '',
    uncertainCount: 0,
    excludedCount: 0, excludedText: '',
    showConstraint: false,
    estimateText: '',
    spiceOptions: [
      { k: 'none', t: '不辣' }, { k: 'mild', t: '微辣' },
      { k: 'medium', t: '中辣' }, { k: 'hot', t: '重辣' }
    ],
    occasionOptions: [
      { k: 'quick', t: '快餐' }, { k: 'casual', t: '正餐' }, { k: 'feast', t: '宴客' }
    ],
    avoidOptions: dishes.AVOID_OPTIONS,
    avoidChips: []
  },

  onLoad() {
    this.setData({ ctx: app.globalData.orderContext });
    this.syncCtx();
    this.startScan();
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer);
  },

  /* ---------------- 识别流程 ---------------- */

  startScan() {
    const t0 = Date.now();
    this._timer = setInterval(() => {
      this.setData({ scanTime: ((Date.now() - t0) / 1000).toFixed(1) + 's' });
    }, 100);

    this.setData({
      scanning: true,
      scanSteps: [
        { text: '上传图片', state: 'doing' },
        { text: '识别菜单版式与文字', state: '' },
        { text: '匹配菜品知识库', state: '' },
        { text: '计算每项置信度', state: '' }
      ]
    });

    // 真机：先让用户拍照；demo 路径直接走 Dify 或内置菜单
    this.runRecognition();
  },

  runRecognition() {
    api.parseMenu(null, dishes.MOCK_MENU)
      .then(menu => {
        this.advance(0);
        setTimeout(() => {
          this.advance(1);
          setTimeout(() => {
            this.advance(2);
            setTimeout(() => {
              this.advance(3);
              setTimeout(() => {
                if (this._timer) clearInterval(this._timer);
                this.setData({ scanning: false });
                this.applyMenu(menu);
              }, 380);
            }, 380);
          }, 440);
        }, 700);
      })
      .catch(err => {
        if (this._timer) clearInterval(this._timer);
        this.setData({ scanning: false });
        wx.showToast({ title: '识别失败：' + err.message, icon: 'none' });
      });
  },

  /** 推进识别步骤：把当前标 done，下一个标 doing */
  advance(i) {
    const steps = this.data.scanSteps.map((s, idx) => {
      if (idx < i) return Object.assign({}, s, { state: 'done' });
      if (idx === i) return Object.assign({}, s, { state: 'doing' });
      return Object.assign({}, s, { state: '' });
    });
    // 完成的那一步显示 ✓
    if (i > 0 && steps[i - 1]) steps[i - 1].state = 'done';
    this.setData({ scanSteps: steps });
  },

  applyMenu(menu) {
    app.globalData.menu = menu;
    const confirmed = menu.items.filter(i => i.confidence >= 0.5);
    const risky = menu.items.filter(i => i.confidence < 0.5);

    const groupedList = [];
    CATS.forEach(cat => {
      const list = confirmed.filter(i => i.category === cat);
      if (list.length) groupedList.push({ cat, items: list });
    });

    this.setData({
      meta: menu.meta,
      items: menu.items,
      groupedList,
      riskyList: risky,
      uncertainCount: menu.items.filter(i => i.confidence >= 0.5 && i.confidence < 0.8).length + risky.length
    });

    wx.showToast({ title: '已识别 ' + menu.items.length + ' 道菜', icon: 'none' });
  },

  cancelScan() {
    if (this._timer) clearInterval(this._timer);
    wx.navigateBack();
  },

  /* ---------------- 约束面板 ---------------- */

  openConstraint() {
    this.syncCtx();
    this.setData({ showConstraint: true });
  },
  closeConstraint() {
    this.setData({ showConstraint: false });
  },

  syncCtx() {
    const c = app.globalData.orderContext;
    const avoidChips = dishes.AVOID_OPTIONS.map(v => ({ v, on: (c.avoid || []).indexOf(v) >= 0 }));
    this.setData({
      ctx: c,
      spiceText: SPICE_TEXT[c.spiceLevel] || '中辣',
      avoidText: (c.avoid || []).join('·'),
      avoidChips,
      estimateText: this.estimate(c)
    });
  },

  estimate(c) {
    const per = c.budget / Math.max(c.servings, 1);
    const n = Math.max(2, Math.round(c.servings * 1.3));
    return '按当前约束，预计可点 ' + n + ' 道菜，人均 ¥' + per.toFixed(0);
  },

  updateCtx(patch) {
    Object.assign(app.globalData.orderContext, patch);
    app.saveCtx();
    this.syncCtx();
  },

  changeServings(e) {
    const d = parseInt(e.currentTarget.dataset.d, 10);
    const c = app.globalData.orderContext;
    this.updateCtx({ servings: Math.min(20, Math.max(1, c.servings + d)) });
  },
  onBudget(e) {
    this.updateCtx({ budget: Math.max(0, parseInt(e.detail.value || 0, 10)) });
  },
  onBudgetSlider(e) {
    this.updateCtx({ budget: parseInt(e.detail.value, 10) });
  },
  setSpice(e) { this.updateCtx({ spiceLevel: e.currentTarget.dataset.v }); },
  setOccasion(e) { this.updateCtx({ occasion: e.currentTarget.dataset.v }); },
  toggleAvoid(e) {
    const v = e.currentTarget.dataset.v;
    const c = app.globalData.orderContext;
    const avoid = (c.avoid || []).slice();
    const idx = avoid.indexOf(v);
    if (idx >= 0) avoid.splice(idx, 1); else avoid.push(v);
    this.updateCtx({ avoid });
  },
  resetCtx() {
    this.updateCtx({
      servings: 2, budget: 200, spiceLevel: 'medium',
      avoid: (app.globalData.globalAvoid || []).slice(), occasion: 'casual'
    });
  },

  /* ---------------- 生成方案 ---------------- */

  doPlan() {
    const ctx = app.globalData.orderContext;
    const items = (app.globalData.menu || {}).items || dishes.MOCK_MENU.items;

    wx.showLoading({ title: '正在搭配', mask: true });
    api.generatePlan(ctx, items)
      .then(plan => {
        wx.hideLoading();
        this.setData({ showConstraint: false });
        if (!plan.ok) {
          wx.showModal({
            title: '没有合适的菜',
            content: plan.emptyReason,
            showCancel: false
          });
          return;
        }
        app.globalData.plan = plan;
        store.set('lastPlan', plan);
        wx.navigateTo({ url: '/pages/plan/plan' });
      })
      .catch(err => {
        wx.hideLoading();
        wx.showToast({ title: '生成失败：' + err.message, icon: 'none' });
      });
  },

  /* ---------------- 菜品卡交互 ---------------- */

  onToggleExpand(e) {
    const key = e.detail.key;
    this.setData({ expandedKey: this.data.expandedKey === key ? null : key });
  },
  onRecipe(e) {
    wx.navigateTo({ url: '/pages/recipe/recipe?name=' + encodeURIComponent(e.detail.name) });
  },
  onFix(e) {
    const item = e.detail.item;
    wx.showModal({
      title: '修正菜名',
      editable: true,
      placeholderText: item.name,
      content: item.name,
      success: (res) => {
        if (!res.confirm) return;
        const nn = (res.content || '').trim();
        if (!nn) return;
        const menu = app.globalData.menu;
        const target = menu.items.find(x => x.key === item.key);
        if (target) {
          target.name = nn;
          target.confidence = 0.9;
          this.applyMenu(menu);
          wx.showToast({ title: '已修正', icon: 'none' });
        }
      }
    });
  },
  onPickCand(e) {
    const menu = app.globalData.menu;
    const target = menu.items.find(x => x.key === e.detail.key);
    if (target) {
      target.name = e.detail.name;
      target.confidence = 0.85;
      this.applyMenu(menu);
      wx.showToast({ title: '已确认为「' + e.detail.name + '」', icon: 'none' });
    }
  },
  onSource(e) {
    const item = e.detail.item;
    wx.showModal({
      title: '这个 ' + Math.round(item.confidence * 100) + '% 是怎么来的？',
      content: '视觉模型置信度 × 0.6 + 知识库匹配 × 0.3 + OCR 文本加成 × 0.1\n\n' +
               '综合置信度 = ' + item.confidence.toFixed(2) + '\n来源：' + item.source +
               '\n\n把置信度摊开给你看，是 MenuLens 的设计原则——不确定的东西，我们不装作确定。',
      showCancel: false,
      confirmText: '知道了'
    });
  },
  onConfHelp() {
    wx.showModal({
      title: '置信度怎么算',
      content: '单菜识别置信度 = 视觉模型菜名置信度 × 0.6 + 知识库模糊匹配置信度 × 0.3 + OCR 文本匹配加成 × 0.1\n\n≥ 0.8 显示为绿色「可信」\n0.5–0.8 显示为黄色「建议核对」\n< 0.5 显示为红色「存疑」并给出候选',
      showCancel: false
    });
  },
  onAsk() {
    wx.navigateTo({ url: '/pages/assistant/assistant' });
  }
});
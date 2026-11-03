const app = getApp();
const api = require('../../utils/engine.js');
const dishes = require('../../utils/dishes.js');
const planner = require('../../utils/planner.js');
const store = require('../../utils/store.js');

const SPICE_TEXT = { none: '不辣', mild: '微辣', medium: '中辣', hot: '重辣' };

Page({
  data: {
    plan: null, groups: [], ctx: {},
    pct: 0, over: false, perHeadText: '', servingsText: '',
    spiceText: '中辣', avoidText: '',
    showSwap: false, swapPool: [], swapKey: ''
  },

  onLoad() {
    const plan = app.globalData.plan || store.get('lastPlan');
    if (!plan || !plan.ok) {
      wx.showModal({
        title: '还没有方案',
        content: '先扫一份菜单，我才能帮你配一桌。',
        showCancel: false,
        success: () => wx.navigateBack()
      });
      return;
    }
    this.renderPlan(plan);
  },

  renderPlan(plan) {
    const ctx = app.globalData.orderContext;
    const groups = Object.keys(plan.grouped).map(cat => ({ cat, items: plan.grouped[cat] }));
    const pct = Math.min(100, Math.round(plan.total / ctx.budget * 100));

    this.setData({
      plan, groups, ctx,
      pct,
      over: plan.total > ctx.budget,
      perHeadText: plan.perHead.toFixed(0),
      servingsText: plan.servings.toFixed(1),
      spiceText: SPICE_TEXT[ctx.spiceLevel] || '中辣',
      avoidText: (ctx.avoid || []).join('·')
    });

    // 每次进入写入历史
    const hist = store.get('history', []);
    hist.unshift({
      title: (app.globalData.menu || {}).meta ? app.globalData.menu.meta.restaurant : '菜单识别',
      sub: '生成 ' + plan.dishCount + ' 道方案',
      price: plan.total,
      time: this.nowStr()
    });
    store.set('history', hist.slice(0, 20));
  },

  nowStr() {
    const d = new Date();
    return (d.getMonth() + 1) + '-' + d.getDate() + ' ' +
           String(d.getHours()).padStart(2, '0') + ':' +
           String(d.getMinutes()).padStart(2, '0');
  },

  /* ---------------- 换一道 ---------------- */

  openSwap(e) {
    const key = e.currentTarget.dataset.key;
    const plan = this.data.plan;
    const chosen = Object.keys(plan.grouped).reduce((acc, c) => acc.concat(plan.grouped[c]), []).map(x => x.name);
    const items = (app.globalData.menu || {}).items || dishes.MOCK_MENU.items;
    const filtered = planner.hardFilter(items, app.globalData.orderContext).kept;

    this.setData({
      showSwap: true,
      swapKey: key,
      swapPool: filtered.filter(it => chosen.indexOf(it.name) < 0)
    });
  },
  closeSwap() { this.setData({ showSwap: false }); },

  doSwap(e) {
    const newKey = e.currentTarget.dataset.key;
    const items = (app.globalData.menu || {}).items || dishes.MOCK_MENU.items;
    const plan = planner.generatePlan(app.globalData.orderContext, items);
    if (plan.ok) {
      plan.adjusted = '已把一道换成菜单里的其他选项';
      app.globalData.plan = plan;
      store.set('lastPlan', plan);
      this.setData({ showSwap: false });
      this.renderPlan(plan);
      wx.showToast({ title: '已换好', icon: 'none' });
    }
  },

  /* ---------------- 其他 ---------------- */

  openConstraint() {
    wx.navigateBack();
  },
  recipeAll() {
    const groups = this.data.groups;
    if (groups.length && groups[0].items.length) {
      wx.navigateTo({ url: '/pages/recipe/recipe?name=' + encodeURIComponent(groups[0].items[0].name) });
    }
  },
  onShare() {
    wx.showToast({ title: '卡片已生成', icon: 'none' });
  },
  openChat() {
    wx.showToast({ title: 'AI 助手', icon: 'none' });
  },
  onAsk() { wx.showToast({ title: 'AI 助手', icon: 'none' }); }
});
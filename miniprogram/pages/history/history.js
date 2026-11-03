const app = getApp();
const store = require('../../utils/store.js');
const api = require('../../utils/engine.js');
const planner = require('../../utils/planner.js');
const dishes = require('../../utils/dishes.js');

const ICONS = ['🍽', '🍜', '🍲', '🍣', '🌮', '🥘'];

Page({
  data: { list: [] },

  onShow() { this.refresh(); },

  refresh() {
    const hist = store.get('history', []);
    this.setData({
      list: hist.map((h, i) => Object.assign({}, h, {
        icon: h.icon || ICONS[i % ICONS.length],
        id: h.time + '_' + i
      }))
    });
  },

  /** 从历史恢复菜单与方案上下文 */
  reopen(e) {
    const item = this.data.list[e.currentTarget.dataset.idx];
    if (!item) return;

    // 恢复：重新解析菜单，生成方案
    const menu = planner.parseMenu(dishes.MOCK_MENU);
    app.globalData.menu = menu;
    const plan = planner.generatePlan(app.globalData.orderContext, menu.items);
    if (plan.ok) {
      app.globalData.plan = plan;
      store.set('lastPlan', plan);
    }
    wx.navigateTo({ url: '/pages/plan/plan' });
  }
});
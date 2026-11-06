const app = getApp();
const engine = require('../../utils/engine.js');

Page({
  data: {
    statusBarHeight: 20,
    avoidText: '',
    engineName: '',
    cloudReady: false
  },

  onLoad() {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    this.refreshAvoid();
  },

  onShow() {
    if (this.getTabBar) this.getTabBar().setTabSelected();
    this.refreshAvoid();
  },

  refreshAvoid() {
    const list = app.globalData.globalAvoid || [];
    this.setData({
      avoidText: list.length ? list.join(' · ') : '无',
      // 如实展示当前由谁推理，不含糊
      engineName: engine.engineName(),
      cloudReady: engine.isCloudLive()
    });
  },

  /* === 导航 === */
  goScan() {
    wx.navigateTo({ url: '/pages/menu/menu' });
  },
  goDish() {
    wx.switchTab({ url: '/pages/dish/dish' });
  },
  goRecipe() {
    wx.switchTab({ url: '/pages/recipe/recipe' });
  },
  goHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
  },
  openAvoid() {
    wx.navigateTo({ url: '/pages/settings/settings' });
  },
  openAi() {
    wx.navigateTo({ url: '/pages/settings/settings?tab=ai' });
  },
  onAsk() {
    wx.navigateTo({ url: '/pages/assistant/assistant' });
  }
});
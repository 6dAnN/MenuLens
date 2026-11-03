const app = getApp();
const engine = require('../../utils/engine.js');
const store = require('../../utils/store.js');

Page({
  data: {
    statCount: 0, favCount: 0, histCount: 0,
    avoidText: '', avoidCount: 0, favText: '', apiText: ''
  },

  onShow() {
    if (this.getTabBar) this.getTabBar().setTabSelected();
    this.refresh();
  },

  refresh() {
    const hist = store.get('history', []);
    const favs = store.get('favs', []);
    const avoid = app.globalData.globalAvoid || [];
    const savedModel = store.get('aiModel');

    this.setData({
      statCount: hist.length,
      histCount: hist.length,
      favCount: favs.length,
      favText: favs.length ? favs.slice(0, 2).join('、') : '还没有收藏',
      avoidText: avoid.length ? avoid.join('、') : '未设置',
      avoidCount: avoid.length,
      apiText: engine.engineName() + (savedModel ? ' · 锁定 ' + savedModel : ' · 自动选模型')
    });
  },

  goSettings() { wx.navigateTo({ url: '/pages/settings/settings' }); },
  goHistory() { wx.navigateTo({ url: '/pages/history/history' }); },
  goApi() { wx.navigateTo({ url: '/pages/settings/settings?tab=ai' }); },

  onTaste() { wx.showToast({ title: '口味档案开发中', icon: 'none' }); },
  onFav() { wx.showToast({ title: '收藏夹开发中', icon: 'none' }); },
  onAbout() {
    wx.showModal({
      title: 'MenuLens v1.0',
      content: '你的 AI 美食伴侣\n\n拍一张菜单，安心点一桌菜。\n\n核心技术：WorkBuddy 云服务大模型 + 代码层过敏原硬过滤\n\n过敏原过滤永远在代码层完成，不会交给模型判断。',
      showCancel: false
    });
  },

  clearData() {
    wx.showModal({
      title: '清除本地数据',
      content: '将删除历史记录、收藏和忌口设置，且无法恢复。确定继续吗？',
      confirmText: '清除',
      confirmColor: '#E5484D',
      success: (res) => {
        if (!res.confirm) return;
        store.clearAll();
        app.globalData.globalAvoid = [];
        app.globalData.allergens = [];
        app.globalData.orderContext = {
          servings: 2, budget: 200, spiceLevel: 'medium',
          avoid: [], occasion: 'casual', allergenSeverity: {}
        };
        this.refresh();
        wx.showToast({ title: '已清除', icon: 'success' });
      }
    });
  }
});
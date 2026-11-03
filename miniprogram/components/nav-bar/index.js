Component({
  properties: {
    title: { type: String, value: '' },
    /** true = 文字为白色（用于沉浸式 Hero 页） */
    fg: { type: Boolean, value: false },
    showBack: { type: Boolean, value: true }
  },

  data: { statusBarHeight: 20 },

  lifetimes: {
    attached() {
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      this.setData({ statusBarHeight: info.statusBarHeight || 20 });
    }
  },

  methods: {
    onBack() {
      const pages = getCurrentPages();
      if (pages.length > 1) wx.navigateBack();
      else wx.switchTab({ url: '/pages/home/home' });
      this.triggerEvent('back');
    },
    onMenu() {
      wx.showActionSheet({
        itemList: ['首页', '拍照识菜', 'AI 菜谱', '我的'],
        success: (res) => {
          const map = ['/pages/home/home', '/pages/dish/dish', '/pages/recipe/recipe', '/pages/mine/mine'];
          wx.switchTab({ url: map[res.tapIndex] });
        }
      });
    },
    onAsk() { this.triggerEvent('ask'); }
  }
});
Component({
  data: {
    selected: 0,
    list: [
      { pagePath: '/pages/home/home',   text: '首页', icon: '🏠' },
      { pagePath: '/pages/dish/dish',   text: '识菜', icon: '📷' },
      { pagePath: '/pages/recipe/recipe', text: '菜谱', icon: '📖' },
      { pagePath: '/pages/mine/mine',   text: '我的', icon: '👤' }
    ]
  },

  attached() {
    this.setTabSelected();
  },

  methods: {
    setTabSelected() {
      try {
        const pages = getCurrentPages();
        if (!pages.length) return;
        const cur = '/' + pages[pages.length - 1].route;
        const idx = this.data.list.findIndex(t => t.pagePath === cur);
        if (idx >= 0) this.setData({ selected: idx });
      } catch (e) {}
    },

    switchTab(e) {
      const { path } = e.currentTarget.dataset;
      if (path === this.data.list[this.data.selected].pagePath) return;
      wx.switchTab({ url: path });
    }
  }
});
const app = getApp();
const api = require('../../utils/engine.js');
const dishes = require('../../utils/dishes.js');

Page({
  data: {
    hasResult: false, recognizing: false, recogTime: '0.0s',
    recogSteps: [
      { text: '分析图像主体', state: 'doing' },
      { text: '匹配菜品知识库', state: '' },
      { text: '生成菜品档案', state: '' }
    ],
    dish: null, confLabel: '', allergenText: '',
    qaList: [
      { q: '🥘 这道菜家常怎么做？', a: '家常版要先把肉馅炒干再加豆瓣酱，出红油后再加水。豆腐用淡盐水焯过不易碎，最后分两次勾芡才够亮滑。' },
      { q: '🌶 能不能做成不辣的？', a: '可以。去掉豆瓣酱和花椒粉，改用甜面酱 + 少量番茄酱调味，做成甜口版本，小孩也能吃。' },
      { q: '🍚 配什么主食最好？', a: '配米饭最稳。这道菜本身够下饭，建议米饭点两份；如果想更有层次，可以配一份干炒牛河。' }
    ]
  },

  onLoad() {
    const saved = app.globalData.dish;
    if (saved) this.applyDish(saved);
  },

  onShow() {
    if (this.getTabBar) this.getTabBar().setTabSelected();
  },

  onUnload() { if (this._t) clearInterval(this._t); },

  applyDish(dish) {
    app.globalData.dish = dish;
    this.setData({
      dish,
      hasResult: true,
      confLabel: Math.round(dish.confidence * 100) + '% 可信',
      allergenText: (dish.allergens || []).join('、') || '无常见过敏原'
    });
  },

  /* ---------------- 拍照 ---------------- */

  snap() {
    // 真机：调用相机。demo 环境直接走内置识别
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success: () => this.runRecognition(),
      fail: () => {
        // 用户取消或不支持时，仍走演示路径
        this.runRecognition();
      }
    });
  },

  pickFromAlbum() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album'],
      success: () => this.runRecognition(),
      fail: () => {}
    });
  },
  onSwitch() { wx.showToast({ title: '切换摄像头', icon: 'none' }); },
  goMenu() { wx.navigateTo({ url: '/pages/menu/menu' }); },

  runRecognition() {
    this.setData({
      recognizing: true,
      recogSteps: [
        { text: '分析图像主体', state: 'doing' },
        { text: '匹配菜品知识库', state: '' },
        { text: '生成菜品档案', state: '' }
      ]
    });
    const t0 = Date.now();
    this._t = setInterval(() => {
      this.setData({ recogTime: ((Date.now() - t0) / 1000).toFixed(1) + 's' });
    }, 100);

    api.recognizeDish(null, dishes.MOCK_DISH)
      .then(dish => {
        this.advance(0);
        setTimeout(() => {
          this.advance(1);
          setTimeout(() => {
            this.advance(2);
            setTimeout(() => {
              clearInterval(this._t);
              this.setData({ recognizing: false });
              this.applyDish(dish);
              wx.showToast({ title: '认出这道菜了', icon: 'none' });
            }, 380);
          }, 450);
        }, 450);
      })
      .catch(err => {
        clearInterval(this._t);
        this.setData({ recognizing: false });
        wx.showToast({ title: '识别失败：' + err.message, icon: 'none' });
      });
  },

  advance(i) {
    const steps = this.data.recogSteps.map((s, idx) => {
      if (idx < i) return Object.assign({}, s, { state: 'done' });
      if (idx === i) return Object.assign({}, s, { state: 'doing' });
      return Object.assign({}, s, { state: '' });
    });
    this.setData({ recogSteps: steps });
  },

  /* ---------------- 其他 ---------------- */

  onSource() {
    wx.showModal({
      title: '这个 94% 是怎么来的？',
      content: '视觉模型置信度 × 0.6 + 知识库匹配 × 0.3 + OCR 加成 × 0.1\n\n综合置信度 = 0.94\n来源：视觉识别 + 知识库\n\n把置信度摊开给你看，是 MenuLens 的设计原则。',
      showCancel: false
    });
  },
  genRecipe() {
    wx.navigateTo({ url: '/pages/recipe/recipe?name=' + encodeURIComponent(this.data.dish.name) });
  },
  onAsk() { wx.showToast({ title: 'AI 助手', icon: 'none' }); }
});
const app = getApp();
const api = require('../../utils/engine.js');
const dishes = require('../../utils/dishes.js');
const store = require('../../utils/store.js');

const DIFF = ['', '简单', '中等', '较难', '困难'];
const HAVE_OPTIONS = ['鸡蛋', '番茄', '青菜', '鸡翅', '豆腐', '牛肉', '虾', '可乐'];

Page({
  data: {
    mode: 'list',
    haveOptions: HAVE_OPTIONS.map(v => ({ v, on: false })),
    taste: 'normal',
    time: 30,
    hotList: [],
    recipe: null, haveText: '', ingredients: [], diffText: '', matchPct: 0
  },

  onLoad(query) {
    this.setData({
      hotList: dishes.MOCK_RECIPES.map(r => ({
        name: r.name,
        time: r.time,
        diffText: DIFF[r.difficulty] || '中等',
        snippet: r.steps[0].d.slice(0, 22) + '…'
      }))
    });
    if (query && query.name) {
      this.openRecipe(decodeURIComponent(query.name));
    }
  },

  onShow() {
    if (this.getTabBar) this.getTabBar().setTabSelected();
  },

  /* ---------------- 列表模式 ---------------- */

  toggleHave(e) {
    const v = e.currentTarget.dataset.v;
    this.setData({
      haveOptions: this.data.haveOptions.map(x =>
        x.v === v ? { v, on: !x.on } : x
      )
    });
  },
  setTaste(e) { this.setData({ taste: e.currentTarget.dataset.v }); },
  setTime(e) { this.setData({ time: e.detail.value }); },

  genRecipe() {
    const have = this.data.haveOptions.filter(x => x.on).map(x => x.v);
    if (!have.length) {
      wx.showToast({ title: '先选几个你有的食材', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '正在配菜', mask: true });

    // 简单匹配打分：已有食材重合度
    const scored = dishes.MOCK_RECIPES.map(r => {
      const hit = r.have.filter(x =>
        have.some(h => h.indexOf(x.slice(0, 2)) >= 0 || x.indexOf(h.slice(0, 2)) >= 0)
      ).length;
      const match = Math.min(0.98, 0.45 + (hit / Math.max(r.have.length, 1)) * 0.5 + Math.random() * 0.08);
      return Object.assign({}, r, { match });
    }).sort((a, b) => b.match - a.match);

    const best = scored[0];
    setTimeout(() => {
      wx.hideLoading();
      const leftover = have.filter(h => !best.have.some(b => h.indexOf(b.slice(0, 2)) >= 0));
      this.showRecipe(Object.assign({}, best, {
        have: leftover,
        tips: '匹配度 ' + Math.round(best.match * 100) + '% · 基于你现有的「' + have.join('、') + '」生成'
      }));
    }, 800);
  },

  /* ---------------- 详情模式 ---------------- */

  openRecipe(name) {
    const found = dishes.MOCK_RECIPES.find(r => r.name === name || name.indexOf(r.name) >= 0);
    if (found) {
      this.showRecipe(found);
    } else {
      // 知识库里有这个菜 → 按本体生成一份步骤
      const d = dishes.lookupDish(name);
      this.showRecipe({
        name: d.nameZh || name,
        en: d.nameEn || '',
        time: d.time || 30,
        difficulty: d.difficulty || 2,
        servings: 2,
        match: 0.8,
        have: (d.ingredients || []).slice(0, 3),
        missing: (d.ingredients || []).slice(3),
        tips: d.tips,
        steps: (d.methods && d.methods.length ? d.methods : ['暂无做法']).map((m, i) => ({
          t: '第 ' + (i + 1) + ' 步', d: m, tip: i === 0 ? d.tips : ''
        })),
        pairWith: d.pairWith || []
      });
    }
  },

  showRecipe(r) {
    const have = r.have || [];
    const missing = r.missing || [];
    const ingredients = have.map(n => ({ name: n, have: true }))
      .concat(missing.map(n => ({ name: n, have: false })));

    this.setData({
      mode: 'detail',
      recipe: r,
      haveText: have.join('、'),
      ingredients,
      diffText: DIFF[r.difficulty] || '中等',
      matchPct: Math.round((r.match || 0) * 100)
    });
    app.globalData.recipe = r;
  },

  fav() {
    const favs = store.get('favs', []);
    const name = this.data.recipe.name;
    const idx = favs.indexOf(name);
    if (idx >= 0) {
      favs.splice(idx, 1);
      store.set('favs', favs);
      wx.showToast({ title: '已取消收藏', icon: 'none' });
    } else {
      favs.unshift(name);
      store.set('favs', favs);
      wx.showToast({ title: '已收藏', icon: 'none' });
    }
  },
  onShare() { wx.showToast({ title: '卡片已生成', icon: 'none' }); }
});
const dishes = require('../../utils/dishes.js');

const PALETTES = [
  ['#F0B45C', '#C4622A', '#6E9B3C', '#E4B94E'],
  ['#F2A0A0', '#B04444', '#5F8A4A', '#E8C46A'],
  ['#B8DC8A', '#5F8A38', '#E2A94E', '#C9D96A'],
  ['#F5D48A', '#C08A2A', '#7A5AA8', '#E0A860'],
  ['#E8B4A0', '#A85842', '#4E7A6A', '#D9C089']
];

Component({
  properties: {
    item: { type: Object, value: {} },
    expanded: { type: Boolean, value: false }
  },

  data: {
    dots: [1, 2, 3, 4, 5],
    dotCount: 0, confCls: '', confLabel: '',
    /** 置信度三态对应的卡片边框态：'' | 'warn' | 'risk' */
    cls: '',
    allergens: [], candidates: [], pal: PALETTES[0],
    dishName: '', detail: {}
  },

  observers: {
    'item, expanded': function (item) {
      if (!item || !item.name) return;
      const conf = item.confidence || 0;
      const dotCount = Math.max(1, Math.round(conf * 5));
      const confCls = conf >= 0.8 ? 'hi' : (conf >= 0.5 ? 'mid' : 'lo');
      const confLabel = conf >= 0.8 ? Math.round(conf * 100) + '% 可信'
                        : (conf >= 0.5 ? Math.round(conf * 100) + '% 建议核对'
                        : Math.round(conf * 100) + '% 存疑');
      const cls = conf >= 0.8 ? '' : (conf >= 0.5 ? 'warn' : 'risk');

      const d = dishes.lookupDish(item.name);
      const sum = Array.from(item.name).reduce((a, c) => a + c.charCodeAt(0), 0);

      this.setData({
        dotCount, confCls, confLabel, cls,
        allergens: d.allergens || [],
        candidates: item.candidates || [item.name],
        pal: PALETTES[sum % PALETTES.length],
        dishName: item.name,
        detail: {
          cuisine: d.cuisine || '—',
          region: d.region || '—',
          ingredientsText: (d.ingredients || []).join('、') || '暂无数据',
          methodsText: (d.methods || []).join('、') || '暂无数据',
          pairText: (d.pairWith || ['—']).join('、'),
          tips: d.tips || '建议向服务员确认'
        }
      });
    }
  },

  methods: {
    onToggle() { this.triggerEvent('toggle', { key: this.data.item.key }); },
    onRecipe(e) { this.triggerEvent('recipe', { name: e.currentTarget.dataset.name }); },
    onFix() { this.triggerEvent('fix', { key: this.data.item.key, item: this.data.item }); },
    onPickCand(e) { this.triggerEvent('pickcand', { key: this.data.item.key, name: e.currentTarget.dataset.name }); },
    onSource() { this.triggerEvent('source', { item: this.data.item }); }
  }
});
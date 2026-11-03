// app.js
const store = require('./utils/store.js');

/**
 * 引擎选择
 * ------------------------------------------------------------------
 * · 'cloud' → WorkBuddy 云服务免密钥 LLM（当前默认，不接 Dify、不填任何 Key）
 * · 'dify'  → utils/api.js，老的 Dify Workflow 方案，保留可对比
 *
 * 两套实现都保留、都可用，切换只改这一行。
 */
const ENGINE = 'cloud';

const ai = ENGINE === 'dify'
  ? require('./utils/api.js')
  : require('./utils/ai-cloud.js');

App({
  globalData: {
    engine: ENGINE,
    ai,
    /** 点单约束（PRD §7.2 OrderContext） */
    orderContext: {
      servings: 2,
      budget: 200,
      spiceLevel: 'medium',
      avoid: ['香菜', '海鲜'],
      occasion: 'casual',
      allergenSeverity: { 花生: 'allergy' }
    },
    /** 用户全局忌口 */
    globalAvoid: ['香菜', '海鲜'],
    allergens: ['花生', '甲壳类'],
    /** 当前菜单会话 */
    menu: null,
    plan: null,
    dish: null,
    /** Dify 配置（仅 engine==='dify' 时有意义） */
    config: {
      difyEndpoint: '',
      difyKey: ''
    }
  },

  onLaunch() {
    const saved = store.get('ctx');
    if (saved) this.globalData.orderContext = saved;
    const ga = store.get('globalAvoid');
    if (ga) this.globalData.globalAvoid = ga;
    const al = store.get('allergens');
    if (al) this.globalData.allergens = al;

    if (ENGINE === 'dify') {
      const cfg = store.get('apiConfig');
      if (cfg) {
        this.globalData.config = Object.assign(this.globalData.config, cfg);
        this.globalData.ai.configure(this.globalData.config);
      }
    }
  },

  saveCtx() {
    store.set('ctx', this.globalData.orderContext);
  }
});
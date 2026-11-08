/* ==========================================================================
   MenuLens · 应用主逻辑
   页面路由 / 状态管理 / 渲染 / 交互
   ========================================================================== */

var DATA = window.MenuLensData;
var DISH_DB = DATA.DISH_DB, MOCK_MENU = DATA.MOCK_MENU, MOCK_DISH = DATA.MOCK_DISH;
var MOCK_RECIPES = DATA.MOCK_RECIPES, lookupDish = DATA.lookupDish;
var AVOID_OPTIONS = DATA.AVOID_OPTIONS, ALLERGENS = DATA.ALLERGENS;

var AI = window.MenuLensAI;
var config = AI.config, parseMenu = AI.parseMenu, generatePlan = AI.generatePlan;
var agentReply = AI.agentReply, detectIntent = AI.detectIntent;
var isJailbreak = AI.isJailbreak, isOffTopic = AI.isOffTopic;
var planRemote = AI.planRemote, ask = AI.ask;

/* --------------------------------------------------------------------------
   状态
   -------------------------------------------------------------------------- */

const state = {
  tab: 'home',
  route: 'home',              // home | cam | recipeTab | mine | menu | plan | recipe | history
  menu: null,                 // 解析后的菜单
  plan: null,
  ctx: {
    servings: 2,
    budget: 200,
    spiceLevel: 'medium',
    avoid: ['香菜', '海鲜'],
    occasion: 'casual',
    priorities: ['value', 'signature']
  },
  globalAvoid: ['香菜', '海鲜'],
  allergens: ['花生', '甲壳类'],
  dish: null,                 // 拍照识菜结果
  chat: [],
  thinking: false,
  history: [
    { icon: '🍽', title: '翠华餐厅（深圳湾店）', sub: '识别 10 项 · 生成 3 道方案', time: '今天 12:40', price: 186 },
    { icon: '🍜', title: '味千拉面', sub: '识别 8 项 · 未生成方案', time: '昨天 19:20', price: 0 },
    { icon: '🍲', title: '巴蜀人家', sub: '识别 14 项 · 生成 4 道方案', time: '10-18 18:55', price: 328 }
  ],
  favs: [],
  swapPool: [],
  confPop: null,
  navStack: []
};

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/** 带历史栈的页面跳转 */
function go(route, tab) {
  if (route !== state.route) state.navStack.push({ route: state.route, tab: state.tab });
  state.route = route;
  if (tab) state.tab = tab;
  renderFrame();
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------------------------------------------------
   顶部/底部框架渲染
   -------------------------------------------------------------------------- */

const NAV = {
  home: { title: '' },
  cam: { title: '' },
  recipeTab: { title: 'AI 菜谱' },
  mine: { title: '我的' },
  menu: { title: '识别结果' },
  plan: { title: '你的点单方案' },
  recipe: { title: '菜谱' },
  history: { title: '历史记录' }
};

function renderFrame() {
  const nav = NAV[state.route] || { title: '' };
  const phone = $('#phone');
  const floating = state.route === 'home';

  phone.innerHTML = `
    <div class="statusbar ${floating ? 'on-brand' : ''}">
      <span>9:41</span>
      <span class="sb-right">📶 🔋</span>
    </div>
    <div class="navbar ${floating ? 'floating' : ''}">
      <div class="nav-btn" data-act="back">${floating ? '☰' : '‹'}</div>
      <div class="nav-title">${esc(nav.title || '')}</div>
      <div class="nav-right">
        <div class="nav-btn" data-act="ask" title="AI 助手">✦</div>
      </div>
    </div>
    <div class="screen" id="screen"></div>
    ${needsTab(state.route) ? tabbarHTML() : ''}
    <div class="mask" id="mask"></div>
    <div id="sheets"></div>
    <div id="toast-host"></div>
  `;
  renderPage();
}

function needsTab(r) {
  return ['home', 'cam', 'recipeTab', 'mine'].includes(r);
}

function tabbarHTML() {
  const tabs = [
    { k: 'home', i: '🏠', t: '首页' },
    { k: 'cam', i: '📷', t: '识菜' },
    { k: 'recipeTab', i: '📖', t: '菜谱' },
    { k: 'mine', i: '👤', t: '我的' }
  ];
  return `<div class="tabbar">${tabs.map(t => `
    <div class="tab ${state.tab === t.k ? 'active' : ''}" data-tab="${t.k}">
      <span class="ti">${t.i}</span><span>${t.t}</span>
    </div>`).join('')}</div>`;
}

function renderPage() {
  const screen = $('#screen');
  if (!screen) return;
  const fn = PAGES[state.route];
  screen.innerHTML = fn ? fn() : '';
  screen.scrollTop = 0;
  if (state.route === 'cam') screen.querySelector('.cam-view')?.focus();
}

/* --------------------------------------------------------------------------
   通用片段
   -------------------------------------------------------------------------- */

function flavorDots(name) {
  const d = lookupDish(name);
  const f = d.flavor || {};
  const keys = Object.keys(f).slice(0, 2);
  if (!keys.length) return '';
  return keys.map(k => {
    const n = Math.round((f[k] || 0) * 4);
    return `<div class="flavor-bar"><span class="fb-t">${esc(k)}</span>
      <span class="fb-dots">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span></div>`;
  }).join('');
}

function confDots(conf) {
  const n = Math.max(1, Math.round(conf * 5));
  const cls = conf >= 0.8 ? 'hi' : conf >= 0.5 ? 'mid' : 'lo';
  const label = conf >= 0.8 ? '可信' : conf >= 0.5 ? '建议核对' : '存疑';
  return {
    dots: `<div class="dots">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= n ? 'on ' + cls : ''}"></i>`).join('')}</div>`,
    txt: `${Math.round(conf * 100)}% ${label}`,
    cls
  };
}

function allergenChips(name) {
  const d = lookupDish(name);
  if (!d.allergens || !d.allergens.length) {
    return '<span class="pill mild">无常见过敏原</span>';
  }
  return d.allergens.map(a => `<span class="pill cat">⚠ ${esc(a)}</span>`).join('');
}

function dishArt(name) {
  // 用菜名派生一组稳定的暖色，缩略图显示为「一只小碟子 + 菜色」
  const s = Array.from(name || 'x').reduce((a, c) => a + c.charCodeAt(0), 0);
  const hues = [
    ['#F0B45C', '#C4622A', '#6E9B3C', '#E4B94E'], // 暖橙棕
    ['#F2A0A0', '#B04444', '#5F8A4A', '#E8C46A'], // 红油
    ['#B8DC8A', '#5F8A38', '#E2A94E', '#C9D96A'], // 青菜
    ['#F5D48A', '#C08A2A', '#7A5AA8', '#E0A860'], // 蛋液
    ['#E8B4A0', '#A85842', '#4E7A6A', '#D9C089']  // 卤香
  ];
  const pal = hues[s % hues.length];
  return `<div class="dish-art" style="--fdA:${pal[0]};--fdB:${pal[1]};--fdC:${pal[2]};--fdD:${pal[3]}"></div>`;
}

/* 菜品卡片 */
function dishCard(item, opts = {}) {
  const c = confDots(item.confidence);
  const stateCls = item.confidence >= 0.8 ? '' : item.confidence >= 0.5 ? 'warn' : 'risk';
  const d = lookupDish(item.name);
  const expanded = opts.expanded;

  let note = '';
  if (item.confidence >= 0.5 && item.confidence < 0.8) {
    note = `<div class="dc-note warn"><span>⚠</span><span>建议核对：价格或描述可能识别有误，点开菜品详情可对照</span></div>`;
  } else if (item.confidence < 0.5) {
    note = `<div class="dc-note risk"><span>⚠</span><span>没认准，可能是「${esc(item.candidates ? item.candidates[0] : item.name)}」</span></div>`;
  }

  const expand = expanded ? `
    <div class="dc-expand">
      <div class="dc-row"><span class="k">菜系</span><span class="v">${esc(d.cuisine)} · ${esc(d.region || '—')}</span></div>
      <div class="dc-row"><span class="k">主要食材</span><span class="v">${esc((d.ingredients || []).join('、'))}</span></div>
      <div class="dc-row"><span class="k">烹饪方式</span><span class="v">${esc((d.methods || []).join('、'))}</span></div>
      ${flavorDots(item.name)}
      <div class="dc-row" style="margin-top:8px"><span class="k">过敏原</span><span class="v" style="display:flex;gap:6px;flex-wrap:wrap">${allergenChips(item.name)}</span></div>
      <div class="dc-row"><span class="k">建议搭配</span><span class="v">${esc((d.pairWith || ['—']).join('、'))}</span></div>
      <div class="dc-row"><span class="k">参考做法</span><span class="v">${esc(d.tips || '—')}</span></div>
    </div>` : '';

  const cand = item.confidence < 0.5 ? `
    <div class="dc-expand">
      <div class="dc-row"><span class="k">候选菜品</span><span class="v">选择最接近的一项：</span></div>
      <div class="cand-list">
        ${(item.candidates || [item.name]).map(c => `
          <div class="cand-item" data-act="pick-cand" data-name="${esc(c)}" data-key="${item.key}">${esc(c)}</div>`).join('')}
        <div class="cand-item" data-act="swap-dish" data-key="${item.key}" style="border-color:var(--brand-primary);color:var(--brand-primary)">换一道菜 →</div>
      </div>
    </div>` : '';

  return `
    <div class="dish-card ${stateCls}" style="animation-delay:${(opts.delay || 0) * 60}ms">
      <div class="dc-head">
        <div class="dc-thumb">${dishArt(item.name)}</div>
        <div class="dc-info">
          <div class="dc-name-row">
            <span class="dc-name">${esc(item.name)}</span>
            <span class="dc-price">¥${item.price}</span>
          </div>
          <div class="dc-en">${esc(item.en || '')} <span class="pill cat">${esc(item.category)}</span></div>
          <div class="dc-conf">
            ${c.dots}<span class="txt ${c.cls}">${c.txt}</span>
            <span class="src" data-act="conf" data-name="${esc(item.name)}">来源 ▸</span>
          </div>
        </div>
      </div>
      <div class="dc-desc">${esc(item.desc || '')}</div>
      ${note}
      <div class="dc-meta">${allergenChips(item.name)}</div>
      ${expand}${cand}
      <div class="dc-foot">
        <div class="recipe-link" data-act="recipe" data-name="${esc(item.name)}">🥘 这样做 →</div>
        <div class="fix-btn" data-act="toggle-expand" data-key="${item.key}">${expanded ? '收起' : '详情'}</div>
        <div class="fix-btn" data-act="fix" data-key="${item.key}">纠错</div>
      </div>
    </div>`;
}

/* --------------------------------------------------------------------------
   页面
   -------------------------------------------------------------------------- */

const PAGES = {

  /* ===== 首页 ===== */
  home: () => `
    <div class="page">
      <div class="hero">
        <div class="hero-img">
          <div class="hero-food">
            <div class="plate"></div>
            <div class="fd fd1"></div><div class="fd fd2"></div>
            <div class="fd fd3"></div><div class="fd fd4"></div>
            <div class="fd fd5"></div>
            <div class="steam"><i></i><i></i><i></i></div>
          </div>
        </div>
        <button class="scan-cta" data-act="scan">📷　扫 菜 单</button>
      </div>

      <div class="hero-content">
        <div class="hero-brand">
          <span class="logo">MenuLens</span>
          <span class="hero-tag">AI</span>
        </div>
        <div class="hero-slogan">拍一张菜单，安心点一桌菜</div>
      </div>

      <div class="quick-grid">
        <button class="quick-card" data-act="scan">
          <span class="qi">🍽</span>
          <span class="qt">扫菜单点菜</span>
          <span class="qs">上传菜单，AI 帮你配一桌</span>
        </button>
        <button class="quick-card" data-act="go-cam">
          <span class="qi">🧑‍🍳</span>
          <span class="qt">拍照识菜</span>
          <span class="qs">看到好菜，问它做法</span>
        </button>
        <button class="quick-card" data-act="go-recipe">
          <span class="qi">📖</span>
          <span class="qt">AI 菜谱</span>
          <span class="qs">冰箱里有什么就做什么</span>
        </button>
        <button class="quick-card" data-act="go-history">
          <span class="qi">🕘</span>
          <span class="qt">历史记录</span>
          <span class="qs">翻回上次那家店</span>
        </button>
      </div>

      <div class="avoid-bar">
        <span class="ab-icon">🚫</span>
        <span class="ab-text">忌口已设置：<b>${state.globalAvoid.map(esc).join(' · ') || '无'}</b></span>
        <span class="ab-edit" data-act="open-avoid">编辑</span>
      </div>

      <div class="chat-entry" data-act="ask">
        <span class="ce-icon">✦</span>
        <span class="ce-txt">有什么想吃的？问我 →</span>
      </div>
      <div class="pad-bottom"></div>
    </div>
  `,

  /* ===== 拍照识菜（取景） ===== */
  cam: () => `
    <div class="page">
      <div class="cam-view">
        <div class="cv-food"></div>
        <div class="cam-frame"></div>
        <button class="cam-to-menu" data-act="scan">这是菜单 →</button>
        <div class="cam-tip">把菜品放进框里，尽量拍清</div>
        <div class="cam-bar">
          <div class="cam-side" data-act="toast" data-msg="演示版：从相册选择">🖼</div>
          <div class="cam-shutter" data-act="snap"></div>
          <div class="cam-side" data-act="toast" data-msg="演示版：切换摄像头">🔄</div>
        </div>
      </div>
      <div style="padding:18px 4px 0">
        <div class="card" style="background:var(--bg-brand-soft);box-shadow:none">
          <div style="font-size:14px;font-weight:600;margin-bottom:6px">💡 拍摄小技巧</div>
          <div style="font-size:13px;color:var(--text-secondary);line-height:1.7">
            · 光线充足，避免逆光<br>
            · 45° 斜拍，比正拍更容易认出来<br>
            · 招牌菜露出全貌，别被餐具挡住
          </div>
        </div>
      </div>
      <div class="pad-bottom"></div>
    </div>
  `,

  /* ===== 菜单识别结果 ===== */
  menu: () => {
    if (!state.menu) return PAGES.emptyScan();
    const items = state.menu.items;
    const confirmed = items.filter(i => i.confidence >= 0.5);
    const risky = items.filter(i => i.confidence < 0.5);
    const cats = ['荤菜', '凉菜', '主食', '素菜', '汤', '甜品'];
    const excludedN = state.plan?.excluded?.length || 0;

    return `
      <div class="page">
        <div class="section-title" style="margin-top:8px">
          ${esc(state.menu.meta.restaurant)}
          <span class="st-sub">${esc(state.menu.meta.cuisine)} · ${state.menu.meta.pages} 页</span>
        </div>

        ${excludedN ? `<div class="notice-bar info">
          <span>🚫</span><span>已按忌口排除 ${excludedN} 道：${esc(state.plan.excluded.slice(0,2).map(e=>e.name).join('、'))}</span>
        </div>` : ''}

        ${cats.map(cat => {
          const list = confirmed.filter(i => i.category === cat);
          if (!list.length) return '';
          return `<div class="section-title" style="font-size:13px;color:var(--text-secondary);margin:16px 0 8px">${cat} · ${list.length}</div>
            ${list.map((it, i) => dishCard(it, { delay: i, expanded: state.expanded === it.key })).join('')}`;
        }).join('')}

        ${risky.length ? `
          <div class="section-title" style="font-size:13px;color:var(--danger);margin:20px 0 8px">
            ⚠ 没认准的 ${risky.length} 项
          </div>
          ${risky.map((it, i) => dishCard(it, { delay: i })).join('')}` : ''}

        <div class="pad-bottom"></div>
      </div>

      <div class="sticky-cta">
        <div class="sc-info">
          <span>已识别 ${items.length} 项 · ${risky.length + items.filter(i => i.confidence >= 0.5 && i.confidence < 0.8).length} 项待确认</span>
          <span class="sc-help" data-act="open-conf-help">?</span>
        </div>
        <div class="sc-ctx">${ctxTagsHTML()}</div>
        <button class="btn-primary" data-act="open-constraint">✦ 生成点单方案</button>
      </div>`;
  },

  emptyScan: () => `
    <div class="page">
      <div class="empty">
        <div class="ei">🍽</div>
        <div class="et">还没识别菜单</div>
        <div class="es">扫一份餐厅菜单，我就能帮你看菜、配菜、避开忌口</div>
        <div class="eh"><button class="btn-primary" data-act="scan">📷 扫菜单</button></div>
      </div>
    </div>`,

  /* ===== 点单方案 ===== */
  plan: () => {
    const p = state.plan;
    if (!p || !p.ok) {
      return `<div class="page"><div class="empty">
        <div class="ei">🤔</div><div class="et">${p ? esc(p.emptyReason) : '还没有方案'}</div>
        <div class="eh"><button class="btn-secondary" data-act="scan">重新扫菜单</button></div>
      </div></div>`;
    }
    const pct = Math.min(100, Math.round(p.total / state.ctx.budget * 100));
    const over = p.total > state.ctx.budget;

    return `
      <div class="page">
        <div class="budget-bar ${over ? 'over' : ''}">
          <div class="bb-top">
            <span class="bb-total">¥${p.total}</span>
            <span class="bb-per">人均 ¥${p.perHead.toFixed(0)}</span>
          </div>
          <div class="bb-track"><div class="bb-fill" id="bb-fill" style="width:0"></div></div>
          <div class="bb-sub">
            <span>预算 ¥${state.ctx.budget}</span>
            <span style="margin-left:auto">建议 ${p.servings.toFixed(1)} 人份 · ${p.dishCount} 道菜</span>
          </div>
          ${p.adjusted ? `<div class="bb-sub" style="margin-top:4px"><span class="bb-adjust">⚙ ${esc(p.adjusted)}</span></div>` : ''}
        </div>

        ${p.warnings.map(w => `
          <div class="notice-bar warn"><span>⚠</span><span>${esc(w)}</span></div>`).join('')}

        ${Object.entries(p.grouped).map(([cat, list]) => `
          <div class="plan-group">
            <div class="pg-title">${cat}<span class="pg-count">${list.length} 道</span></div>
            ${list.map((dish, i) => `
              <div class="plan-card" style="animation-delay:${i*70}ms" data-pkey="${dish.key}">
                <div class="pc-head">
                  <span class="pc-name">${esc(dish.name)}</span>
                  <span class="pc-role">${esc(dish.role)}</span>
                  <span class="pc-price">¥${dish.price}</span>
                </div>
                <div class="pc-desc">${esc(dish.desc)}</div>
                <div class="pc-reason"><span class="pr-icon">💡</span><span>${esc(dish.reason)}</span></div>
                <div class="pc-swap" data-act="swap" data-key="${dish.key}">换一道 →</div>
              </div>`).join('')}
          </div>`).join('')}

        <div class="cta-row">
          <button class="btn-secondary" data-act="recipe-all">🥘 都要菜谱</button>
          <button class="btn-secondary" data-act="share">📤 分享卡片</button>
        </div>
        <div class="pad-bottom"></div>
      </div>

      <div class="sticky-cta">
        <div class="sc-info"><span>不满意？说说看，我重新配</span></div>
        <div class="sc-ctx">${ctxTagsHTML(true)}</div>
        <button class="btn-primary" data-act="ask">✦ 不够吃？告诉我 →</button>
      </div>`;
  },

  /* ===== 菜谱（单菜） ===== */
  recipe: () => {
    const r = state.recipe;
    if (!r) return PAGES.recipeTab();
    return `
      <div class="page">
        <div class="recipe-hero"><div class="rh-art dish-art" style="width:100%;height:100%"></div><div class="rh-mask"></div></div>
        <div style="position:relative;margin-top:-24px;z-index:2">
          <div class="card">
            <div style="font-size:23px;font-weight:700;letter-spacing:-.4px">${esc(r.name)}</div>
            <div style="font-size:13px;color:var(--text-tertiary);margin-top:2px">${esc(r.en || '')}</div>
          </div>
        </div>
        <div class="recipe-meta">
          <div class="meta-pill"><div class="mp-i">⏱</div><div class="mp-v">${r.time}分钟</div><div class="mp-l">耗时</div></div>
          <div class="meta-pill"><div class="mp-i">📊</div><div class="mp-v">${['','简单','中等','较难','困难'][r.difficulty] || '中等'}</div><div class="mp-l">难度</div></div>
          <div class="meta-pill"><div class="mp-i">👥</div><div class="mp-v">${r.servings}人份</div><div class="mp-l">份量</div></div>
        </div>

        <div class="card" style="margin-top:14px">
          <div style="font-size:15px;font-weight:600;margin-bottom:6px">食材清单</div>
          <div style="font-size:12.5px;color:var(--text-tertiary);margin-bottom:6px">
            ${r.have ? `按你现有的：${r.have.join('、')}` : '通用配方'}
          </div>
          ${[...(r.have || []), ...(r.missing || [])].map(x => `
            <div class="ing-line ${(r.have || []).includes(x) ? 'have' : 'miss'}">
              <span class="ig-mark">${(r.have || []).includes(x) ? '✓' : ''}</span>
              <span class="ig-n">${esc(x)}</span>
              <span class="ig-badge">${(r.have || []).includes(x) ? '已有' : '缺少'}</span>
            </div>`).join('')}
        </div>

        ${r.tips ? `<div class="notice-bar info" style="margin-top:12px"><span>🔑</span><span><b>关键技巧</b><br>${esc(r.tips)}</span></div>` : ''}

        <div class="card" style="margin-top:14px">
          <div style="font-size:15px;font-weight:600;margin-bottom:4px">做法步骤</div>
          ${r.steps.map((s, i) => `
            <div class="step">
              <div class="step-num">${i+1}</div>
              <div class="step-body">
                <div class="step-t">${esc(s.t)}</div>
                <div class="step-d">${esc(s.d)}</div>
                ${s.tip ? `<div class="step-tip"><span>💡</span><span>${esc(s.tip)}</span></div>` : ''}
              </div>
            </div>`).join('')}
        </div>

        ${r.pairWith ? `<div class="card" style="margin-top:14px">
          <div style="font-size:15px;font-weight:600;margin-bottom:8px">配什么好</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${r.pairWith.map(p => `<div class="chip" data-act="recipe" data-name="${esc(p)}">${esc(p)}</div>`).join('')}
          </div>
        </div>` : ''}

        <div class="cta-row">
          <button class="btn-secondary" data-act="fav" data-name="${esc(r.name)}">☆ 收藏</button>
          <button class="btn-secondary" data-act="share">📤 分享</button>
        </div>
        <div class="pad-bottom"></div>
      </div>`;
  },

  /* ===== 菜谱 Tab（选食材） ===== */
  recipeTab: () => `
    <div class="page">
      <div class="card" style="margin-top:8px;background:var(--brand-gradient);color:#fff;box-shadow:var(--brand-shadow)">
        <div style="font-size:19px;font-weight:700">冰箱里有什么？</div>
        <div style="font-size:13.5px;opacity:.92;margin-top:4px;line-height:1.5">告诉我现有食材，我给你能做的菜</div>
      </div>

      <div class="section-title" style="margin-top:20px">快速选择</div>
      <div class="chip-wrap" id="have-wrap">
        ${['鸡蛋', '番茄', '青菜', '鸡翅', '豆腐', '牛肉', '虾', '可乐'].map(x =>
          `<div class="chip" data-act="toggle-have" data-v="${x}">${x}</div>`).join('')}
      </div>

      <div class="section-title">口味偏好</div>
      <div class="segmented">
        ${[['light', '清淡'], ['normal', '正常'], ['heavy', '重口']].map(([k, t]) =>
          `<button class="seg ${(state.recipeTaste || 'normal') === k ? 'on' : ''}" data-act="taste" data-v="${k}">${t}</button>`).join('')}
      </div>

      <div class="section-title" style="margin-bottom:12px">
        烹饪时间
        <span class="st-sub" id="time-label">${state.recipeTime || 30} 分钟内</span>
      </div>
      <div class="slider-wrap">
        <input type="range" min="10" max="60" step="5" value="${state.recipeTime || 30}" id="time-range">
        <div class="slider-scale"><span>10分钟</span><span>35分钟</span><span>60分钟</span></div>
      </div>

      <button class="btn-primary" style="margin-top:20px" data-act="gen-recipe">✦ 生成菜谱</button>

      <div class="section-title" style="margin-top:24px">热门推荐</div>
      ${MOCK_RECIPES.map((r, i) => `
        <div class="hist-card" data-act="open-recipe" data-name="${esc(r.name)}">
          <div class="hist-thumb">🍳</div>
          <div class="hist-info">
            <div class="hist-t">${esc(r.name)}</div>
            <div class="hist-s">${esc(r.steps[0].d.slice(0, 22))}…</div>
            <div class="hist-m"><span>⏱ ${r.time}分钟</span><span>📊 ${['','简单','中等','较难'][r.difficulty]}</span></div>
          </div>
        </div>`).join('')}
      <div class="pad-bottom"></div>
    </div>`,

  /* ===== 我的 ===== */
  mine: () => `
    <div class="page">
      <div class="mine-head">
        <div class="mine-avatar">🧑‍🍳</div>
        <div style="flex:1">
          <div class="mine-name">美食探索者</div>
          <div class="mine-sub">已陪你看菜单 12 次</div>
          <div class="mine-stats">
            <div class="mine-stat"><div class="ms-v">12</div><div class="ms-l">识别菜单</div></div>
            <div class="mine-stat"><div class="ms-v">5</div><div class="ms-l">收藏菜品</div></div>
            <div class="mine-stat"><div class="ms-v">3</div><div class="ms-l">菜谱</div></div>
          </div>
        </div>
      </div>

      <div class="section-title">饮食设置</div>
      <div class="set-row" data-act="open-avoid">
        <span class="sr-i">🚫</span>
        <span class="sr-t">忌口与过敏原
          <small>${state.globalAvoid.map(esc).join('、') || '未设置'}</small>
        </span>
        <span class="sr-r">${state.globalAvoid.length} 项</span><span class="sr-arrow">›</span>
      </div>
      <div class="set-row" data-act="toast" data-msg="演示版：口味档案">
        <span class="sr-i">🎯</span>
        <span class="sr-t">口味档案<small>清淡 · 少油 · 不吃香菜</small></span>
        <span class="sr-arrow">›</span>
      </div>

      <div class="section-title">我的内容</div>
      <div class="set-row" data-act="go-history">
        <span class="sr-i">🕘</span>
        <span class="sr-t">历史记录<small>最近 3 次识别</small></span>
        <span class="sr-r">${state.history.length}</span><span class="sr-arrow">›</span>
      </div>
      <div class="set-row" data-act="toast" data-msg="演示版：收藏夹">
        <span class="sr-i">⭐</span>
        <span class="sr-t">收藏的菜品<small>${state.favs.length} 道</small></span>
        <span class="sr-arrow">›</span>
      </div>

      <div class="section-title">关于</div>
      <div class="set-row" data-act="toast" data-msg="MenuLens v1.0 · AI 美食伴侣">
        <span class="sr-i">ℹ️</span><span class="sr-t">关于 MenuLens</span><span class="sr-r">v1.0</span>
      </div>
      <div class="set-row" data-act="toast" data-msg="演示版：反馈">
        <span class="sr-i">💬</span><span class="sr-t">意见反馈</span><span class="sr-arrow">›</span>
      </div>

      <div class="notice-bar info" style="margin-top:20px">
        <span>🔒</span><span>你的照片与偏好仅用于生成点单方案，30 天后自动删除，不用于模型训练。</span>
      </div>
      <div class="pad-bottom"></div>
    </div>`,

  history: () => `
    <div class="page">
      <div class="section-title" style="margin-top:8px">最近 30 天<span class="st-sub">${state.history.length} 条</span></div>
      ${state.history.map(h => `
        <div class="hist-card" data-act="reopen" data-title="${esc(h.title)}">
          <div class="hist-thumb">${h.icon}</div>
          <div class="hist-info">
            <div class="hist-t">${esc(h.title)}</div>
            <div class="hist-s">${esc(h.sub)}</div>
            <div class="hist-m"><span>🕐 ${esc(h.time)}</span>${h.price ? `<span>💰 ¥${h.price}</span>` : ''}</div>
          </div>
        </div>`).join('')}
      <div class="pad-bottom"></div>
    </div>`,

  /* ===== 拍照识菜结果 ===== */
  dish: () => {
    const d = state.dish || MOCK_DISH;
    return `
      <div class="page">
        <div class="hero-dish">
          <div class="hd-img"><div class="dish-art" style="width:100%;height:100%"></div></div>
          <div class="hd-body">
            <div style="display:flex;align-items:baseline;gap:9px">
              <div class="hd-name">${esc(d.name)}</div>
              <span class="pill cat">${esc(d.category)}</span>
            </div>
            <div class="hd-en">${esc(d.en)}</div>
            <div class="dc-conf" style="margin-top:7px">
              ${confDots(d.confidence).dots}
              <span class="txt ${confDots(d.confidence).cls}">${confDots(d.confidence).txt}</span>
              <span class="src" data-act="conf" data-name="${esc(d.name)}">来源 ▸</span>
            </div>
          </div>
        </div>

        <div class="attr-grid">
          <div class="attr-cell"><div class="ac-l">菜系 / 产地</div><div class="ac-v">${esc(d.cuisine)} · ${esc(d.region)}</div></div>
          <div class="attr-cell"><div class="ac-l">烹饪方式</div><div class="ac-v">${esc(d.methods[0] || '—')}</div></div>
          <div class="attr-cell" style="grid-column:1/-1"><div class="ac-l">风味特点</div><div class="ac-v" style="font-weight:400;font-size:13.5px">${esc(d.flavorText)}</div></div>
        </div>

        <div class="card" style="margin-top:12px">
          <div style="font-size:15px;font-weight:600;margin-bottom:8px">主要食材</div>
          <div style="display:flex;flex-wrap:wrap;gap:7px">
            ${d.ingredients.map(x => `<span class="chip" style="height:30px;font-size:13px">${esc(x)}</span>`).join('')}
          </div>
        </div>

        <div class="notice-bar warn" style="margin-top:12px">
          <span>⚠</span><span>可能含：${d.allergens.map(esc).join('、') || '无常见过敏原'}　·　建议以餐厅实际为准</span>
        </div>

        <div class="section-title">你可能想问</div>
        ${[
          ['🥘 这道菜家常怎么做？', '家常版要先把肉馅炒干再加豆瓣酱，出红油后再加水。豆腐用淡盐水焯过不易碎，最后分两次勾芡才够亮滑。'],
          ['🌶 能不能做成不辣的？', '可以。去掉豆瓣酱和花椒粉，改用甜面酱 + 少量番茄酱调味，做成甜口版本，小孩也能吃。'],
          ['🍚 配什么主食最好？', '配米饭最稳。这道菜本身够下饭，建议米饭点两份；如果想更有层次，可以配一份干炒牛河。']
        ].map(([q, a]) => `
          <div class="qa-item">
            <div class="qa-q"><span class="qq-n">Q</span><span>${esc(q)}</span></div>
            <div class="qa-a">${esc(a)}</div>
          </div>`).join('')}

        <button class="btn-primary" style="margin-top:18px" data-act="recipe" data-name="${esc(d.name)}">🥘 生成完整菜谱</button>
        <div style="height:80px"></div>
      </div>
      <button class="fab" data-act="ask">✦</button>`;
  }
};

function ctxTagsHTML(onPlan = false) {
  const c = state.ctx;
  const spice = { none: '不辣', mild: '微辣', medium: '中辣', hot: '重辣' }[c.spiceLevel];
  return `
    <span class="xtag">👥 ${c.servings} 人</span>
    <span class="xtag">💰 ¥${c.budget}</span>
    <span class="xtag">🌶 ${spice}</span>
    ${c.avoid.length ? `<span class="xtag on">🚫 ${c.avoid.map(esc).join('·')}</span>` : ''}
    ${onPlan ? `<span class="xtag" data-act="open-constraint" style="color:var(--brand-primary);cursor:pointer">调整 ›</span>` : ''}`;
}

/* --------------------------------------------------------------------------
   底部面板
   -------------------------------------------------------------------------- */

let sheetCloseTimer = null;

function openSheet(html, cls = '') {
  if (sheetCloseTimer) { clearTimeout(sheetCloseTimer); sheetCloseTimer = null; }
  $('#sheets').innerHTML = `<div class="sheet ${cls}" id="sheet">${html}</div>`;
  $('#mask').classList.add('on');
  requestAnimationFrame(() => $('#sheet')?.classList.add('on'));
  $('#mask').onclick = closeSheet;
}

function closeSheet() {
  $('#sheet')?.classList.remove('on');
  $('#mask').classList.remove('on');
  if (sheetCloseTimer) clearTimeout(sheetCloseTimer);
  sheetCloseTimer = setTimeout(() => {
    // 只有当期间没有新面板打开时才清空，避免误删重渲染的面板
    const s = $('#sheet');
    if (s && !s.classList.contains('on')) $('#sheets').innerHTML = '';
    sheetCloseTimer = null;
  }, 300);
}

/** 面板内改动后就地重渲染（避免 close+open 的竞态） */
function rerenderSheet(html, cls, bind) {
  if (sheetCloseTimer) { clearTimeout(sheetCloseTimer); sheetCloseTimer = null; }
  openSheet(html, cls);
  if (bind) bind();
}

/* --- 约束面板 --- */
function constraintHTML() {
  const c = state.ctx;
  return `
    <div class="sh-handle"></div>
    <div class="sh-head">
      <span class="sh-title">调整你的需求</span>
      <span class="btn-ghost" data-act="reset-ctx">重置</span>
    </div>
    <div class="sh-body">
      <div class="ctl-group">
        <div class="ctl-label">用餐人数</div>
        <div class="stepper">
          <button class="st-btn" data-act="serv" data-d="-1" ${c.servings <= 1 ? 'disabled' : ''}>−</button>
          <span class="st-num">${c.servings} <small>人</small></span>
          <button class="st-btn" data-act="serv" data-d="1" ${c.servings >= 20 ? 'disabled' : ''}>+</button>
        </div>
      </div>

      <div class="ctl-group">
        <div class="ctl-label">总预算 <span class="cl-val">¥${c.budget}</span></div>
        <div class="budget-input-wrap">
          <div class="bi-box"><span>¥</span><input type="number" id="budget-in" value="${c.budget}" min="0" max="5000"></div>
        </div>
        <div class="slider-wrap">
          <input type="range" min="0" max="1000" step="10" value="${c.budget}" id="budget-range" style="--pct:${c.budget/10}%">
          <div class="slider-scale"><span>¥0</span><span>¥500</span><span>¥1000</span></div>
        </div>
      </div>

      <div class="ctl-group">
        <div class="ctl-label">辣度</div>
        <div class="segmented">
          ${[['none', '不辣'], ['mild', '微辣'], ['medium', '中辣'], ['hot', '重辣']].map(([k, t]) =>
            `<button class="seg ${c.spiceLevel === k ? 'on' : ''}" data-act="spice" data-v="${k}">${t}</button>`).join('')}
        </div>
      </div>

      <div class="ctl-group">
        <div class="ctl-label">忌口<span class="cl-sub">已选 ${c.avoid.length} 项</span></div>
        <div class="chip-wrap">
          ${AVOID_OPTIONS.map(a => `
            <div class="chip ${c.avoid.includes(a) ? 'on' : ''}" data-act="toggle-avoid" data-v="${a}">
              ${c.avoid.includes(a) ? '✓ ' : ''}${a}
            </div>`).join('')}
        </div>
      </div>

      <div class="ctl-group">
        <div class="ctl-label">用餐场景</div>
        <div class="segmented">
          ${[['quick', '快餐'], ['casual', '正餐'], ['feast', '宴客']].map(([k, t]) =>
            `<button class="seg ${c.occasion === k ? 'on' : ''}" data-act="occasion" data-v="${k}">${t}</button>`).join('')}
        </div>
      </div>

      <div class="estimate-hint ${estimateWarn(c) ? 'warn' : ''}" id="est-hint">${estimateText(c)}</div>
      <button class="btn-primary" data-act="do-plan">✦ 生成新方案</button>
      <div style="height:14px"></div>
    </div>`;
}

/** 预算滑块/输入的联动（每次面板渲染后重新绑定） */
function bindConstraint() {
  const c = state.ctx;
  const r = $('#budget-range'), bi = $('#budget-in');
  const sync = () => {
    const lbl = document.querySelector('.cl-val');
    if (lbl) lbl.textContent = '¥' + c.budget;
    updateEstimate();
  };
  r?.addEventListener('input', () => {
    c.budget = Math.min(1000, Math.max(0, parseInt(r.value, 10)));
    r.style.setProperty('--pct', c.budget / 10 + '%');
    if (bi) bi.value = c.budget;
    sync();
  });
  bi?.addEventListener('input', () => {
    c.budget = Math.min(5000, Math.max(0, parseInt(bi.value || 0, 10)));
    const v = Math.min(1000, c.budget);
    if (r) { r.value = v; r.style.setProperty('--pct', v / 10 + '%'); }
    sync();
  });
}

function constraintSheet() {
  openSheet(constraintHTML(), 'sheet-constraint');
  bindConstraint();
}

function estimateText(c) {
  const per = c.budget / Math.max(c.servings, 1);
  const n = Math.max(2, Math.round(c.servings * 1.3));
  return `按当前约束，预计可点 ${n} 道菜，人均 ¥${per.toFixed(0)}`;
}
function estimateWarn(c) {
  return c.budget < c.servings * 15;
}
function updateEstimate() {
  const el = $('#est-hint');
  if (!el) return;
  el.textContent = estimateText(state.ctx);
  el.classList.toggle('warn', estimateWarn(state.ctx));
}

/* --- 忌口设置面板 --- */
function avoidHTML() {
  return `
    <div class="sh-handle"></div>
    <div class="sh-head"><span class="sh-title">忌口与过敏原</span></div>
    <div class="sh-body">
      <div class="notice-bar info"><span>💡</span><span>这里的设置会全局生效——识别结果、点单方案、菜谱推荐都会避开它们。</span></div>

      <div class="ctl-group">
        <div class="ctl-label">忌口（不吃）</div>
        <div class="chip-wrap">
          ${AVOID_OPTIONS.map(a => `
            <div class="chip ${state.globalAvoid.includes(a) ? 'on' : ''}" data-act="toggle-gavoid" data-v="${a}">
              ${state.globalAvoid.includes(a) ? '✓ ' : ''}${a}
            </div>`).join('')}
        </div>
      </div>

      <div class="ctl-group">
        <div class="ctl-label">过敏原（严格过滤）<span class="cl-sub">硬约束，不可绕过</span></div>
        <div class="chip-wrap">
          ${ALLERGENS.map(a => `
            <div class="chip ${state.allergens.includes(a) ? 'on' : ''}" data-act="toggle-allergen" data-v="${a}">
              ${state.allergens.includes(a) ? '✓ ' : ''}${a}
            </div>`).join('')}
        </div>
      </div>

      <button class="btn-primary" data-act="save-avoid">保存</button>
      <div style="height:14px"></div>
    </div>`;
}

function avoidSheet() {
  openSheet(avoidHTML(), 'sheet-constraint');
}

/* --- 置信度说明 --- */
function confSheet(name) {
  const it = state.menu?.items.find(x => x.name === name);
  const conf = it ? it.confidence : (MOCK_DISH.confidence || 0.9);
  const vision = Math.min(0.99, conf * 1.02);
  const hasKB = !!DISH_DB[name];
  const kb = hasKB ? 0.95 : 0.35;
  const ocr = it && it.desc && it.desc.length > 5;

  openSheet(`
    <div class="sh-handle"></div>
    <div class="sh-head">
      <span class="sh-title">这个 ${Math.round(conf*100)}% 是怎么来的？</span>
    </div>
    <div class="sh-body">
      <div class="card" style="margin-bottom:14px">
        <div class="conf-row">
          <div class="cr-head"><span>视觉模型菜名置信度</span><span class="cr-v">${vision.toFixed(2)}</span></div>
          <div class="conf-track"><div class="ct-fill" style="width:${vision*100}%"></div></div>
        </div>
        <div class="conf-row">
          <div class="cr-head"><span>知识库模糊匹配</span><span class="cr-v">${kb.toFixed(2)}</span></div>
          <div class="conf-track"><div class="ct-fill" style="width:${kb*100}%"></div></div>
        </div>
        <div class="conf-row">
          <div class="cr-head"><span>OCR 文本命中加成</span><span class="cr-v">${ocr ? '+0.15' : '+0.00'}</span></div>
          <div class="conf-track"><div class="ct-fill" style="width:${ocr ? 100 : 0}%"></div></div>
        </div>
        <div class="conf-formula">
          综合置信度 = 视觉 × 0.6 + 知识库 × 0.3 + OCR 加成 × 0.1<br>
          · OCR 未命中且视觉 &lt; 0.6 → 结果 × 0.8<br>
          · 名称与知识库无任何匹配 → 结果 × 0.7
        </div>
        <div class="conf-total">
          <span class="cft-l">综合置信度</span>
          <span class="cft-v">${conf.toFixed(2)}</span>
        </div>
      </div>
      <div class="notice-bar info"><span>🔍</span><span>把置信度摊开给你看，是 MenuLens 的设计原则——不确定的东西，我们不装作确定。</span></div>
      <div style="height:14px"></div>
    </div>
  `, 'sheet-constraint');
}

/* --- 换一道 --- */
function swapSheet(key) {
  const chosen = state.plan ? Object.values(state.plan.grouped).flat() : [];
  const chosenNames = chosen.map(c => c.name);
  const { kept } = (function () {
    const avoid = state.ctx.avoid;
    return {
      kept: state.menu.items.filter(it => {
        const d = lookupDish(it.name);
        const hay = [it.name, it.desc || '', (d.ingredients || []).join(' ')].join(' ');
        return !avoid.some(a => hay.includes(a));
      })
    };
  })();

  const pool = kept.filter(it => !chosenNames.includes(it.name));
  openSheet(`
    <div class="sh-handle"></div>
    <div class="sh-head"><span class="sh-title">换一道菜</span></div>
    <div class="sh-body">
      <div class="notice-bar info"><span>💡</span><span>预算上限 ¥${state.ctx.budget}，已避开你的忌口</span></div>
      <div class="pick-list">
        ${pool.length ? pool.map(it => `
          <div class="pick-item" data-act="do-swap" data-key="${key}" data-new="${it.key}">
            <div style="width:44px;height:44px;border-radius:11px;overflow:hidden;flex-shrink:0">${dishArt(it.name)}</div>
            <div style="flex:1;min-width:0">
              <div class="pi-n">${esc(it.name)}</div>
              <div class="pi-d">${esc(it.desc || '').slice(0, 18)}</div>
            </div>
            <span class="pi-p">¥${it.price}</span>
          </div>`).join('') : `<div class="empty" style="padding:34px 0">
            <div class="ei">🍽</div><div class="es">其他菜都已经在方案里了</div></div>`}
      </div>
      <div style="height:14px"></div>
    </div>
  `, 'sheet-constraint');
}

/* --- AI 助手抽屉 --- */
function chatSheet() {
  openSheet(`
    <div class="sh-handle"></div>
    <div class="sh-head">
      <span class="sh-title">✦ AI 助手</span>
      <span class="btn-ghost" data-act="clear-chat">清空</span>
      <span class="btn-ghost" data-act="close-sheet">✕</span>
    </div>
    <div class="sh-body" id="chat-body">
      ${chatHTML()}
    </div>
    <div class="quick-cmds" style="padding:6px 20px 0">
      ${['不吃香菜', '预算 300', '要清淡点', '帮我搭配', '哪道最值得点'].map(x =>
        `<div class="chip" data-act="quick" data-v="${x}">${x}</div>`).join('')}
    </div>
    <div class="chat-input-bar">
      <input class="cif" id="chat-in" placeholder="说点什么…" autocomplete="off">
      <button class="mic" data-act="mic">🎤</button>
    </div>
  `, 'sheet-chat');

  const inp = $('#chat-in');
  inp?.addEventListener('keydown', e => {
    if (e.key === 'Enter') { sendChat(inp.value); }
  });
  scrollChat();
}

function chatHTML() {
  if (!state.chat.length) {
    return `<div style="text-align:center;padding:36px 20px">
      <div style="font-size:38px">✦</div>
      <div style="font-size:16px;font-weight:600;margin-top:10px">我是你的点菜助手</div>
      <div style="font-size:13.5px;color:var(--text-secondary);margin-top:8px;line-height:1.7">
        我可以帮你：<br>
        ① 扫一份菜单，按人数预算配一桌<br>
        ② 换个菜、改预算、调辣度忌口<br>
        ③ 问某道菜的做法、来源、搭配
      </div>
    </div>`;
  }
  return `<div class="chat-list">${state.chat.map(m => {
    if (m.type === 'thinking') return thinkingHTML(m);
    if (m.type === 'ctxchange') {
      return `<div class="msg" style="max-width:100%">
        <div style="background:var(--bg-brand-soft);color:#8A4A20;border-radius:12px;padding:9px 13px;font-size:13px;display:flex;gap:8px;align-items:center">
          <span>✓</span><span>${esc(m.text)}</span></div></div>`;
    }
    if (m.role === 'user') {
      return `<div class="msg user">${m.img
        ? `<div class="msg-img">${m.img}</div>`
        : `<div class="bubble">${esc(m.text)}</div>`}</div>`;
    }
    // 流式过程中先占位，等下面把 hits 补进来
    const msgIdx = state.chat.length - 1;
    return `<div class="msg ai"><div class="bubble">${mdLite(m.text)}
      ${m.source ? `<div class="src-toggle" data-act="toggle-src">▸ 来源：${esc(m.source)}</div>` : ''}
      ${(m.hits && m.hits.length)
        ? `<div class="kb-src">
             <div class="kb-src-head">▸ 知识库依据 ${m.hits.length} 条</div>
             <div class="kb-src-body">${m.hits.map(h =>
               `<div class="kb-src-item"><b>${esc(h.title)}</b><span>${esc(h.source || '')} · 匹配 ${h.score}</span></div>`
             ).join('')}</div>
           </div>`
        : ''}
    </div></div>`;
  }).join('')}</div>`;
}

function thinkingHTML(m) {
  return `<div class="msg ai"><div class="thinking">
    <div class="th-head">✦ 正在处理<span class="th-time">${m.elapsed || ''}</span></div>
    ${m.steps.map(s => `<div class="th-step ${s.state}"><span class="ts-dot">${s.state === 'done' ? '✓' : ''}</span><span>${esc(s.text)}</span></div>`).join('')}
  </div></div>`;
}

function nl2br(s) {
  return esc(s).replace(/\n/g, '<br>');
}

/**
 * 聊天消息的轻量 markdown 渲染。
 *
 * 知识库正文本身是 markdown（`**加粗**`、`| 表格 |`），只做 esc + 换行会让
 * 屏幕上出现一堆星号和竖线。这里只支持两种语法——加粗与表格——因为
 * 知识库实际就用这两种；不引第三方库，保持 file:// 双击可用。
 *
 * 顺序很重要：**先转义再套标签**，否则用户/语料里的尖括号会被当 HTML 执行。
 */
function mdLite(s) {
  const raw = String(s == null ? '' : s);
  const lines = raw.split('\n');
  const out = [];
  let table = [];

  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter(l => !/^\|[\s\-:|]+\|$/.test(l));
    if (rows.length) {
      const cells = rows.map(l => l.replace(/^\||\|$/g, '').split('|').map(c => c.trim()));
      const head = cells[0];
      const body = cells.slice(1);
      out.push('<div class="md-table">' +
        '<div class="md-tr md-th">' + head.map(c => '<span>' + inline(c) + '</span>').join('') + '</div>' +
        body.map(r => '<div class="md-tr">' + r.map(c => '<span>' + inline(c) + '</span>').join('') + '</div>').join('') +
        '</div>');
    }
    table = [];
  };

  const inline = t => esc(t).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');

  lines.forEach(line => {
    if (/^\s*\|.*\|\s*$/.test(line)) { table.push(line.trim()); return; }
    flushTable();
    out.push(inline(line));
  });
  flushTable();

  // 空行折叠成段落间距，避免气泡里出现大片空白
  return out.join('<br>').replace(/(<br>\s*){3,}/g, '<br><br>');
}

function scrollChat() {
  const b = $('#chat-body');
  if (b) b.scrollTop = b.scrollHeight;
}

/* --------------------------------------------------------------------------
   Toast
   -------------------------------------------------------------------------- */

function toast(msg, ms = 1900) {
  const host = $('#toast-host');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s, transform .25s';
    el.style.opacity = '0';
    el.style.transform = 'translate(-50%, -8px)';
    setTimeout(() => el.remove(), 260);
  }, ms);
}

/* --------------------------------------------------------------------------
   流程：扫菜单 → 识别
   -------------------------------------------------------------------------- */

function startScan() {
  closeSheet();
  go('menu');
  state.menu = null;
  $('#screen').innerHTML = scanningPage();
  runRecognition();
}

function scanningPage() {
  const steps = [
    { t: '上传图片', s: 'done' },
    { t: '识别菜单版式与文字', s: 'doing' },
    { t: '匹配菜品知识库', s: '' },
    { t: '计算每项置信度', s: '' }
  ];
  return `<div class="page">
    <div style="text-align:center;padding:60px 20px 30px">
      <div style="font-size:46px">📷</div>
      <div class="thinking" style="margin-top:22px;text-align:left">
        <div class="th-head">✦ 正在识别<span class="th-time" id="scan-timer">0.0s</span></div>
        ${steps.map((s, i) => `<div class="th-step ${s.s}" id="sc-${i}"><span class="ts-dot">${s.s === 'done' ? '✓' : ''}</span><span>${s.t}</span></div>`).join('')}
      </div>
      <button class="btn-ghost" style="margin-top:20px" data-act="cancel-scan">取消</button>
    </div>
    <div class="pad-bottom"></div>
  </div>`;
}

async function runRecognition() {
  const t0 = performance.now();
  const timer = setInterval(() => {
    const el = $('#scan-timer');
    if (el) el.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
  }, 100);

  const seq = [
    [0, 350], [1, 750], [2, 420], [3, 350]
  ];
  for (const [i, delay] of seq) {
    await wait(delay);
    const done = $('#sc-' + i), doing = $('#sc-' + (i + 1));
    if (done) { done.className = 'th-step done'; done.querySelector('.ts-dot').textContent = '✓'; }
    if (doing) doing.className = 'th-step doing';
  }
  await wait(400);
  clearInterval(timer);

  state.menu = parseMenu();
  state.expanded = null;
  renderPage();
  const fill = $('#bb-fill');
  if (fill) requestAnimationFrame(() => { fill.style.width = Math.min(100, 100) + '%'; });
  toast(`已识别 ${state.menu.items.length} 道菜`);
}

const wait = ms => new Promise(r => setTimeout(r, ms));

/* --------------------------------------------------------------------------
   流程：生成方案（带 Agent 思考态）
   -------------------------------------------------------------------------- */

async function runPlan(showSheet = false) {
  closeSheet();
  go('plan');
  state.plan = null;
  $('#screen').innerHTML = planThinkingPage();

  const t0 = performance.now();
  const stepEls = ['ft0', 'ft1', 'ft2', 'ft3'];
  const fakeSteps = [
    '过滤忌口与过敏原',
    '按预算与口味排序候选',
    '组合荤素搭配',
    '校验预算与份量'
  ];
  fakeSteps.forEach((t, i) => {
    const el = $('#' + stepEls[i]);
    if (el) {
      el.className = 'th-step';
      el.innerHTML = `<span class="ts-dot"></span><span>${t}</span>`;
    }
  });

  const timer = setInterval(() => {
    const el = $('#plan-timer');
    if (el) el.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
  }, 100);

  for (let i = 0; i < 4; i++) {
    await wait(i === 0 ? 380 : 520);
    const el = $('#' + stepEls[i]);
    if (el) { el.className = 'th-step done'; el.querySelector('.ts-dot').textContent = '✓'; }
    if (stepEls[i + 1]) {
      const n = $('#' + stepEls[i + 1]);
      if (n) n.className = 'th-step doing';
    }
  }

  state.plan = await planRemote(state.ctx, state.menu?.items || MOCK_MENU.items);
  await wait(280);
  clearInterval(timer);
  renderPage();

  const fill = $('#bb-fill');
  if (fill && state.plan?.ok) {
    requestAnimationFrame(() => {
      fill.style.width = Math.min(100, Math.round(state.plan.total / state.ctx.budget * 100)) + '%';
    });
  }
  if (state.plan?.ok) toast(`配好 ${state.plan.dishCount} 道菜，共 ¥${state.plan.total}`);
  else toast(state.plan?.emptyReason || '没找到合适的菜');
}

function planThinkingPage() {
  return `<div class="page">
    <div style="text-align:center;padding:56px 20px 30px">
      <div style="font-size:44px">🧑‍🍳</div>
      <div style="font-size:18px;font-weight:700;margin-top:14px">正在给你搭配</div>
      <div style="font-size:13.5px;color:var(--text-secondary);margin-top:5px">
        👥 ${state.ctx.servings} 人 · 💰 ¥${state.ctx.budget}${state.ctx.avoid.length ? ' · 🚫 ' + state.ctx.avoid.join('、') : ''}
      </div>
      <div class="thinking" style="margin-top:22px;text-align:left">
        <div class="th-head">✦ AI 正在工作<span class="th-time" id="plan-timer">0.0s</span></div>
        <div id="ft0" class="th-step doing"><span class="ts-dot"></span><span>过滤忌口与过敏原</span></div>
        <div id="ft1" class="th-step"><span class="ts-dot"></span><span>按预算与口味排序候选</span></div>
        <div id="ft2" class="th-step"><span class="ts-dot"></span><span>组合荤素搭配</span></div>
        <div id="ft3" class="th-step"><span class="ts-dot"></span><span>校验预算与份量</span></div>
      </div>
    </div>
    <div class="pad-bottom"></div>
  </div>`;
}

/* --------------------------------------------------------------------------
   流程：对话
   -------------------------------------------------------------------------- */

async function sendChat(text) {
  if (!text || !text.trim()) return;
  closeSheet();
  chatSheet();

  state.chat.push({ role: 'user', text: text.trim() });
  $('#chat-body').innerHTML = chatHTML();
  scrollChat();

  // 越权拦截（硬性规则）
  if (isJailbreak(text)) {
    await wait(420);
    state.chat.push({ role: 'ai', text: '这个我帮不上哦。我只会聊菜品、菜单和做法——换个关于菜的问题试试？' });
    refreshChat();
    return;
  }

  if (isOffTopic(text)) {
    await wait(420);
    state.chat.push({ role: 'ai', text: '我是个点菜助手，股票天气这些帮不了你。要不看看今天吃什么？' });
    refreshChat();
    return;
  }

  const thinking = {
    type: 'thinking',
    steps: [
      { text: '理解你的意图', state: 'doing' },
      { text: '更新点单约束', state: '' },
      { text: '重新计算方案', state: '' }
    ],
    elapsed: '0.0s'
  };
  const intent = detectIntent(text);
  if (intent === 'explain' || intent === 'ingredient' || intent === 'allergy') {
    thinking.steps = [
      { text: '理解你的意图', state: 'doing' },
      { text: '检索菜品知识库', state: '' }
    ];
  }
  state.chat.push(thinking);
  refreshChat();

  const t0 = performance.now();
  const tick = setInterval(() => {
    const last = state.chat[state.chat.length - 1];
    if (last?.type === 'thinking') {
      last.elapsed = ((performance.now() - t0) / 1000).toFixed(1) + 's';
      refreshChat();
    }
  }, 100);

  await wait(700 + Math.random() * 500);
  const rep = await ask(text, state.ctx, state.plan, state.menu?.items || MOCK_MENU.items);

  clearInterval(tick);
  state.chat = state.chat.filter(m => m.type !== 'thinking');

  // 约束修改
  if (rep.patch) {
    Object.assign(state.ctx, rep.patch);
    const changes = [];
    if (rep.patch.avoid) changes.push(`忌口 +${rep.patch.avoid.filter(a => !state.globalAvoid.includes(a)).join('、') || ''}`);
    if (rep.patch.budget) changes.push(`预算 ¥${rep.patch.budget}`);
    if (rep.patch.servings) changes.push(`人数 ${rep.patch.servings} 人`);
    if (rep.patch.spiceLevel) changes.push(`辣度 ${{ none: '不辣', mild: '微辣', medium: '中辣', hot: '重辣' }[rep.patch.spiceLevel]}`);
    if (changes.length) state.chat.push({ type: 'ctxchange', text: `约束已更新：${changes.join(' · ')}` });
  }

  state.chat.push({
    role: 'ai',
    text: rep.text,
    // 有知识库依据时如实标注数据来源，别笼统写「本地推理」——
    // 用户要能分清「查了资料」和「凭空生成的」
    source: rep.source || (rep.hits && rep.hits.length
      ? '本地知识库检索'
      : (rep.remote ? '远端模型' : '本地 Agent 推理')),
    hits: rep.hits || []
  });

  // 触发重算
  if (rep.replan && state.menu) {
    refreshChat();
    scrollChat();
    await wait(420);
    state.plan = await planRemote(state.ctx, state.menu.items);
    closeSheet();
    go('plan');
    const fill = $('#bb-fill');
    if (fill) requestAnimationFrame(() => { fill.style.width = Math.min(100, Math.round(state.plan.total / state.ctx.budget * 100)) + '%'; });
    toast('已按新条件重新搭配');
    return;
  }

  if (rep.recipe) {
    openRecipe(rep.recipe);
    return;
  }

  if (rep.swap) {
    doRandomSwap();
    refreshChat();
    scrollChat();
    return;
  }

  refreshChat();
  scrollChat();
}

function refreshChat() {
  const b = $('#chat-body');
  if (b) { b.innerHTML = chatHTML(); scrollChat(); }
}

/* --------------------------------------------------------------------------
   菜谱
   -------------------------------------------------------------------------- */

function openRecipe(name) {
  closeSheet();
  const fromMock = MOCK_RECIPES.find(r => r.name === name || name.includes(r.name));
  if (fromMock) {
    state.recipe = fromMock;
  } else {
    const d = lookupDish(name);
    state.recipe = {
      name: d.nameZh, en: d.nameEn, time: d.time || 30, difficulty: d.difficulty || 2,
      servings: 2, match: 0.8, cuisine: d.cuisine,
      have: (d.ingredients || []).slice(0, 3), missing: (d.ingredients || []).slice(3),
      tips: d.tips,
      steps: (d.methods || ['暂无做法']).map((m, i) => ({ t: `第 ${i + 1} 步`, d: m, tip: i === 0 ? d.tips : '' })),
      pairWith: d.pairWith
    };
  }
  go('recipe');
}

function genRecipeFromPantry() {
  const have = Array.from(document.querySelectorAll('#have-wrap .chip.on')).map(e => e.dataset.v);
  if (!have.length) { toast('先选几个你有的食材'); return; }
  toast('正在配菜…');
  setTimeout(() => {
    // 匹配率 = 有多少比例匹配上的食材
    const scored = MOCK_RECIPES.map(r => {
      const hit = r.have.filter(x => have.some(h => h.includes(x.slice(0, 2)))).length;
      return { ...r, match: Math.min(0.98, 0.45 + hit / Math.max(r.have.length, 1) * 0.5 + Math.random() * 0.08) };
    }).sort((a, b) => b.match - a.match);

    const best = scored[0];
    state.recipe = {
      ...best,
      have: have.filter(h => !best.have.some(b => h.includes(b.slice(0, 2)))),
      missing: best.missing,
      tips: `匹配度 ${Math.round(best.match * 100)}% · 基于你现有的「${have.join('、')}」生成`
    };
    go('recipe');
    toast(`推荐「${best.name}」`);
  }, 900);
}

/* --------------------------------------------------------------------------
   换菜
   -------------------------------------------------------------------------- */

function doSwap(key, newKey) {
  closeSheet();
  const newItem = state.menu.items.find(x => x.key === newKey);
  if (!newItem) return;
  state.plan = generatePlan(state.ctx, state.menu.items);

  // 保留交换痕迹：记录哪道被换了
  state.plan.adjusted = state.plan.adjusted || `已把一道换成「${newItem.name}」`;
  renderPage();
  const card = $(`[data-pkey="${key}"]`);
  card?.classList.add('swapping');
  toast(`已换成「${newItem.name}」`);
}

function doRandomSwap() {
  if (!state.plan?.ok) return;
  const pool = state.menu.items.filter(it => {
    const chosen = Object.values(state.plan.grouped).flat().map(c => c.name);
    if (chosen.includes(it.name)) return false;
    const d = lookupDish(it.name);
    const hay = [it.name, it.desc || '', (d.ingredients || []).join(' ')].join(' ');
    return !state.ctx.avoid.some(a => hay.includes(a));
  });
  if (!pool.length) { toast('其他菜都已经在方案里了'); return; }
  const last = Object.values(state.plan.grouped).flat().slice(-1)[0];
  doSwap(last.key, pool[Math.floor(Math.random() * pool.length)].key);
}

/* --------------------------------------------------------------------------
   事件
   -------------------------------------------------------------------------- */

document.addEventListener('click', async e => {
  const el = e.target.closest('[data-act],[data-tab]');
  if (!el) return;
  const act = el.dataset.act;
  const c = state.ctx;

  /* Tab 切换 */
  if (el.dataset.tab) {
    state.tab = el.dataset.tab;
    state.route = el.dataset.tab;
    state.navStack = [];
    renderFrame();
    return;
  }

  /* 返回 */
  if (act === 'back') {
    if ($('#sheet')) { closeSheet(); return; }
    if (state.navStack.length) {
      const prev = state.navStack.pop();
      state.route = prev.route;
      state.tab = prev.tab || state.tab;
    } else if (state.route === 'menu') { state.route = 'home'; state.tab = 'home'; }
    else if (state.route === 'plan') { state.route = 'menu'; }
    else if (state.route === 'dish') { state.route = 'cam'; }
    else if (state.route === 'history') { state.route = 'mine'; state.tab = 'mine'; }
    else { state.route = 'home'; state.tab = 'home'; }
    renderFrame();
    return;
  }

  switch (act) {

    /* === 导航 === */
    case 'scan': startScan(); break;
    case 'go-cam': go('cam', 'cam'); break;
    case 'go-recipe': go('recipeTab', 'recipeTab'); break;
    case 'go-history': go('history'); break;
    case 'cancel-scan': state.route = 'home'; state.tab = 'home'; renderFrame(); break;
    case 'reopen':
      state.menu = parseMenu();
      go('menu');
      toast(`已恢复「${el.dataset.title}」`);
      break;

    /* === 拍照识菜 === */
    case 'snap': {
      state.navStack.push({ route: 'cam', tab: 'cam' });
      state.route = 'dish';
      state.dish = MOCK_DISH;
      $('#screen').innerHTML = snapThinkingPage();
      const t0 = performance.now();
      const tm = setInterval(() => {
        const el = $('#snap-timer');
        if (el) el.textContent = ((performance.now() - t0) / 1000).toFixed(1) + 's';
      }, 100);
      for (let i = 0; i < 3; i++) {
        await wait(i === 0 ? 420 : 480);
        const d = $('#sp-' + i);
        if (d) { d.className = 'th-step done'; d.querySelector('.ts-dot').textContent = '✓'; }
        const n = $('#sp-' + (i + 1));
        if (n) n.className = 'th-step doing';
      }
      await wait(400);
      clearInterval(tm);
      renderPage();
      toast('认出这道菜了');
      break;
    }

    /* === 菜品卡 === */
    case 'toggle-expand': {
      const k = el.dataset.key;
      state.expanded = state.expanded === k ? null : k;
      renderPage();
      break;
    }
    case 'fix': {
      const item = state.menu?.items.find(x => x.key === el.dataset.key);
      if (item) {
        const nn = prompt('修正菜名', item.name);
        if (nn && nn.trim()) {
          item.name = nn.trim();
          item.confidence = Math.max(item.confidence, 0.9);
          item.uncertain = false;
          item.needsConfirm = false;
          renderPage();
          toast('已修正，记住了');
        }
      }
      break;
    }
    case 'pick-cand': {
      const item = state.menu?.items.find(x => x.key === el.dataset.key);
      if (item) {
        item.name = el.dataset.name;
        item.confidence = 0.85;
        item.uncertain = false;
        renderPage();
        toast(`已确认为「${item.name}」`);
      }
      break;
    }
    case 'swap-dish': {
      toast('先点下面「生成点单方案」，就能换菜了');
      break;
    }
    case 'conf': confSheet(el.dataset.name); break;
    case 'recipe': openRecipe(el.dataset.name); break;
    case 'recipe-all': {
      const first = Object.values(state.plan.grouped)[0]?.[0];
      if (first) { openRecipe(first.name); toast('先看第一道，其余可点上方卡片切换'); }
      break;
    }
    case 'open-recipe': openRecipe(el.dataset.name); break;
    case 'fav': {
      const n = el.dataset.name;
      if (!state.favs.includes(n)) { state.favs.push(n); toast('已收藏'); }
      else toast('已经收藏过了');
      break;
    }
    case 'share': toast('演示版：卡片已生成到相册'); break;

    /* === 约束 === */
    case 'open-constraint': constraintSheet(); break;
    case 'serv': {
      c.servings = Math.min(20, Math.max(1, c.servings + parseInt(el.dataset.d, 10)));
      // 原地更新，避免整块重渲染导致连点丢失
      const num = $('.st-num'), minus = $('[data-act="serv"][data-d="-1"]'), plus = $('[data-act="serv"][data-d="1"]');
      if (num) num.innerHTML = `${c.servings} <small>人</small>`;
      if (minus) minus.disabled = c.servings <= 1;
      if (plus) plus.disabled = c.servings >= 20;
      updateEstimate();
      break;
    }
    case 'spice': {
      c.spiceLevel = el.dataset.v;
      // 原地切换 segmented 与忌口计数
      $$('.sheet [data-act="spice"]').forEach(s => s.classList.toggle('on', s.dataset.v === el.dataset.v));
      updateEstimate();
      break;
    }
    case 'occasion': {
      c.occasion = el.dataset.v;
      $$('.sheet [data-act="occasion"]').forEach(s => s.classList.toggle('on', s.dataset.v === el.dataset.v));
      break;
    }
    case 'toggle-avoid': {
      const v = el.dataset.v;
      const on = !c.avoid.includes(v);
      if (on) c.avoid.push(v); else c.avoid = c.avoid.filter(x => x !== v);
      el.classList.toggle('on', on);
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 240);
      const sub = $('.sheet [data-act="toggle-avoid"]')?.parentElement?.querySelector('.cl-sub');
      if (sub) sub.textContent = `已选 ${c.avoid.length} 项`;
      updateEstimate();
      break;
    }
    case 'reset-ctx': {
      Object.assign(c, { servings: 2, budget: 200, spiceLevel: 'medium', avoid: [...state.globalAvoid], occasion: 'casual' });
      rerenderSheet(constraintHTML(), 'sheet-constraint', bindConstraint);
      toast('已重置');
      break;
    }
    case 'do-plan': {
      closeSheet();
      if (!state.menu) { state.menu = parseMenu(); }
      runPlan();
      break;
    }

    /* === 忌口设置 === */
    case 'open-avoid': avoidSheet(); break;
    case 'toggle-gavoid': {
      const v = el.dataset.v;
      const on = !state.globalAvoid.includes(v);
      if (on) state.globalAvoid.push(v); else state.globalAvoid = state.globalAvoid.filter(x => x !== v);
      el.classList.toggle('on', on);
      el.innerHTML = (on ? '✓ ' : '') + v;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 240);
      break;
    }
    case 'toggle-allergen': {
      const v = el.dataset.v;
      const on = !state.allergens.includes(v);
      if (on) state.allergens.push(v); else state.allergens = state.allergens.filter(x => x !== v);
      el.classList.toggle('on', on);
      el.innerHTML = (on ? '✓ ' : '') + v;
      el.classList.add('bump');
      setTimeout(() => el.classList.remove('bump'), 240);
      break;
    }
    case 'save-avoid': {
      state.ctx.avoid = [...state.globalAvoid];
      state.ctx.allergenSeverity = {};
      state.allergens.forEach(a => state.ctx.allergenSeverity[a] = 'allergy');
      closeSheet();
      renderPage();
      toast('已保存，之后自动生效');
      break;
    }

    /* === 换菜 === */
    case 'swap': swapSheet(el.dataset.key); break;
    case 'do-swap': doSwap(el.dataset.key, el.dataset.new); break;

    /* === 对话 === */
    case 'ask': chatSheet(); break;
    case 'close-sheet': closeSheet(); break;
    case 'clear-chat': state.chat = []; refreshChat(); break;
    case 'quick': sendChat(el.dataset.v); break;
    case 'mic': toast('演示版：语音输入'); break;
    case 'toggle-src': {
      const d = el.nextElementSibling;
      if (d?.classList.contains('src-detail')) d.remove();
      else {
        const det = document.createElement('div');
        det.className = 'src-detail';
        det.innerHTML = '视觉识别 + 知识库匹配 · 置信度 0.92<br>未命中知识库时标记为「推断」，会显式提示。';
        el.after(det);
      }
      break;
    }

    /* === 菜谱 Tab === */
    case 'toggle-have': {
      el.classList.toggle('on');
      el.classList.toggle('bump');
      break;
    }
    case 'taste': {
      state.recipeTaste = el.dataset.v;
      $$('#screen .segmented .seg').forEach(s => s.classList.remove('on'));
      el.classList.add('on');
      break;
    }
    case 'gen-recipe': genRecipeFromPantry(); break;

    case 'open-conf-help':
      toast('置信度 = 视觉识别 × 0.6 + 知识库匹配 × 0.3 + OCR 加成');
      break;

    case 'toast': toast(el.dataset.msg); break;
  }
});

/* 时间滑块 */
document.addEventListener('input', e => {
  if (e.target.id === 'time-range') {
    state.recipeTime = parseInt(e.target.value, 10);
    const lbl = $('#time-label');
    if (lbl) lbl.textContent = state.recipeTime + ' 分钟内';
    e.target.style.setProperty('--pct', ((state.recipeTime - 10) / 50 * 100) + '%');
  }
});

function snapThinkingPage() {
  return `<div class="page">
    <div style="text-align:center;padding:64px 20px 30px">
      <div style="font-size:46px">🍲</div>
      <div class="thinking" style="margin-top:22px;text-align:left">
        <div class="th-head">✦ 正在识别<span class="th-time" id="snap-timer">0.0s</span></div>
        <div id="sp-0" class="th-step doing"><span class="ts-dot"></span><span>分析图像主体</span></div>
        <div id="sp-1" class="th-step"><span class="ts-dot"></span><span>匹配菜品知识库</span></div>
        <div id="sp-2" class="th-step"><span class="ts-dot"></span><span>生成菜品档案</span></div>
      </div>
    </div>
    <div class="pad-bottom"></div>
  </div>`;
}

/* --------------------------------------------------------------------------
   启动
   -------------------------------------------------------------------------- */

document.addEventListener('DOMContentLoaded', () => {
  renderFrame();
  // 暴露给控制台调试
  window.__menulens = { state, generatePlan, parseMenu, config };
});
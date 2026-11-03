/* ==========================================================================
   MenuLens · 数据层
   菜品知识库 + 模拟菜单 + 模拟识别结果
   以 window.MenuLensData 暴露，兼容 file:// 直接双击打开
   ========================================================================== */

var MenuLensData = (function () {

/** 菜品本体（模拟 Knowledge Base 检索结果） */
const DISH_DB = {
  白切鸡: {
    id: 'd_001', nameZh: '白切鸡', nameEn: 'Poached Chicken', price: 58, category: '荤菜',
    cuisine: '粤菜', region: '广东', role: '主菜',
    desc: '文火浸熟，皮爽肉滑，配姜葱油',
    flavor: { 清淡: 0.8, 鲜香: 0.7, 麻辣: 0 },
    allergens: ['蛋'], spicy: 0, umami: 0.7,
    ingredients: ['三黄鸡', '姜', '葱', '花生油', '冰水'],
    methods: ['水浸', '斩件'],
    tips: '冰水一激，皮才脆',
    time: 40, difficulty: 2, servings: 0.6,
    pairWith: ['上汤时蔬', '白灼虾'], source: '知识库'
  },
  清蒸海斑鱼: {
    id: 'd_002', nameZh: '清蒸海斑鱼', nameEn: 'Steamed Grouper', price: 88, category: '荤菜',
    cuisine: '粤菜', region: '广东', role: '主菜',
    desc: '豉油垫底，鱼肉嫩滑，鲜味足',
    flavor: { 清淡: 0.9, 鲜香: 0.95, 麻辣: 0 },
    allergens: ['海鲜', '大豆'], spicy: 0, umami: 0.9,
    ingredients: ['海斑鱼', '姜丝', '葱丝', '蒸鱼豉油'],
    methods: ['清蒸'],
    tips: '蒸 8 分钟关火虚蒸 2 分钟，最嫩',
    time: 20, difficulty: 2, servings: 0.8,
    pairWith: ['白切鸡', '蒜蓉菜心'], source: '知识库'
  },
  上汤时蔬: {
    id: 'd_003', nameZh: '上汤时蔬', nameEn: 'Seasonal Greens in Broth', price: 40, category: '素菜',
    cuisine: '粤菜', region: '广东', role: '素菜',
    desc: '高汤浸煮时令菜蔬，清甜不腻',
    flavor: { 清淡: 0.85, 鲜香: 0.6, 麻辣: 0 },
    allergens: [], spicy: 0, umami: 0.5,
    ingredients: ['时令绿叶菜', '皮蛋', '咸蛋', '高汤'],
    methods: ['浸煮'],
    tips: '菜心梗先焯 20 秒，口感更脆',
    time: 15, difficulty: 1, servings: 0.7,
    pairWith: ['白切鸡'], source: '知识库'
  },
  豉汁排骨: {
    id: 'd_004', nameZh: '豉汁排骨', nameEn: 'Steamed Pork Ribs in Black Bean', price: 48, category: '荤菜',
    cuisine: '粤菜', region: '广东', role: '主菜',
    desc: '豆豉咸香，排骨嫩滑，蒸至入味',
    flavor: { 清淡: 0.2, 鲜香: 0.7, 麻辣: 0.1 },
    allergens: ['大豆'], spicy: 0, umami: 0.85,
    ingredients: ['猪肋排', '豆豉', '蒜蓉', '生粉'],
    methods: ['蒸'],
    tips: '排骨腌足 20 分钟，蒸出来不柴',
    time: 35, difficulty: 1, servings: 0.7,
    pairWith: ['上汤时蔬'], source: '知识库'
  },
  干炒牛河: {
    id: 'd_005', nameZh: '干炒牛河', nameEn: 'Dry-fried Beef Ho Fun', price: 52, category: '主食',
    cuisine: '粤菜', region: '广东', role: '主食',
    desc: '锅气十足，河粉爽滑，牛肉嫩',
    flavor: { 清淡: 0.1, 鲜香: 0.6, 麻辣: 0.2 },
    allergens: ['大豆'], spicy: 0.2, umami: 0.7,
    ingredients: ['河粉', '牛肉', '黄豆芽', '银芽', '老抽'],
    methods: ['干炒'],
    tips: '全程大火，锅要够热才起锅气',
    time: 12, difficulty: 3, servings: 0.8,
    pairWith: ['上汤时蔬'], source: '知识库'
  },
  蒜蓉炒时蔬: {
    id: 'd_006', nameZh: '蒜蓉炒时蔬', nameEn: 'Garlic Seasonal Greens', price: 32, category: '素菜',
    cuisine: '粤菜', region: '广东', role: '素菜',
    desc: '猛火快炒，蒜香扑鼻，清爽解腻',
    flavor: { 清淡: 0.6, 鲜香: 0.5, 麻辣: 0.2 },
    allergens: [], spicy: 0.2, umami: 0.3,
    ingredients: ['菜心', '蒜蓉', '盐', '糖'],
    methods: ['爆炒'],
    tips: '盐最后放，出锅前 10 秒',
    time: 8, difficulty: 1, servings: 0.7,
    pairWith: ['白切鸡', '干炒牛河'], source: '知识库'
  },
  蒜泥白肉: {
    id: 'd_007', nameZh: '蒜泥白肉', nameEn: 'Pork with Garlic Sauce', price: 38, category: '荤菜',
    cuisine: '川菜', region: '四川', role: '凉菜',
    desc: '五花肉薄片，蒜泥红油，肥而不腻',
    flavor: { 清淡: 0.1, 鲜香: 0.6, 麻辣: 0.6 },
    allergens: ['大豆', '芝麻'], spicy: 0.6, umami: 0.6,
    ingredients: ['五花肉', '蒜泥', '红油', '花椒'],
    methods: ['煮', '凉拌'],
    tips: '肉煮好立刻冰镇，肥肉不腻',
    time: 45, difficulty: 2, servings: 0.6,
    pairWith: ['清蒸海斑鱼'], source: '知识库'
  },
  麻婆豆腐: {
    id: 'd_008', nameZh: '麻婆豆腐', nameEn: 'Mapo Tofu', price: 28, category: '素菜',
    cuisine: '川菜', region: '四川', role: '素菜',
    desc: '麻辣鲜香，豆腐嫩滑，下饭神器',
    flavor: { 清淡: 0, 鲜香: 0.5, 麻辣: 0.95 },
    allergens: ['大豆'], spicy: 0.95, umami: 0.8,
    ingredients: ['嫩豆腐', '牛肉末', '豆瓣酱', '花椒粉'],
    methods: ['烧'],
    tips: '豆腐焯盐水再下锅，不碎',
    time: 20, difficulty: 2, servings: 0.7,
    pairWith: ['干炒牛河'], source: '知识库'
  },
  宫保鸡丁: {
    id: 'd_009', nameZh: '宫保鸡丁', nameEn: 'Kung Pao Chicken', price: 42, category: '荤菜',
    cuisine: '川菜', region: '四川', role: '主菜',
    desc: '荔枝味型，酸甜微辣，花生酥脆',
    flavor: { 清淡: 0.1, 鲜香: 0.6, 麻辣: 0.5 },
    allergens: ['花生'], spicy: 0.5, umami: 0.7,
    ingredients: ['鸡腿肉', '花生米', '干辣椒', '花椒', '香醋'],
    methods: ['爆炒'],
    tips: '花生最后放，保持酥脆',
    time: 25, difficulty: 3, servings: 0.7,
    pairWith: ['蒜蓉炒时蔬'], source: '知识库'
  },
  水煮鱼: {
    id: 'd_010', nameZh: '水煮鱼', nameEn: 'Sichuan Boiled Fish', price: 88, category: '荤菜',
    cuisine: '川菜', region: '四川', role: '主菜',
    desc: '鱼肉滑嫩，汤汁红亮，麻辣厚重',
    flavor: { 清淡: 0, 鲜香: 0.7, 麻辣: 1.0 },
    allergens: ['海鲜', '大豆'], spicy: 1.0, umami: 0.9,
    ingredients: ['草鱼', '黄豆芽', '干辣椒', '花椒', '蛋清'],
    methods: ['汆', '浇'],
    tips: '鱼片上浆后静置 15 分钟更嫩',
    time: 40, difficulty: 4, servings: 0.9,
    pairWith: ['蒜蓉炒时蔬'], source: '知识库'
  },
  番茄炒蛋: {
    id: 'd_011', nameZh: '番茄炒蛋', nameEn: 'Tomato & Egg', price: 26, category: '素菜',
    cuisine: '家常菜', region: '—', role: '素菜',
    desc: '国民家常，酸甜开胃，汤汁拌饭一绝',
    flavor: { 清淡: 0.4, 鲜香: 0.4, 麻辣: 0 },
    allergens: ['蛋'], spicy: 0, umami: 0.5,
    ingredients: ['番茄', '鸡蛋', '糖', '葱'],
    methods: ['炒'],
    tips: '番茄去皮口感更好，出汁更快',
    time: 12, difficulty: 1, servings: 0.6,
    pairWith: ['白切鸡'], source: '知识库'
  },
  可乐鸡翅: {
    id: 'd_012', nameZh: '可乐鸡翅', nameEn: 'Cola Chicken Wings', price: 36, category: '荤菜',
    cuisine: '家常菜', region: '—', role: '主菜',
    desc: '甜咸适中，色泽红亮，孩子最爱',
    flavor: { 清淡: 0.1, 鲜香: 0.5, 麻辣: 0 },
    allergens: [], spicy: 0, umami: 0.6,
    ingredients: ['鸡中翅', '可乐', '生抽', '姜'],
    methods: ['焖'],
    tips: '先煎后焖，糖色更亮',
    time: 30, difficulty: 1, servings: 0.6,
    pairWith: ['蒜蓉炒时蔬'], source: '知识库'
  },
  寿司拼盘: {
    id: 'd_013', nameZh: '寿司拼盘', nameEn: 'Sushi Platter', price: 78, category: '凉菜',
    cuisine: '日料', region: '日本', role: '前菜',
    desc: '八贯刺身，醋饭酸甜，鱼肉新鲜',
    flavor: { 清淡: 0.8, 鲜香: 0.9, 麻辣: 0 },
    allergens: ['海鲜', '大豆', '芝麻'], spicy: 0, umami: 0.95,
    ingredients: ['三文鱼', '金枪鱼', '海胆', '鳗鱼', '醋饭', '芥末'],
    methods: ['手握'],
    tips: '芥末现磨才够冲',
    time: 15, difficulty: 3, servings: 0.9,
    pairWith: ['味噌汤'], source: '知识库'
  },
  味噌汤: {
    id: 'd_014', nameZh: '味噌汤', nameEn: 'Miso Soup', price: 18, category: '汤',
    cuisine: '日料', region: '日本', role: '汤',
    desc: '海带豆腐味噌，清淡暖胃',
    flavor: { 清淡: 0.85, 鲜香: 0.6, 麻辣: 0 },
    allergens: ['大豆'], spicy: 0, umami: 0.7,
    ingredients: ['味噌', '豆腐', '海带', '木鱼花'],
    methods: ['煮'],
    tips: '味噌最后放，煮沸即关火',
    time: 10, difficulty: 1, servings: 0.8,
    pairWith: ['寿司拼盘'], source: '知识库'
  },
  泰式冬阴功: {
    id: 'd_015', nameZh: '泰式冬阴功', nameEn: 'Tom Yum Goong', price: 68, category: '汤',
    cuisine: '东南亚菜', region: '泰国', role: '汤',
    desc: '酸辣浓香，虾肉弹牙，冬阴功经典',
    flavor: { 清淡: 0.1, 鲜香: 0.8, 麻辣: 0.7 },
    allergens: ['甲壳类', '海鲜'], spicy: 0.7, umami: 0.85,
    ingredients: ['虾', '香茅', '柠檬叶', '南姜', '冬阴功酱'],
    methods: ['煮'],
    tips: '香茅拍扁再下锅，香味才出得来',
    time: 25, difficulty: 3, servings: 0.8,
    pairWith: ['蒜蓉炒时蔬'], source: '知识库'
  }
};

/** 模拟菜单：一场粤菜聚餐的菜单识别结果（含各种置信度） */
const MOCK_MENU = {
  meta: { restaurant: '翠华餐厅（深圳湾店）', cuisine: '粤菜', pages: 1, language: ['zh', 'en'] },
  items: [
    { key: 'i1', name: '白切鸡', price: 58, category: '荤菜', en: 'Poached Chicken', desc: '文火浸熟，皮爽肉滑，配姜葱油', confidence: 0.92, source: 'vision+kb' },
    { key: 'i2', name: '清蒸海斑鱼', price: 88, category: '荤菜', en: 'Steamed Grouper', desc: '豉油垫底，鱼肉嫩滑，鲜味足', confidence: 0.78, source: 'vision+kb', needsConfirm: true },
    { key: 'i3', name: '豉汁排骨', price: 48, category: '荤菜', en: 'Steamed Pork Ribs', desc: '豆豉咸香，排骨嫩滑', confidence: 0.88, source: 'vision+kb' },
    { key: 'i4', name: '蒜泥白肉', price: 38, category: '荤菜', en: 'Pork with Garlic Sauce', desc: '五花肉薄片，蒜泥红油', confidence: 0.85, source: 'vision+kb' },
    { key: 'i5', name: '干炒牛河', price: 52, category: '主食', en: 'Dry-fried Beef Ho Fun', desc: '锅气十足，河粉爽滑', confidence: 0.91, source: 'vision+kb' },
    { key: 'i6', name: '上汤时蔬', price: 40, category: '素菜', en: 'Seasonal Greens', desc: '高汤浸煮，清甜不腻', confidence: 0.86, source: 'vision+kb' },
    { key: 'i7', name: '蒜蓉炒时蔬', price: 32, category: '素菜', en: 'Garlic Greens', desc: '猛火快炒，蒜香扑鼻', confidence: 0.83, source: 'vision+kb' },
    { key: 'i8', name: '麻婆豆腐', price: 28, category: '素菜', en: 'Mapo Tofu', desc: '麻辣鲜香，豆腐嫩滑', confidence: 0.41, source: 'vision', uncertain: true,
      candidates: ['麻婆豆腐', '水煮豆腐', '鱼香肉丝'] },
    { key: 'i9', name: '老火靓汤', price: 22, category: '汤', en: 'Double-boiled Soup', desc: '例汤，每日两款', confidence: 0.58, source: 'vision', needsConfirm: true },
    { key: 'i10', name: '椰汁西米露', price: 18, category: '甜品', en: 'Sago in Coconut Milk', desc: '清甜滑椰香', confidence: 0.72, source: 'vision+kb' }
  ]
};

/** 模拟拍照识菜结果（单菜） */
const MOCK_DISH = {
  name: '麻婆豆腐', en: 'Mapo Tofu', confidence: 0.94, source: 'vision+kb',
  cuisine: '川菜', region: '四川', category: '素菜',
  flavorText: '麻辣鲜香，麻味来自花椒，辣味来自豆瓣酱',
  ingredients: ['嫩豆腐 400g', '牛肉末 80g', '郫县豆瓣酱 2勺', '花椒粉 1勺', '蒜苗 2根', '水淀粉'],
  methods: ['豆腐切块，淡盐水焯 1 分钟', '热油炒散牛肉末至微干', '下豆瓣酱炒出红油', '加水烧开，轻推入豆腐煮 3 分钟', '勾芡两次，起锅撒花椒粉与蒜苗'],
  tips: '豆腐用盐水焯过再煎不易碎；勾芡分两次才够亮滑',
  pairWith: ['干炒牛河', '白切鸡', '米饭'],
  allergens: ['大豆'], spicy: 0.95,
  time: 20, difficulty: 2, servings: 2
};

/** 模拟：可用食材 → 菜谱 */
const MOCK_RECIPES = [
  {
    name: '番茄炒蛋', en: 'Tomato & Egg', time: 12, difficulty: 1, servings: 2,
    match: 0.95, cuisine: '家常菜',
    have: ['番茄', '鸡蛋', '葱'], missing: ['糖'],
    steps: [
      { t: '准备', d: '番茄顶部划十字，开水烫 30 秒去皮切块；鸡蛋加少许盐打散。', tip: '去皮后汤汁更浓稠' },
      { t: '炒蛋', d: '热油倒入蛋液，边缘凝固后快速划散，八分熟盛出。', tip: '蛋不要炒太老' },
      { t: '炒番茄', d: '锅中留底油下番茄，中火炒出红色汤汁，加 1 小勺糖提鲜。', tip: '糖是提鲜不是变甜' },
      { t: '合炒', d: '倒回鸡蛋翻炒均匀，让蛋吸饱汤汁，加盐调味出锅。', tip: '大火快炒 1 分钟即可' }
    ]
  },
  {
    name: '蒜蓉炒青菜', en: 'Garlic Greens', time: 8, difficulty: 1, servings: 2,
    match: 0.82, cuisine: '家常菜',
    have: ['青菜', '蒜'], missing: [],
    steps: [
      { t: '焯水', d: '青菜洗净，沸水加几滴油和少许盐，焯 20 秒捞出摆盘。', tip: '加油焯水颜色更翠绿' },
      { t: '爆蒜', d: '热锅冷油，下蒜蓉小火慢炸 15 秒至微黄出香。', tip: '蒜蓉不要炸糊' },
      { t: '合炒', d: '倒入青菜大火快炒 30 秒，加盐调味立刻出锅。', tip: '盐最后放，保持爽脆' }
    ]
  },
  {
    name: '可乐鸡翅', en: 'Cola Chicken Wings', time: 30, difficulty: 1, servings: 2,
    match: 0.71, cuisine: '家常菜',
    have: ['鸡翅', '可乐', '姜'], missing: ['生抽'],
    steps: [
      { t: '划刀', d: '鸡翅两面各划两刀便于入味，冷水下锅焯 2 分钟捞出。', tip: '焯水去腥' },
      { t: '煎色', d: '平底锅少油，鸡皮朝下中小火煎至两面金黄。', tip: '先煎后焖，糖色更亮' },
      { t: '焖煮', d: '倒入可乐没过鸡翅，加 1 勺生抽、姜片，大火烧开转中小火焖 15 分钟。', tip: '大火收汁时注意翻动防粘' },
      { t: '收汁', d: '开大火收至浓稠挂汁即可，撒少许白芝麻。', tip: '收到汤汁挂勺就停' }
    ]
  }
];

/** 按名称查菜品详情，失败则按名称模糊构造 */
function lookupDish(name) {
  if (DISH_DB[name]) return DISH_DB[name];
  const key = Object.keys(DISH_DB).find(k => k.includes(name) || name.includes(k));
  if (key) return DISH_DB[key];
  return {
    id: 'd_x', nameZh: name, nameEn: '', price: 0, category: '荤菜',
    cuisine: '家常菜', desc: '暂无详细资料', flavor: {}, allergens: [],
    ingredients: ['暂无数据'], methods: ['暂无数据'], tips: '建议向服务员确认',
    time: 20, difficulty: 1, servings: 0.7, pairWith: [], source: '推断'
  };
}

/** 用户全局忌口 */
const DEFAULT_AVOID = ['香菜', '海鲜'];
const AVOID_OPTIONS = ['香菜', '辣', '花生', '海鲜', '牛肉', '猪肉', '乳制品', '麸质', '蛋', '大豆'];
const ALLERGENS = ['花生', '坚果', '海鲜', '甲壳类', '乳制品', '麸质', '蛋', '大豆', '芝麻'];

  return {
    DISH_DB: DISH_DB, MOCK_MENU: MOCK_MENU, MOCK_DISH: MOCK_DISH,
    MOCK_RECIPES: MOCK_RECIPES, lookupDish: lookupDish,
    DEFAULT_AVOID: DEFAULT_AVOID, AVOID_OPTIONS: AVOID_OPTIONS, ALLERGENS: ALLERGENS
  };
})();

if (typeof window !== 'undefined') window.MenuLensData = MenuLensData;
/**
 * 菜品种子数据索引
 * ------------------------------------------------------------------
 * ORDER 决定生成顺序（也决定分卷边界），MAP 是分组 → 菜品数组。
 * 新增菜系：在 kb-seed-data/ 下加一个文件，这里登记一行即可。
 */
'use strict';

const MAP = {
  '粤菜 · 广府潮汕顺德': require('./yue.js'),
  '川菜 · 成都重庆': require('./chuan.js'),
  '湘菜 · 湖南': require('./xiang.js'),
  '鲁菜 · 山东': require('./lu.js'),
  '苏菜 · 淮扬': require('./su.js'),
  '浙菜 · 杭帮': require('./zhe.js'),
  '闽菜 · 福建': require('./min.js'),
  '徽菜 · 安徽': require('./hui.js'),
  '东北菜 · 黑吉辽': require('./dongbei.js'),
  '西北菜 · 陕甘新': require('./xibei.js'),
  '云贵菜 · 云南贵州': require('./yungui.js'),
  '京菜与宫廷菜': require('./jing.js'),
  '家常菜 · 全国通吃': require('./jiachang.js'),
  '面点主食与小吃': require('./zhushi.js'),
  '汤羹与粥品': require('./tang.js'),
  '素食与凉菜': require('./sushi.js'),
  '东南亚与日韩': require('./yazhou.js'),
  '西餐简餐': require('./xican.js'),
  '甜品与饮品': require('./tianpin.js')
};

module.exports = {
  MAP,
  ORDER: Object.keys(MAP)
};

/**
 * 行式菜品种子解析
 * ------------------------------------------------------------------
 * 数据文件用「一菜一行、字段用 | 分隔」的紧凑格式，好处是 500 道菜
 * 一眼能扫完，也能直接看出哪一行字段数不对。
 *
 * 过敏原强制收敛到白名单——代码层的过敏原硬过滤是精确匹配的，
 * 「虾」和「甲壳类」对不上就等于过滤失效。所以这里宁可让生成失败。
 */
'use strict';

const ALLERGEN_WHITELIST = [
  '花生', '坚果', '海鲜', '甲壳类', '软体类', '乳制品', '麸质', '蛋', '大豆', '芝麻'
];

const FIELD_COUNT = 17;
const FIELD_NAMES = [
  'name', 'en', 'cuisine', 'region', 'cat', 'role', 'price', 'diff', 'time', 'spicy',
  'ingredients', 'methods', 'allergens', 'light', 'umami', 'ma', 'desc'
];

function parseRow(line, lineNo, file) {
  const p = line.split('|').map(s => s.trim());
  if (p.length !== FIELD_COUNT) {
    throw new Error('[' + file + ':' + lineNo + '] 字段数 ' + p.length +
      '，应为 ' + FIELD_COUNT + '（' + FIELD_NAMES.join('/') + '）\n  ' + line.slice(0, 90));
  }
  const [
    name, en, cuisine, region, cat, role, price, diff, time, spicy,
    ingredients, methods, allergens, light, umami, ma, desc
  ] = p;

  const al = (allergens || '').split(/[、,\/]/).map(s => s.trim())
    .filter(s => s && s !== '无' && s !== '无常见过敏原');
  const bad = al.filter(a => ALLERGEN_WHITELIST.indexOf(a) < 0);
  if (bad.length) {
    throw new Error('[' + file + '] ' + name + ' 非法过敏原：' + bad.join('、') +
      '\n  只允许：' + ALLERGEN_WHITELIST.join('/'));
  }

  const num = (v, dflt) => (v === '' || isNaN(Number(v)) ? dflt : Number(v));

  return {
    name, en, cuisine, region, cat, role, price,
    diff: num(diff, 1), time: num(time, 20), spicy: num(spicy, 0),
    ingredients: (ingredients || '').split(/[、,]/).map(s => s.trim()).filter(Boolean),
    methods: (methods || '').split(/[、,]/).map(s => s.trim()).filter(Boolean),
    allergens: al,
    light: num(light, 0.5), umami: num(umami, 0.5), ma: num(ma, 0),
    desc: desc || ''
  };
}

/**
 * @param {string} block 多行数据
 * @param {string} file  文件名，仅用于报错定位
 */
function parse(block, file) {
  return block.split(/\r?\n/)
    .map((l, i) => ({ raw: l, no: i + 1 }))
    .filter(x => x.raw.trim() && !x.raw.trim().startsWith('//') && !x.raw.trim().startsWith('#'))
    .map(x => parseRow(x.raw.trim(), x.no, file || 'seed'));
}

module.exports = { parse, parseRow, ALLERGEN_WHITELIST };

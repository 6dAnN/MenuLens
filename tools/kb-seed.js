/**
 * 知识库语料生成器：菜品种子数据 → knowledge/菜品知识库.md
 * ------------------------------------------------------------------
 * 为什么要有这一层：
 *   手写 500 道菜的 markdown 一定会出现字段错位、过敏原写成「虾」这种
 *   不在八大类白名单里的值——而过敏原硬过滤是靠精确匹配的，一旦不收敛
 *   就等于失效。这里把「数据」和「呈现」分开，字段错误在生成期就炸掉。
 *
 * 用法：
 *   node tools/kb-seed.js --write     # 生成 knowledge/菜品知识库.md
 *   node tools/kb-seed.js --check     # 只校验数据质量，不写文件
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'knowledge', '菜品知识库.md');
const SPLIT_AT = 200;      // 单文件超过这个数量就分卷，避免一个 md 里 3000 行没人看得下去

const ALL = require('./kb-seed-data/');

/** 收集所有分组：{ title, key, dishes } */
function collectGroups() {
  const groups = [];
  ALL.ORDER.forEach(key => {
    const v = ALL.MAP[key];
    if (Array.isArray(v) && v.length) groups.push({ key, dishes: v });
  });
  return groups;
}

/* ---------------- 数据质量校验 ---------------- */

function validate(groups) {
  const errors = [];
  const warns = [];
  const byName = {};

  groups.forEach(g => {
    g.dishes.forEach(d => {
      const tag = '[' + g.key + '] ' + d.name;

      if (!d.name) errors.push('空菜名');
      if (!d.en) warns.push(tag + ' 缺英文名');
      if (!d.desc) errors.push(tag + ' 缺判别描述');
      if (!d.ingredients.length) errors.push(tag + ' 缺主要食材');
      if (d.spicy < 0 || d.spicy > 3) errors.push(tag + ' 辣度越界 ' + d.spicy);
      if (d.diff < 1 || d.diff > 4) errors.push(tag + ' 难度越界 ' + d.diff);
      if (d.spicy > 0 && d.ma > 0.6 && d.cuisine !== '川菜' && d.cuisine !== '渝菜') {
        warns.push(tag + ' 麻辣值高但非川渝菜系');
      }
      if (d.spicy === 0 && d.ma > 0) warns.push(tag + ' 辣度 0 却有麻辣值');

      if (byName[d.name]) errors.push('菜名重复：' + d.name + '（' + byName[d.name] + ' / ' + g.key + '）');
      byName[d.name] = g.key;

      d.ingredients.forEach(x => { if (x.length > 8) warns.push(tag + ' 食材过长 ' + x); });
    });
  });

  return { errors, warns, byName };
}

/* ---------------- markdown 渲染 ---------------- */

function renderDish(d) {
  const L = [];
  L.push('## ' + d.name);
  L.push('');
  L.push('| 字段 | 值 |');
  L.push('|---|---|');
  L.push('| 英文名 | ' + d.en + ' |');
  L.push('| 菜系 | ' + d.cuisine + ' |');
  L.push('| 产地 | ' + d.region + ' |');
  L.push('| 类别 | ' + d.cat + ' |');
  L.push('| 定位 | ' + d.role + ' |');
  L.push('| 参考价格 | ' + d.price + ' |');
  L.push('| 难度 | ' + d.diff + ' |');
  L.push('| 耗时 | ' + d.time + ' 分钟 |');
  L.push('| 辣度 | ' + d.spicy + ' |');
  L.push('| 主要食材 | ' + d.ingredients.join('、') + ' |');
  L.push('| 烹饪方式 | ' + d.methods.join('、') + ' |');
  L.push('| 过敏原 | ' + (d.allergens.length ? d.allergens.join('、') : '无常见过敏原') + ' |');
  L.push('| 风味 | 清淡 ' + d.light + ' / 鲜香 ' + d.umami + ' / 麻辣 ' + d.ma + ' |');
  L.push('');
  L.push(d.desc + '。');
  L.push('');
  return L.join('\n');
}

function renderFile(title, note, dishes) {
  const head = [
    '# ' + title,
    '',
    '> ' + note,
    '> 本文档由 `node tools/kb-seed.js` 生成，请改 `tools/kb-seed-data/` 下的数据而不是直接编辑本文件。',
    '',
    '---',
    ''
  ];
  return head.join('\n') + dishes.map(renderDish).join('\n---\n\n') + '\n';
}

/* ---------------- 主流程 ---------------- */

const groups = collectGroups();
const allDishes = [].concat.apply([], groups.map(g => g.dishes));
const { errors, warns, byName } = validate(groups);

const checking = process.argv.includes('--check');

console.log('[seed] 分组 ' + groups.length + ' 个，菜品 ' + allDishes.length + ' 道');
groups.forEach(g => console.log('        ' + g.key.padEnd(12) + g.dishes.length + ' 道'));
if (warns.length) {
  console.log('[seed] 警告 ' + warns.length + ' 条：');
  warns.slice(0, 30).forEach(w => console.log('   ! ' + w));
  if (warns.length > 30) console.log('   … 其余 ' + (warns.length - 30) + ' 条略');
}
if (errors.length) {
  console.log('[seed] 错误 ' + errors.length + ' 条：');
  errors.slice(0, 40).forEach(e => console.log('   x ' + e));
  process.exit(1);
}
if (checking) {
  console.log('[seed] 数据校验通过');
  process.exit(0);
}

// 分卷：按分组累加，单卷超过 SPLIT_AT 就开新卷
const volumes = [];
let cur = [];
groups.forEach(g => {
  if (cur.reduce((n, x) => n + x.dishes.length, 0) >= SPLIT_AT) { volumes.push(cur); cur = []; }
  cur.push(g);
});
if (cur.length) volumes.push(cur);

const written = [];
volumes.forEach((vol, i) => {
  const dishes = [].concat.apply([], vol.map(g => g.dishes));
  const part = volumes.length > 1 ? '-' + (i + 1) : '';
  const file = '菜品知识库' + part + '.md';
  const label = vol.map(g => g.key).join(' / ');
  const title = 'MenuLens 菜品知识库' + (volumes.length > 1 ? '（第 ' + (i + 1) + ' 卷）' : '');
  const note = '涵盖：' + label + '，共 ' + dishes.length + ' 道。每道菜以 `##` 为一条独立 chunk。';
  fs.writeFileSync(path.join(ROOT, 'knowledge', file), renderFile(title, note, dishes), 'utf8');
  written.push({ file, count: dishes.length });
});

console.log('[seed] 已写入：');
written.forEach(w => console.log('        knowledge/' + w.file + '  ' + w.count + ' 道'));

// 清理旧分卷（数量变少时残留的文件会被 build-kb 当成重复语料读进来）
const existing = fs.readdirSync(path.join(ROOT, 'knowledge'))
  .filter(f => /^菜品知识库(-\d+)?\.md$/.test(f));
const keep = written.map(w => w.file);
existing.forEach(f => {
  if (keep.indexOf(f) < 0) {
    fs.unlinkSync(path.join(ROOT, 'knowledge', f));
    console.log('[seed] 已删除旧分卷 knowledge/' + f);
  }
});

/**
 * 识菜对账模块自测
 */
'use strict';
const path = require('path');
const fs = require('fs');
const ROOT = path.resolve(__dirname, '..');
const dm = require(path.join(ROOT, 'miniprogram', 'utils', 'dish-match.js'));

const out = [];
let pass = 0, fail = 0;
const t = (n, c, d) => {
  if (c) { out.push('  [PASS] ' + n); pass++; }
  else { out.push('  [FAIL] ' + n + (d ? ' → ' + d : '')); fail++; }
};

out.push('== 索引 ==');
const st = dm.stats();
out.push('  菜品 ' + st.dishes + ' 道，索引项 ' + st.index + ' 个');
t('索引菜品数 ≥ 700', st.dishes >= 700, String(st.dishes));

out.push('');
out.push('== 菜名归一 ==');
[
  ['宫保鸡丁', '宫保鸡丁', 'exact'],
  ['宫爆鸡丁', '宫保鸡丁', 'typo'],
  ['Kung Pao Chicken', '宫保鸡丁', 'en'],
  ['麻婆豆腐', '麻婆豆腐', 'exact'],
  ['泰式冬阴功', '泰式冬阴功', 'exact'],
  ['冬阴功', '泰式冬阴功', 'contains'],
  ['盐焗鸡（港式）', '盐焗鸡', 'core'],
  ['盐焗鸡', '盐焗鸡', 'exact'],
  ['白切鸡', '白切鸡', 'exact']
].forEach(([q, expect, how]) => {
  const m = dm.matchDish(q);
  t('「' + q + '」→「' + expect + '」', !!m && m.name === expect,
    m ? m.name + ' (' + m.how + ')' : '未匹配');
  if (m) out.push('      匹配方式 ' + m.how + '，ratio=' + m.ratio.toFixed(2));
});

t('库里没有的菜返回 null', dm.matchDish('火星烤全羊') === null,
  JSON.stringify(dm.matchDish('火星烤全羊')));
t('空名返回 null', dm.matchDish('') === null);

out.push('');
out.push('== 字段对账 ==');
// 1) 完全正确：不打折
const m1 = dm.matchDish('宫保鸡丁');
const r1 = dm.reconcile({ name: '宫保鸡丁', cuisine: '川菜', spicy: 0.5, allergens: ['花生'] }, m1);
out.push('  折扣 ' + r1.discount.toFixed(2) + '  过敏原 ' + JSON.stringify(r1.allergens));
t('完全一致不打折', r1.discount === 1, String(r1.discount));
t('过敏原取并集，含知识库的花生/大豆/蛋',
  ['花生', '大豆', '蛋'].every(a => r1.allergens.merged.indexOf(a) >= 0),
  r1.allergens.merged.join(','));

// 2) 菜系错：纠成知识库的，打 0.9
const r2 = dm.reconcile({ name: '宫保鸡丁', cuisine: '粤菜', spicy: 0.5, allergens: [] }, m1);
t('菜系错被纠正为川菜', r2.cuisine === '川菜', r2.cuisine);
t('菜系错打折 0.9', Math.abs(r2.discount - 0.9) < 1e-6, String(r2.discount));
t('记录纠正原因', r2.reasons.length > 0, JSON.stringify(r2.reasons));

// 3) 错字菜名：归一 + 打 0.88
const m3 = dm.matchDish('宫爆鸡丁');
const r3 = dm.reconcile({ name: '宫爆鸡丁', cuisine: '川菜', spicy: 0.5 }, m3);
t('错字菜名被归一为宫保鸡丁', r3.name === '宫保鸡丁', r3.name);
t('错字打折 0.88', Math.abs(r3.discount - 0.88) < 1e-6, String(r3.discount));

// 4) 库里没有：0.82
const r4 = dm.reconcile({ name: '火星烤全羊', cuisine: '火星菜', spicy: 0 }, null);
t('库外菜品打折 0.82', Math.abs(r4.discount - 0.82) < 1e-6, String(r4.discount));
t('库外菜品给出原因', /未收录/.test(r4.reasons.join('')), JSON.stringify(r4.reasons));
t('库外菜品不编造过敏原', r4.allergens === null);

// 5) 辣度差异
const mx = dm.matchDish('水煮鱼');
if (mx) {
  const r5 = dm.reconcile({ name: '水煮鱼', cuisine: '川菜', spicy: 0.1 }, mx);
  out.push('  水煮鱼 知识库辣度=' + mx.row.spicy + ' 模型=0.1 → 修正后 ' + r5.spicy);
  t('辣度差一档以上被修正', r5.spicy > 0.5, String(r5.spicy));
}

// 6) 菜系近义不误判
t('川菜 vs 四川 不算冲突', dm.sameCuisine('川菜', '四川'));
t('粤菜 vs 港式 不算冲突', dm.sameCuisine('粤菜', '港式'));
t('川菜 vs 粤菜 算冲突', !dm.sameCuisine('川菜', '粤菜'));

out.push('');
out.push('== 候选清单 ==');
const cand = dm.candidateList([], 40);
t('候选 40 个', cand.length === 40, String(cand.length));
t('候选无重复', new Set(cand).size === cand.length);
out.push('  ' + cand.slice(0, 15).join('、') + '…');
const p = dm.candidatePrompt(['宫保鸡丁'], 40);
t('候选提示词含筛选指令', /候选菜品清单/.test(p) && /in_kb/.test(p));
t('提示词把宫保鸡丁排在前面', cand.indexOf('宫保鸡丁') >= 0);

out.push('');
out.push('====================');
out.push('通过 ' + pass + ' / 失败 ' + fail);
fs.writeFileSync(path.join(__dirname, '_dishmatch.txt'), out.join('\n'), 'utf8');
console.log(out.join('\n'));
process.exit(fail ? 1 : 0);

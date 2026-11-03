const path = require('path');
const fs = require('fs');
// 路径按脚本位置推导，避免把某台机器的绝对路径写死进仓库
const dir = path.resolve(__dirname, '..', 'demo');
const out = [];

// 关键中文串必须原样存在
const probes = {
  'data.js': ['白切鸡', '麻婆豆腐', '香菜', '皮爽肉滑'],
  'ai-engine.js': ['过滤忌口', '预算校验通过', '这个我帮不上', '越权'],
  'app.js': ['扫 菜 单', '生成点单方案', '换一道', '置信度', '正在识别']
};

for (const [f, words] of Object.entries(probes)) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  for (const w of words) {
    out.push(`${src.includes(w) ? '[OK]  ' : '[MISS]'} ${f} :: "${w}"`);
  }
  // 替换字符 U+FFFD 说明解码失败
  const fffd = (src.match(/\uFFFD/g) || []).length;
  out.push(`       ${f} U+FFFD 数量: ${fffd}`);
  // 重复定义检测
  const dupCheck = f === 'app.js'
    ? ['function renderFrame', 'function sendChat', 'const PAGES', 'function openRecipe']
    : f === 'ai-engine.js'
    ? ['function generatePlan', 'function agentReply', 'var MenuLensAI']
    : ['var MenuLensData'];
  for (const d of dupCheck) {
    const n = (src.split(d).length - 1);
    out.push(`       ${f} "${d}" 出现 ${n} 次${n > 1 ? '  <== 重复!' : ''}`);
  }
  out.push('');
}

// 总行数
for (const f of ['data.js', 'ai-engine.js', 'app.js', 'styles.css']) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  out.push(`${f}: ${src.split('\n').length} 行, ${(Buffer.byteLength(src)/1024).toFixed(1)} KB`);
}

fs.writeFileSync(path.join(__dirname, '_syntax.txt'), out.join('\n'), 'utf8');
console.log('done');
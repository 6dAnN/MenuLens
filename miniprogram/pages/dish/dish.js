const app = getApp();
const engine = require('../../utils/engine.js');
const dishes = require('../../utils/dishes.js');

Page({
  data: {
    hasResult: false, recognizing: false, recogTime: '0.0s',
    recogSteps: [
      { text: '分析图像主体', state: 'doing' },
      { text: '匹配菜品知识库', state: '' },
      { text: '生成菜品档案', state: '' }
    ],
    dish: null, confLabel: '', allergenText: '',
    qaList: [
      { q: '🥘 这道菜家常怎么做？', a: '家常版要先把肉馅炒干再加豆瓣酱，出红油后再加水。豆腐用淡盐水焯过不易碎，最后分两次勾芡才够亮滑。' },
      { q: '🌶 能不能做成不辣的？', a: '可以。去掉豆瓣酱和花椒粉，改用甜面酱 + 少量番茄酱调味，做成甜口版本，小孩也能吃。' },
      { q: '🍚 配什么主食最好？', a: '配米饭最稳。这道菜本身够下饭，建议米饭点两份；如果想更有层次，可以配一份干炒牛河。' }
    ]
  },

  onLoad() {
    const saved = app.globalData.dish;
    if (saved) this.applyDish(saved);
  },

  onShow() {
    if (this.getTabBar) this.getTabBar().setTabSelected();
  },

  onUnload() { if (this._t) clearInterval(this._t); },

  applyDish(dish) {
    app.globalData.dish = dish;
    const conf = Math.round(dish.confidence * 100);
    this.setData({
      dish,
      hasResult: true,
      confLabel: conf + '% 可信',
      // 置信度的档位配色：低于 60% 时必须视觉上就让人警惕
      confLevel: conf >= 80 ? 'high' : (conf >= 60 ? 'mid' : 'low'),
      allergenText: (dish.allergens || []).join('、') || '无常见过敏原',
      evidence: dish.evidence || [],
      uncertainty: dish.uncertainty || '',
      alternatives: dish.alternatives || [],
      // 云端识别和本地兜底必须让用户分得清，不能假装都是 AI 认的
      sourceLabel: dish.source === 'cloud' ? '云端视觉模型识别'
        : (dish.source === 'local' ? '本地知识库兜底' : '演示数据')
    });
  },

  /* ---------------- 拍照 ---------------- */

  snap() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['camera', 'album'],
      success: (res) => {
        const filePath = (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath) || null;
        this.runRecognition(filePath);
      },
      fail: () => {
        // 用户取消拍摄：不塞假数据糊弄，如实说没识别
        wx.showToast({ title: '已取消', icon: 'none' });
      }
    });
  },

  pickFromAlbum() {
    wx.chooseMedia({
      count: 1, mediaType: ['image'], sizeType: ['compressed'], sourceType: ['album'],
      success: (res) => {
        const filePath = (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath) || null;
        this.runRecognition(filePath);
      },
      fail: () => {}
    });
  },
  onSwitch() { wx.showToast({ title: '切换摄像头', icon: 'none' }); },
  goMenu() { wx.navigateTo({ url: '/pages/menu/menu' }); },

  /** 把本地图片转成 base64（无 data: 前缀） */
  fileToBase64(filePath) {
    return new Promise((resolve, reject) => {
      if (!filePath) { resolve(null); return; }
      wx.getFileSystemManager().readFile({
        filePath,
        encoding: 'base64',
        success: (r) => resolve(r.data),
        fail: (err) => reject(err)
      });
    });
  },

  runRecognition(filePath) {
    if (!filePath) {
      wx.showToast({ title: '没有拿到图片', icon: 'none' });
      return;
    }

    this.setData({
      recognizing: true,
      recogTime: '0.0s',
      recogSteps: [
        { text: '上传图片并分析画面', state: 'doing' },
        { text: '匹配菜品知识库', state: '' },
        { text: '生成菜品档案', state: '' }
      ]
    });
    const t0 = Date.now();
    this._t = setInterval(() => {
      this.setData({ recogTime: ((Date.now() - t0) / 1000).toFixed(1) + 's' });
    }, 100);

    // 真实识别：图片转 base64 → 视觉模型直接看图。
    // onStep 由引擎在真实节点回调，步骤进度反映实际进度，不是定时器演的。
    this.fileToBase64(filePath)
      .then(base64 => {
        if (!base64) throw new Error('图片读取失败');
        return engine.recognizeDish(base64, dishes.MOCK_DISH, {
          onStep: (i) => this.advance(i)
        });
      })
      .then(dish => {
        clearInterval(this._t);
        // 让最后一步「生成菜品档案」的状态看得见，再落地结果
        this.setData({ recogSteps: this.data.recogSteps.map(s => Object.assign({}, s, { state: 'done' })) });
        setTimeout(() => {
          this.setData({ recognizing: false });
          this.applyDish(dish);
          wx.showToast({
            title: dish.source === 'cloud' ? '已识别' : '已用本地兜底',
            icon: 'none'
          });
        }, 300);
      })
      .catch(err => {
        clearInterval(this._t);
        this.setData({ recognizing: false });
        wx.showToast({ title: '识别失败：' + (err.message || '未知'), icon: 'none' });
      });
  },

  advance(i) {
    const steps = this.data.recogSteps.map((s, idx) => {
      if (idx < i) return Object.assign({}, s, { state: 'done' });
      if (idx === i) return Object.assign({}, s, { state: 'doing' });
      return Object.assign({}, s, { state: '' });
    });
    this.setData({ recogSteps: steps });
  },

  /* ---------------- 其他 ---------------- */

  onSource() {
    const d = this.data.dish || {};
    const confidence = Math.round((d.confidence || 0) * 100);
    const lines = [];

    if (d.source === 'cloud') {
      // 有对账折扣时，模型自评和展示值是两个数，必须都说清楚，
      // 否则用户会以为被「偷偷降分」。
      if (typeof d.modelConfidence === 'number' && d.modelConfidence !== d.confidence) {
        lines.push('视觉模型自评 ' + Math.round(d.modelConfidence * 100) +
          '%，与知识库对账后调整为 ' + confidence + '%。');
      } else {
        lines.push('视觉模型看图后给出 ' + confidence + '% 的把握，与知识库记录一致。');
      }
      if (this.data.evidence.length) {
        lines.push('它看到的线索：' + this.data.evidence.join('；'));
      }
      if (d.uncertainty) {
        lines.push('它自己声明的不确定处：' + d.uncertainty);
      }
      if (d.reconcileNotes && d.reconcileNotes.length) {
        lines.push('对账更正的字段：' + d.reconcileNotes.join('；'));
      }
      if (d.reconcileReasons && d.reconcileReasons.length) {
        lines.push('下调原因：' + d.reconcileReasons.join('；'));
      }
      if (d.kbMatched === false) {
        lines.push('注意：这道菜不在知识库内，过敏原与辣度没有权威资料支撑，只能参考模型判断。');
      }
      if (d.allergens && d.allergens.length) {
        lines.push('过敏原依据：' + d.allergens.join('、') + '（来自菜品本体标注，不是配料文本猜测）');
      }
      lines.push('');
      lines.push('这个数字是模型自评经知识库校准后的结果，不是概率计算。低于 60% 就说明它没把握，建议跟服务员核对。');
    } else {
      lines.push('当前是本地知识库兜底结果，不是 AI 看图识别的。');
      lines.push('云端模型不可用时会出现这种情况，置信度不具参考意义。');
    }

    wx.showModal({
      title: '这个数字是怎么来的？',
      content: lines.join('\n'),
      showCancel: false,
      confirmText: '知道了'
    });
  },
  genRecipe() {
    wx.navigateTo({ url: '/pages/recipe/recipe?name=' + encodeURIComponent(this.data.dish.name) });
  },
  onAsk() { wx.navigateTo({ url: '/pages/assistant/assistant' }); }
});
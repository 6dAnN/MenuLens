/**
 * 悬浮 AI 小助手头像
 * 点击后跳转到 /pages/assistant/assistant 聊天页。
 * 通过 tab 页的 usingComponents 引入，全局悬浮。
 */
Component({
  properties: {
    /** 是否展示（默认 true） */
    visible: { type: Boolean, value: true }
  },

  data: {},

  methods: {
    onTap() {
      this.triggerEvent('open');
      wx.navigateTo({ url: '/pages/assistant/assistant' });
    }
  }
});

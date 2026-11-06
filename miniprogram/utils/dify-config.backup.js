/**
 * Dify 应用配置（占位值）
 * ------------------------------------------------------------------
 * 这是「入库的占位版本」，真实凭证请在本机填写后，用 git 保护：
 *
 *   git update-index --skip-worktree miniprogram/utils/dify-config.js
 *
 * 为什么不用 .gitignore 排除：微信小程序在【编译期】解析 require 目标，
 * 文件缺失直接编译报错，try/catch 救不了。所以本文件必须入库（占位值），
 * 本机再填真值并用 skip-worktree 保护。
 *
 * 三个值都在 Dify 应用详情页「API 访问」里拿到：
 *   - 识菜 Workflow：  difyDishEndpoint + difyDishKey
 *   - AI 小助手 Chatflow： difyChatEndpoint + difyChatKey（同 Key 复用，或分开）
 */
module.exports = {
  // 拍照识菜 Workflow（图片输入 → 视觉识别 → 知识库检索 → 结构化 JSON）
  difyDishEndpoint: 'https://YOUR-DIFY-HOST/v1/workflows/run',
  difyDishKey: 'app-YOUR_DISH_APP_KEY',

  // AI 小助手 Chatflow（RAG 问答，多轮对话）
  difyChatEndpoint: 'https://YOUR-DIFY-HOST/v1/chat-messages',
  difyChatKey: 'app-YOUR_CHAT_APP_KEY'
};

/**
 * 引擎统一入口
 * ------------------------------------------------------------------
 * 页面只 require 这个文件，不要直接 require api.js / ai-cloud.js。
 * 引擎切换（cloud↔dify）只改app.js 里的 ENGINE 常量，页面代码不动。
 *
 * 它同时做一件更重要的事：保证无论用哪套引擎，
 * 过敏原硬过滤都在代码层执行，不会被交给模型。
 */
const planner = require('./planner.js');
const dishes = require('./dishes.js');
const cloudAI = require('./ai-cloud.js');
const difyAI = require('./api.js');
const rag = require('./rag.js');

function currentEngine() {
  try {
    return getApp().globalData.engine || 'cloud';
  } catch (e) {
    return 'cloud';
  }
}

function impl() {
  return currentEngine() === 'dify' ? difyAI : cloudAI;
}

/* --- 转发五个能力 ------------------------------------------------------ */

function parseMenu(...args) { return impl().parseMenu(...args); }
function generatePlan(...args) { return impl().generatePlan(...args); }
function recognizeDish(...args) { return impl().recognizeDish(...args); }
function generateRecipe(...args) { return impl().generateRecipe(...args); }
function chat(...args) { return impl().chat(...args); }

/* --- 安全与确定性规则（与引擎无关，始终生效） ------------------------- */

const detectIntent = (...a) => impl().detectIntent(...a);
const isJailbreak = (...a) => impl().isJailbreak(...a);
const parseConstraintPatch = (...a) => impl().parseConstraintPatch(...a);
const localReply = (...a) => impl().localReply(...a);

/** 过敏原/忌口硬过滤——两套引擎都必须先过这一关 */
function hardFilter(items, ctx) {
  return planner.hardFilter(items, ctx);
}

/** 当前是否真的在走云端模型（SDK 可用且引擎是 cloud） */
function isCloudLive() {
  return currentEngine() === 'cloud' && cloudAI.isCloud();
}

/** 降级原因（仅 cloud 引擎会记录），供 UI 如实告知用户 */
function getLastError() {
  return currentEngine() === 'dify' ? null : cloudAI.getLastError();
}

function clearLastError() {
  if (currentEngine() !== 'dify') cloudAI.clearLastError();
}

/** 引擎名，UI 上展示用 */
function engineName() {
  if (currentEngine() === 'dify') return 'Dify Workflow';
  return isCloudLive() ? 'WorkBuddy 云服务' : '本地引擎（离线）';
}

module.exports = {
  currentEngine, engineName, isCloudLive,
  parseMenu, generatePlan, recognizeDish, generateRecipe, chat,
  detectIntent, isJailbreak, parseConstraintPatch, localReply,
  hardFilter, getLastError, clearLastError,
  planner, dishes, cloudAI, rag
};
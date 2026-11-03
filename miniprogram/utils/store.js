/**
 * 本地存储封装
 * 用 wx.setStorageSync 同步存（小程序没有 localStorage）
 */
const KEY_PREFIX = 'menulens_';

function set(key, value) {
  try {
    wx.setStorageSync(KEY_PREFIX + key, value);
  } catch (e) {
    console.error('[store] set failed:', key, e);
  }
}

function get(key, defaultVal = null) {
  try {
    const v = wx.getStorageSync(KEY_PREFIX + key);
    return v === '' || v === undefined ? defaultVal : v;
  } catch (e) {
    return defaultVal;
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(KEY_PREFIX + key);
  } catch (e) {}
}

/** 清空全部 MenuLens 数据（对应「我的 → 清除数据」） */
function clearAll() {
  try {
    const info = wx.getStorageInfoSync();
    info.keys.forEach(k => {
      if (k.indexOf(KEY_PREFIX) === 0) wx.removeStorageSync(k);
    });
  } catch (e) {}
}

module.exports = { set, get, remove, clearAll };
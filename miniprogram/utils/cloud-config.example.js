/**
 * 云服务本地私有配置（不入库）
 * ------------------------------------------------------------------
 * 复制本文件为 cloud-config.local.js，填上你自己开通云服务时拿到的
 * endpoint 与 publishableKey，然后小程序就能跑通真实大模型。
 *
 *   cp utils/cloud-config.example.js utils/cloud-config.local.js
 *
 * cloud-config.local.js 已被 .gitignore 忽略，不会被提交到仓库。
 *
 * 取值来源：开通 WorkBuddy 云服务后返回的 publicConfig。
 * publishableKey 只标识应用、不带权限，服务端会校验请求来源，
 * 但它等同于你这个应用的额度凭证，请勿公开。
 */
module.exports = {
  endpoint: 'https://YOUR-ENDPOINT.app.workbuddy.host',
  publishableKey: 'YOUR_PUBLISHABLE_KEY'
};

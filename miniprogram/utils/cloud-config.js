/**
 * 云服务配置
 * ------------------------------------------------------------------
 * ⚠ 这个文件会提交到仓库，仓库里保存的是【占位值】。
 *   真实凭证通过 git 的 skip-worktree 机制留在本机，不进版本历史：
 *
 *     git update-index --skip-worktree miniprogram/utils/cloud-config.js
 *
 *   （执行后本机可自由修改本文件，git 不会把改动纳入提交，也不会
 *     因为它与仓库版本不一致而阻塞 pull）
 *
 *   想取消保护、恢复跟仓库同步：
 *     git update-index --no-skip-worktree miniprogram/utils/cloud-config.js
 *
 * ⚠ 为什么是这个文件而不是 try/catch 包住 require：
 *   微信小程序在【编译期】就解析 require 的目标，文件缺失会直接编译
 *   报错，轮不到运行时的容错逻辑。所以配置文件必须始终存在于工程目录里，
 *   靠 gitignore 排除会让人克隆后编译不过。
 *
 *   字段说明：
 *     endpoint        云服务地址，形如 https://xxx.app.workbuddy.host
 *     publishableKey  公开标识符，只标识应用、不带权限（服务端校验请求来源），
 *                     但它等同于你这个云服务应用的额度凭证，请勿公开。
 *
 *   取值来源：开通 WorkBuddy 云服务后返回的 publicConfig。
 *   占位值状态下云端鉴权会失败，小程序会自动降级到本地确定性引擎，
 *   功能完整可用，只是模型换成本地规则引擎。
 */
module.exports = {
  endpoint: 'https://YOUR-ENDPOINT.app.workbuddy.host',
  publishableKey: 'YOUR_PUBLISHABLE_KEY'
};
/**
 * dsh-effort-config — 第三方模型思考努力度配置（DeepSeek Harness 插件）。
 *
 * Host 半：纯 UI 插件，无宿主侧行为。全部能力在浏览器半（exports["./client"]），
 * 通过现有 wire remote 工作：
 *   - connection.api.settings.describe / replace（读写 llm-pi-ai 用户层）
 *   - connection.api.llm.providers / models（可配置提供商目录与模型目录）
 *   - remote.$on（llm/adapters-updated、settings/document-updated 自动刷新）
 *
 * 零运行时依赖 import（仅 require("react")），不会引发模块解析失败。
 */
export default {
  name: 'dsh-effort-config',
  apply() {
    // 无宿主侧行为：UI 入口与数据流全部位于客户端半。
  },
}

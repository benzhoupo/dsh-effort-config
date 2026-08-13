# dsh-effort-config

DeepSeek Harness（dsh）插件：在**设置页**为第三方模型配置「思考努力度」档位，写入 `llm-pi-ai` 命名空间；**档位调节复用原生模型框的 Effort 面板**（composer 模型座 / `/model` 命令），选择器无需重做——模型声明档位后自动出现。

## 演示截图

![主界面.png](https://picui.ogmua.cn/s1/2026/08/14/6a7e033c029c9.webp)

![添加界面.png](https://picui.ogmua.cn/s1/2026/08/14/6a7e033c2d579.webp)

## 特性

- **设置页入口**：设置面板新增「思考努力度」页（`settings.section`），只展示**已配置**的提供商，新添加的在前
- **右上角添加提供商**（`settings.action` 按钮）：候选列表已配置的在前、手写路由优先；点击未配置的内置目录路由即启用（写入空 profile，模型与协议由 pi-ai 内置目录提供）
- **档位编辑**：每个模型可声明 7 档 `off / minimal / low / medium / high / xhigh / max` + wire 拼写（默认建议档位名）
  - 什么都没勾选 = 保持「未声明」（不写入档位）
  - 只勾 `off` = 「无思考能力」（`reasoningEfforts: false`）
  - 非 off 档位必须填写非空 wire 值；空 wire / 非法档位名被响亮拒绝且不落盘
- **路由默认档位**（`reasoning`）、**Anthropic token 预算**（`thinkingBudgets`，仅协议为 `anthropic-messages` 时显示）
- **删除提供商**（连同其全部思考档位配置），两段式确认
- **持久化**：写入 `settings.yaml` 的 `llm-pi-ai` 命名空间，重启后仍在
- **自动联动**：保存后模型选择框立即刷新（依赖原生 `llm/adapters-updated` 与 `settings/document-updated` 事件）

## 工作原理

| 层 | 说明 |
|---|---|
| Host 半（`index.js`） | 空实现（纯 UI 插件）。零运行时 import，不会引发 `ERR_MODULE_NOT_FOUND` 导致 dsh 启动崩溃 |
| 浏览器半（`client.js`） | 手写 `window.__ModuleLoader__.load` bundle（纯 JS，无需 tsdown 工具链），仅 `require("react")` |

全部数据走**现有 wire remote**，不依赖自定义 Host Remote（无需 typert 代码生成工具链）：

- `connection.api.settings.describe / replace` —— 读写 `llm-pi-ai` 用户层（乐观并发：`expectedRevision` + 冲突重放重试）
- `connection.api.llm.providers / models` —— 可配置提供商目录（displayName / declared / active）与宿主模型目录（catalog 路由的模型枚举）
- `remote.$on('llm/adapters-updated' | 'settings/document-updated')` —— 自动刷新

档位语义遵循 dsh-llm-pi-ai 的 `reasoningEfforts` 契约（键固定 7 档；值为 provider 端 wire 拼写；`off` 可留空 `null` = 不发送参数）。写入经 settings 层的 schema + validate 兜底（如 "offers no level beyond off" 在写入处拒绝），非法值绝不落盘。

### 排序语义

- 主列表：按 `settings.yaml` 中 `providers` 键序倒序（**新添加的在前**）
- 添加候选列表：已配置（用户自己的）在前、手写路由优先

### 与动态 Cordis 插件的差异

本包运行在浏览器 realm，无动态 Host 的 `node:vm` 原型校验问题（settings 层的 `isPlainObject` 按宿主 `Object.prototype` 校验，沙箱新建对象会被拒），因此写入逻辑更简单：深拷贝用户层 → 应用操作 → `settings.replace`。

## 安装

```sh
# 用 dsh 命令（推荐）：转发给 web profile 下的 pnpm
dsh plugin --profile web add /home/benzhoupo/ds-plugins/dsh-effort-config

# 或直接手动：
# cd ~/.dsh/profiles/web && pnpm add file:/home/benzhoupo/ds-plugins/dsh-effort-config
```

然后**重启 `dsh web`**（补丁行与浏览器 bundle 需要重新组合）。卸载：

```sh
dsh plugin --profile web remove dsh-effort-config
```

## 使用

1. 打开设置 → 左侧「**思考努力度**」（位于「模型」与「插件」之间）
2. 若还没有提供商：点右上角「**添加提供商**」→ 在候选列表中选择（已配置的排在前、标「已配置」不可重复添加）
3. 在提供商卡片中：
   - 对每个模型点「**编辑档位**」→ 勾选档位（wire 默认填档位名，可改）→ 保存
   - 「**路由默认档位**」下拉选择请求默认档位
   - Anthropic 兼容提供商（协议 `anthropic-messages`）显示「**Anthropic token 预算**」
4. 回 composer：模型座显示「模型名 · 档位」，Effort 面板列出所有档位，直接选择即可
5. 「**删除**」按钮（两段式确认）移除提供商及其全部思考档位配置

## settings.yaml 示例

```yaml
llm-pi-ai:
  providers:
    bearlab:
      displayName: BearLab
      apiKeyEnv: BEARLAB_API_KEY
      api: openai-responses
      baseURL: https://bearlab.ai/v1
      models:
        - id: gpt-5.6-sol
          name: GPT 5.6 Sol
          contextWindow: 256000
          reasoningEfforts:        # 手写路由：写在 models[] 条目上
            xhigh: xhigh           # wire 值 = provider 端拼写（openai-responses → reasoning.effort）
            off: null              # off 留空 = 不发送参数
      reasoning: xhigh             # 路由默认档位
    anthropic:                     # 内置目录路由：走 modelOverrides
      modelOverrides:
        claude-sonnet-4-5:
          reasoningEfforts:
            high: high
      thinkingBudgets:             # 仅 anthropic 协议有意义（budget_tokens）
        minimal: 1024
        low: 2048
        medium: 4096
        high: 8192
```

## wire 映射速查

| 协议 | 发送位置 | 档位值建议 |
|---|---|---|
| `openai-completions` | `reasoning_effort` | 档位名（如 `high`）或网关自有拼写 |
| `openai-responses` | `reasoning.effort` | 档位名 |
| `anthropic-messages` | 自适应思考 `effort`（或预算型 `budget_tokens`） | `low / medium / high / xhigh / max`；预算用路由级 `thinkingBudgets` |

## 故障排查

- **设置页看不到「思考努力度」**：确认已重启 dsh web、包已安装（`dsh plugin --profile web why dsh-effort-config`）
- **页面提示「llm-pi-ai 命名空间未注册」**：`@deepseek-ai/dsh-llm-pi-ai` 未加载或已被移除
- **添加后模型列表为空**：路由刚注册，点「刷新」（目录模型枚举依赖适配器注册完成）
- **默认模型选了未声明档位的模型**：请求会在网络 I/O 前以 `UNSUPPORTED_REASONING_EFFORT` 失败（pi-ai 原生行为），请为该模型声明档位或清除默认档位

## 许可

[CC BY 4.0](LICENSE)（Creative Commons Attribution 4.0 International），署名：**benzhoupo**。可自由分享与演绎，使用时请按要求署名。

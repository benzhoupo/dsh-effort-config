# dsh-effort-config

A DeepSeek Harness (dsh) plugin that lets you configure **reasoning-effort levels** for third-party models from the **settings page**, writing to the `llm-pi-ai` settings namespace. **Level selection reuses the native model picker's Effort panel** (composer model seat / `/model` command) — the selector is not reimplemented; it appears automatically once a model declares levels.

![Main page](https://picui.ogmua.cn/s1/2026/08/14/6a7e033c029c9.webp)

![Add provider](https://picui.ogmua.cn/s1/2026/08/14/6a7e033c2d579.webp)

## Features

- **Settings-page entry**: a new "思考努力度" (Reasoning Effort) page in the settings panel (`settings.section`), showing only **configured** providers, newest additions first
- **Add provider from the header** (`settings.action` button): the candidate list puts already-configured (your own) providers first, hand-written routes before catalog routes; clicking an unconfigured built-in catalog route enables it (writes an empty profile; models and protocol come from the pi-ai catalog)
- **Level editing**: each model can declare the 7 levels `off / minimal / low / medium / high / xhigh / max` plus a wire spelling (defaults to the level name)
  - nothing checked = stays **undeclared** (field not written)
  - only `off` checked = **no reasoning** (`reasoningEfforts: false`)
  - non-`off` levels require a non-empty wire value; empty wire values or unknown level names are rejected loudly and never persisted
- **Route default level** (`reasoning`) and **Anthropic token budgets** (`thinkingBudgets`, shown only when the protocol is `anthropic-messages`)
- **Delete a provider** (together with all of its reasoning-level configuration), with two-step confirmation
- **Persistent**: writes land in `settings.yaml` under `llm-pi-ai` and survive restarts
- **Live sync**: the model picker refreshes right after saving (via the native `llm/adapters-updated` and `settings/document-updated` events)

## How it works

| Layer | Notes |
|---|---|
| Host half (`index.js`) | Empty implementation (pure UI plugin). Zero runtime imports, so no `ERR_MODULE_NOT_FOUND` crash on dsh startup |
| Browser half (`client.js`) | Hand-written `window.__ModuleLoader__.load` bundle (plain JS, no tsdown toolchain), only `require("react")` |

All data flows through **existing wire remotes** — no custom Host Remote (no typert codegen toolchain needed):

- `connection.api.settings.describe / replace` — read/write the `llm-pi-ai` user layer (optimistic concurrency: `expectedRevision` plus replay-and-retry on conflict)
- `connection.api.llm.providers / models` — the configurable-provider directory (displayName / declared / active) and the host model catalog (model enumeration for catalog routes)
- `remote.$on('llm/adapters-updated' | 'settings/document-updated')` — automatic refresh

Level semantics follow the dsh-llm-pi-ai `reasoningEfforts` contract (keys fixed to the 7 levels; values are the provider-side wire spellings; `off` may be left `null` = send nothing). Writes are additionally guarded by the settings seam's schema + `validate` (e.g. "offers no level beyond off" is rejected at write time), so invalid values never persist.

### Ordering semantics

- Main list: reverse of the `providers` key order in `settings.yaml` (**newest first**)
- Add-provider candidate list: configured (your own) first, hand-written routes before catalog routes

### Differences from the dynamic Cordis plugin

This package runs in the browser realm and is unaffected by the dynamic host's `node:vm` prototype-identity issue (the settings seam's `isPlainObject` checks against the host `Object.prototype`, so objects created inside the sandbox realm are rejected). The write path is therefore simpler: deep-copy the user layer → apply operations → `settings.replace`.

## Installation

```sh
# Using the dsh CLI (recommended): forwards to pnpm in the web profile
dsh plugin --profile web add /home/benzhoupo/ds-plugins/dsh-effort-config

# Or manually:
# cd ~/.dsh/profiles/web && pnpm add file:/home/benzhoupo/ds-plugins/dsh-effort-config
```

Then **restart `dsh web`** (the patch row and the browser bundle need to be recomposed). To uninstall:

```sh
dsh plugin --profile web remove dsh-effort-config
```

## Usage

1. Open Settings → "**思考努力度**" in the left nav (between "模型" and "插件")
2. If you have no provider yet: click "**添加提供商**" in the header → pick one from the candidate list (configured providers come first and are marked "已配置"; they cannot be re-added)
3. On a provider card:
   - For each model, click "**编辑档位**" → check levels (wire defaults to the level name; edit as needed) → Save
   - Use the "**路由默认档位**" dropdown to set the request default level
   - Anthropic-compatible providers (protocol `anthropic-messages`) show "**Anthropic token 预算**"
4. Back in the composer: the model seat shows "model name · level" and the Effort panel lists all declared levels — pick one directly
5. The "**删除**" button (two-step confirmation) removes the provider and all of its reasoning configuration

## settings.yaml example

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
          reasoningEfforts:        # hand-written route: written on the models[] entry
            xhigh: xhigh           # wire value = provider-side spelling (openai-responses → reasoning.effort)
            off: null              # off left empty = send no parameter
      reasoning: xhigh             # route default level
    anthropic:                     # catalog route: goes through modelOverrides
      modelOverrides:
        claude-sonnet-4-5:
          reasoningEfforts:
            high: high
      thinkingBudgets:             # meaningful only for the anthropic protocol (budget_tokens)
        minimal: 1024
        low: 2048
        medium: 4096
        high: 8192
```

## Wire mapping cheat sheet

| Protocol | Where it is sent | Suggested level values |
|---|---|---|
| `openai-completions` | `reasoning_effort` | the level name (e.g. `high`) or a gateway-specific spelling |
| `openai-responses` | `reasoning.effort` | the level name |
| `anthropic-messages` | adaptive-thinking `effort` (or budget-based `budget_tokens`) | `low / medium / high / xhigh / max`; budgets via route-level `thinkingBudgets` |

## Troubleshooting

- **"思考努力度" missing from settings**: make sure dsh web was restarted and the package is installed (`dsh plugin --profile web why dsh-effort-config`)
- **Page says "llm-pi-ai 命名空间未注册"**: `@deepseek-ai/dsh-llm-pi-ai` is not loaded or was removed
- **Model list empty right after adding a provider**: the route was just registered — click "刷新" (catalog enumeration depends on adapter registration completing)
- **Default model points at a model with no declared levels**: requests fail with `UNSUPPORTED_REASONING_EFFORT` before network I/O (native pi-ai behavior); declare levels for that model or clear the default level

## License

[CC BY 4.0](LICENSE) (Creative Commons Attribution 4.0 International), attribution: **benzhoupo**. You are free to share and adapt the work, provided you give appropriate credit.

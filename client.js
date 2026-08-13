/**
 * dsh-effort-config — 浏览器半。
 *
 * 手写 ModuleLoader bundle（纯 JS，无构建工具链）。全部数据经现有 wire remote：
 *   connection.api.settings.describe / replace、connection.api.llm.providers / models、
 *   remote.$on 自动刷新。注册设置页「思考努力度」与右上角「添加提供商」。
 */
window.__ModuleLoader__.load({
  id: 'dsh-effort-config',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    var react = require('react')

    var NS = 'llm-pi-ai'
    var LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    var LEVEL_HINTS = {
      off: '不思考（不发送档位参数）',
      minimal: '极少思考',
      low: '少量思考',
      medium: '中等思考',
      high: '较强思考',
      xhigh: '更强思考',
      max: '最强思考',
    }

    function defaultWire(level) {
      return level === 'off' ? null : level
    }

    function effortsToDict(efforts) {
      if (efforts === false || efforts === null || efforts === undefined) return {}
      var out = {}
      for (var i = 0; i < LEVELS.length; i++) {
        var level = LEVELS[i]
        if (efforts[level] !== undefined) out[level] = efforts[level]
      }
      return out
    }

    function wireText(wire) {
      return wire === null || wire === undefined ? '' : String(wire)
    }

    function effortChips(efforts) {
      if (efforts === false) {
        return react.createElement('span', { className: 'dsh-ee-chip dsh-ee-chipFalse' }, '无思考能力（false）')
      }
      if (efforts === null || efforts === undefined) {
        return react.createElement('span', { className: 'dsh-ee-chip dsh-ee-chipNone' }, '未声明档位')
      }
      var parts = []
      for (var i = 0; i < LEVELS.length; i++) {
        var level = LEVELS[i]
        if (efforts[level] === undefined) continue
        var label = level === 'off' ? 'off → (空)' : level + ' → ' + String(efforts[level])
        parts.push(react.createElement('span', { className: 'dsh-ee-chip', key: level }, label))
      }
      return parts.length === 0
        ? react.createElement('span', { className: 'dsh-ee-chip dsh-ee-chipNone' }, '未声明档位')
        : parts
    }

    function budgetsSummary(budgets) {
      if (budgets === null || budgets === undefined) return null
      var parts = []
      for (var i = 0; i < 4; i++) {
        var k = ['minimal', 'low', 'medium', 'high'][i]
        if (budgets[k] !== undefined) parts.push(k + ' ' + String(budgets[k]))
      }
      return parts.length === 0 ? null : parts.join(' · ')
    }

    function draftErrors(draft) {
      var errors = []
      for (var i = 0; i < LEVELS.length; i++) {
        var level = LEVELS[i]
        if (draft[level] === undefined) continue
        if (level === 'off') {
          if (typeof draft[level] === 'string' && draft[level].length === 0) errors.push('off 档位请留空即可')
        } else if (typeof draft[level] !== 'string' || draft[level].length === 0) {
          errors.push('档位 ' + level + ' 必须填写 wire 值（仅 off 可留空）')
        }
      }
      return errors
    }

    // 校验档位声明。返回：false（无思考能力）/ 'unset'（未声明）/ 原 efforts 对象。
    function validateEfforts(route, model, efforts) {
      if (efforts === false) return false
      if (efforts === null || typeof efforts !== 'object' || Array.isArray(efforts)) {
        throw new Error('模型 ' + route + '/' + model + ' 的档位配置必须是对象或 false')
      }
      var keys = Object.keys(efforts)
      for (var i = 0; i < keys.length; i++) {
        var level = keys[i]
        if (LEVELS.indexOf(level) === -1) {
          throw new Error('模型 ' + route + '/' + model + ' 包含未知档位 "' + level + '"（允许：' + LEVELS.join('/') + '）')
        }
        var wire = efforts[level]
        if (level === 'off') {
          if (!(wire === null || wire === undefined || (typeof wire === 'string' && wire.length > 0))) {
            throw new Error('模型 ' + route + '/' + model + ' 的 off 档位只能留空（null）或填写非空字符串')
          }
        } else if (typeof wire !== 'string' || wire.length === 0) {
          throw new Error('模型 ' + route + '/' + model + ' 的 "' + level + '" 档位必须填写非空 wire 值（仅 off 可留空）')
        }
      }
      var hasThinking = false
      for (var j = 0; j < LEVELS.length; j++) {
        if (LEVELS[j] !== 'off' && efforts[LEVELS[j]] !== undefined) { hasThinking = true; break }
      }
      if (!hasThinking) return efforts.off !== undefined ? false : 'unset'
      return efforts
    }

    function validateBudgets(budgets) {
      if (budgets === null || budgets === undefined) return null
      if (typeof budgets !== 'object' || Array.isArray(budgets)) {
        throw new Error('预算必须是对象 {minimal, low, medium, high}')
      }
      var keys = ['minimal', 'low', 'medium', 'high']
      for (var i = 0; i < 4; i++) {
        var key = keys[i]
        var value = budgets[key]
        if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
          throw new Error('预算 ' + key + ' 必须是大于等于 1 的数字')
        }
      }
      return budgets
    }

    // 把一条 op 应用到用户层深拷贝上（浏览器 realm，可自由构造对象；幂等）。
    function applyOp(user, resolved, op) {
      var providers = user.providers
      if (providers === undefined || providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
        throw new Error('用户配置缺少 providers 段')
      }
      var route = op.route
      if (typeof route !== 'string' || route.length === 0) throw new Error('缺少路由 route')
      var rp = providers[route]
      if (rp === undefined || rp === null || typeof rp !== 'object' || Array.isArray(rp)) {
        rp = {}
        providers[route] = rp
      }
      if (op.type === 'set-efforts') {
        var model = op.model
        if (typeof model !== 'string' || model.length === 0) throw new Error('路由 ' + route + '：缺少模型 id')
        var efforts = validateEfforts(route, model, op.efforts)
        if (Array.isArray(rp.models) && rp.models.length > 0) {
          var index = rp.models.findIndex(function (m) { return m.id === model })
          if (index === -1) throw new Error('路由 ' + route + ' 的模型列表中找不到 "' + model + '"')
          if (efforts === 'unset') {
            delete rp.models[index].reasoningEfforts
          } else {
            rp.models[index].reasoningEfforts = efforts
          }
        } else {
          var resolvedRoute = resolved && resolved.providers && resolved.providers[route] && typeof resolved.providers[route] === 'object'
            ? resolved.providers[route] : null
          if (resolvedRoute !== null && Array.isArray(resolvedRoute.models) && resolvedRoute.models.length > 0) {
            throw new Error('路由 ' + route + ' 的模型列表来自组合配置层（base）；请先在 settings.yaml 中为该路由声明 models 后再编辑档位')
          }
          var overrides = rp.modelOverrides
          if (overrides === undefined || overrides === null || typeof overrides !== 'object' || Array.isArray(overrides)) {
            overrides = {}
            rp.modelOverrides = overrides
          }
          var existing = overrides[model]
          if (efforts === 'unset') {
            if (existing !== undefined && existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
              delete existing.reasoningEfforts
              if (Object.keys(existing).length === 0) delete overrides[model]
            }
          } else if (existing !== undefined && existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
            existing.reasoningEfforts = efforts
          } else {
            overrides[model] = { reasoningEfforts: efforts }
          }
        }
        return
      }
      if (op.type === 'set-route-default') {
        if (op.level === null || op.level === undefined) {
          delete rp.reasoning
        } else {
          if (LEVELS.indexOf(op.level) === -1) {
            throw new Error('未知档位 "' + op.level + '"（允许：' + LEVELS.join('/') + '）')
          }
          rp.reasoning = op.level
        }
        return
      }
      if (op.type === 'set-budgets') {
        if (op.budgets === null || op.budgets === undefined) {
          delete rp.thinkingBudgets
        } else {
          rp.thinkingBudgets = validateBudgets(op.budgets)
        }
        return
      }
      throw new Error('未知操作类型 "' + op.type + '"')
    }

    // ---- wire 辅助 ----

    function apiError(result) {
      return (result && result.result && result.result.error && result.result.error.message) || '请求失败'
    }

    function describeView(api) {
      return api.settings.describe({}).then(function (res) {
        if (!res || !res.result || !res.result.ok) throw new Error(apiError(res))
        var value = res.result.value
        var view = null
        for (var i = 0; i < value.namespaces.length; i++) {
          if (value.namespaces[i].ns === NS) { view = value.namespaces[i]; break }
        }
        if (view === null) throw new Error('llm-pi-ai 命名空间未注册（dsh-llm-pi-ai 未加载？）')
        return { view: view, writable: value.writable }
      })
    }

    // 组装设置页视图：目录 + 已配置路由 + 模型 + 档位现状。排序：用户层键序逆序（新添加的在前）。
    function loadView(api) {
      return describeView(api).then(function (wrapped) {
        var view = wrapped.view
        var writable = wrapped.writable
        var value = view.value !== undefined && view.value !== null && typeof view.value === 'object' ? view.value : {}
        var resolvedProviders = value.providers !== undefined && value.providers !== null && typeof value.providers === 'object' ? value.providers : {}
        var userProviders = {}
        if (view.user !== undefined && view.user !== null && typeof view.user === 'object') {
          var u = view.user
          if (u.providers !== undefined && u.providers !== null && typeof u.providers === 'object') userProviders = u.providers
        }
        var userOrder = Object.keys(userProviders)
        return Promise.all([
          api.llm.providers({}).then(function (res) {
            if (!res || !res.result || !res.result.ok) return []
            var out = []
            for (var i = 0; i < res.result.value.providers.length; i++) {
              var p = res.result.value.providers[i]
              if (p.settingsNs === NS) out.push(p)
            }
            return out
          }).catch(function () { return [] }),
          api.llm.models({}).then(function (res) {
            if (!res || !res.result || !res.result.ok) return {}
            var out = {}
            var groups = res.result.value.groups || []
            for (var i = 0; i < groups.length; i++) out[groups[i].id] = groups[i].models || []
            return out
          }).catch(function () { return {} }),
        ]).then(function (results) {
          var directory = results[0]
          var groupByName = results[1]
          var providers = []
          for (var d = 0; d < directory.length; d++) {
            var entry = directory[d]
            var profile = resolvedProviders[entry.provider]
            var configured = profile !== undefined && profile !== null
            var models = []
            if (configured && Array.isArray(profile.models) && profile.models.length > 0) {
              for (var m = 0; m < profile.models.length; m++) {
                var me = profile.models[m]
                models.push({ id: me.id, name: me.name || me.id, efforts: me.reasoningEfforts === undefined ? null : me.reasoningEfforts })
              }
            } else if (configured) {
              var overrides = profile.modelOverrides !== undefined && profile.modelOverrides !== null && typeof profile.modelOverrides === 'object' ? profile.modelOverrides : {}
              var catalog = groupByName[entry.provider] || []
              for (var c = 0; c < catalog.length; c++) {
                var cm = catalog[c]
                var ov = overrides[cm.id]
                models.push({
                  id: cm.id,
                  name: cm.name || cm.id,
                  efforts: ov === undefined || ov.reasoningEfforts === undefined ? null : ov.reasoningEfforts,
                })
              }
            }
            providers.push({
              provider: entry.provider,
              displayName: entry.displayName || entry.provider,
              declared: entry.declared === true,
              active: entry.active === true,
              api: configured && typeof profile.api === 'string' ? profile.api : null,
              reasoning: configured && profile.reasoning !== undefined ? profile.reasoning : null,
              budgets: configured && profile.thinkingBudgets !== undefined ? profile.thinkingBudgets : null,
              configured: configured,
              models: models,
            })
          }
          providers.sort(function (a, b) {
            var ia = userOrder.indexOf(a.provider)
            var ib = userOrder.indexOf(b.provider)
            if (ia === -1 && ib === -1) return 0
            if (ia === -1) return 1
            if (ib === -1) return -1
            return ib - ia
          })
          return { providers: providers, revision: view.revision, writable: writable }
        })
      })
    }

    // 保存：深拷贝最新 user 层 → 应用 ops → settings.replace（乐观并发 + 重放重试）。
    function saveOps(api, ops, expectedRevision) {
      if (ops.length === 0) return Promise.resolve({ ok: true, revision: 0, noop: true })
      var lastError = null
      var attempt = 0
      function tryOnce() {
        return describeView(api).then(function (wrapped) {
          var view = wrapped.view
          var user = view.user !== undefined && view.user !== null ? JSON.parse(JSON.stringify(view.user)) : {}
          if (user.providers === undefined || user.providers === null || typeof user.providers !== 'object' || Array.isArray(user.providers)) {
            user.providers = {}
          }
          try {
            for (var i = 0; i < ops.length; i++) applyOp(user, view.value, ops[i])
          } catch (e) {
            return { ok: false, error: String((e && e.message) || e) }
          }
          var expected = attempt === 0 && expectedRevision !== undefined ? expectedRevision : view.revision
          return api.settings.replace({ ns: NS, section: user, expectedRevision: expected }).then(function (res) {
            if (!res || !res.result || !res.result.ok) {
              lastError = apiError(res)
              if (attempt < 2) { attempt++; return tryOnce() }
              return { ok: false, error: lastError }
            }
            return { ok: true, revision: res.result.value.revision }
          }).catch(function (e) {
            lastError = String((e && e.message) || e)
            if (attempt < 2) { attempt++; return tryOnce() }
            return { ok: false, error: lastError }
          })
        }).catch(function (e) {
          lastError = String((e && e.message) || e)
          if (attempt < 2) { attempt++; return tryOnce() }
          return { ok: false, error: lastError }
        })
      }
      return tryOnce()
    }

    function routeInDirectory(api, route) {
      return api.llm.providers({}).then(function (res) {
        if (!res || !res.result || !res.result.ok) return null
        var list = res.result.value.providers
        for (var i = 0; i < list.length; i++) {
          if (list[i].settingsNs === NS && list[i].provider === route) return list[i]
        }
        return null
      }).catch(function () { return null })
    }

    // 启用目录提供商：user.providers[route] = {}。
    function addRoute(api, route) {
      return routeInDirectory(api, route).then(function (entry) {
        if (entry === null) return { ok: false, error: '提供商 "' + route + '" 不在可配置目录中' }
        if (entry.declared === true) {
          return { ok: false, error: '"' + route + '" 是手写路由（已在配置中声明），请直接在 settings.yaml 或「模型」设置页配置' }
        }
        return describeView(api).then(function (wrapped) {
          var view = wrapped.view
          var value = view.value !== undefined && view.value !== null && typeof view.value === 'object' ? view.value : {}
          var resolvedProviders = value.providers !== undefined && value.providers !== null && typeof value.providers === 'object' ? value.providers : {}
          if (resolvedProviders[route] !== undefined && resolvedProviders[route] !== null) {
            return { ok: false, error: '提供商 "' + route + '" 已配置' }
          }
          var user = view.user !== undefined && view.user !== null ? JSON.parse(JSON.stringify(view.user)) : {}
          if (user.providers === undefined || user.providers === null || typeof user.providers !== 'object' || Array.isArray(user.providers)) {
            user.providers = {}
          }
          user.providers[route] = {}
          return api.settings.replace({ ns: NS, section: user, expectedRevision: view.revision }).then(function (res) {
            if (!res || !res.result || !res.result.ok) return { ok: false, error: apiError(res) }
            return { ok: true, revision: res.result.value.revision }
          })
        })
      })
    }

    // 删除提供商：从用户层移除整个 profile（含档位、默认档位、预算）。
    function removeRoute(api, route) {
      return routeInDirectory(api, route).then(function (entry) {
        if (entry === null) return { ok: false, error: '提供商 "' + route + '" 不在可配置目录中' }
        return describeView(api).then(function (wrapped) {
          var view = wrapped.view
          var value = view.value !== undefined && view.value !== null && typeof view.value === 'object' ? view.value : {}
          var resolvedProviders = value.providers !== undefined && value.providers !== null && typeof value.providers === 'object' ? value.providers : {}
          if (resolvedProviders[route] === undefined || resolvedProviders[route] === null) {
            return { ok: false, error: '提供商 "' + route + '" 未配置' }
          }
          var user = view.user !== undefined && view.user !== null ? JSON.parse(JSON.stringify(view.user)) : {}
          if (user.providers === undefined || user.providers === null || typeof user.providers !== 'object' || Array.isArray(user.providers)) {
            user.providers = {}
          }
          if (user.providers[route] === undefined || user.providers[route] === null) {
            return { ok: false, error: '提供商 "' + route + '" 的配置来自组合配置层（base），无法经界面删除；请直接修改配置文件' }
          }
          delete user.providers[route]
          return api.settings.replace({ ns: NS, section: user, expectedRevision: view.revision }).then(function (res) {
            if (!res || !res.result || !res.result.ok) return { ok: false, error: apiError(res) }
            return { ok: true, revision: res.result.value.revision }
          })
        })
      })
    }

    // ---- UI 组件 ----

    function EffortPage(props) {
      var api = props.api
      var remote = props.remote
      var ctx = props.ctx
      var addingNow = props.addingNow
      var setAddingNow = props.setOnAdding
      var useState = react.useState
      var useEffect = react.useEffect
      var state0 = useState({ status: 'loading', providers: [], revision: 0, error: null, writable: true })
      var state = state0[0]
      var setState = state0[1]
      var notice0 = useState(null)
      var notice = notice0[0]
      var setNotice = notice0[1]
      var token0 = useState(0)
      var reloadToken = token0[0]
      var setReloadToken = token0[1]

      useEffect(function () {
        var alive = true
        loadView(api).then(function (view) {
          if (!alive) return
          setState({ status: 'ready', providers: view.providers, revision: view.revision, error: null, writable: view.writable !== false })
        }).catch(function (err) {
          if (!alive) return
          setState(function (s) { return Object.assign({}, s, { status: 'ready', error: String((err && err.message) || err) }) })
        })
        return function () { alive = false }
      }, [reloadToken])

      useEffect(function () {
        var refresh = function () { setReloadToken(function (t) { return t + 1 }) }
        var disposers = []
        if (remote !== undefined) {
          var d1 = remote.$on('settings/document-updated', refresh)
          var d2 = remote.$on('llm/adapters-updated', refresh)
          if (typeof d1 === 'function') disposers.push(d1)
          if (typeof d2 === 'function') disposers.push(d2)
        }
        if (ctx !== undefined) disposers.push(ctx.on('connection/reset', refresh))
        return function () {
          for (var i = 0; i < disposers.length; i++) {
            try { disposers[i]() } catch (e) { /* noop */ }
          }
        }
      }, [])

      var reload = function () { setReloadToken(function (t) { return t + 1 }) }

      if (state.status === 'loading') {
        return react.createElement('div', { className: 'dsh-ee-section' }, '正在读取模型配置…')
      }

      var configured = []
      for (var i = 0; i < state.providers.length; i++) {
        if (state.providers[i].configured) configured.push(state.providers[i])
      }
      var candidates = state.providers.slice().sort(function (a, b) {
        if (a.configured !== b.configured) return a.configured ? -1 : 1
        if (a.declared !== b.declared) return a.declared ? -1 : 1
        return 0
      })

      return react.createElement('div', { className: 'dsh-ee-section' },
        react.createElement('h2', { className: 'dsh-ee-title' }, '思考努力度'),
        react.createElement('p', { className: 'dsh-ee-intro' },
          '为第三方模型声明思考档位：档位名固定为 off / minimal / low / medium / high / xhigh / max，值为该档位在 provider 端发送的 wire 拼写（默认建议档位名；off 留空表示不发送参数）。什么都没勾选 = 保持「未声明」（不写入档位）；只勾 off = 「无思考能力」。保存后即可在模型选择框的 Effort 面板中直接调节。'),
        state.error !== null && react.createElement('div', { className: 'dsh-ee-banner dsh-ee-bannerError' },
          react.createElement('span', null, state.error),
          react.createElement('button', { className: 'dsh-ee-linkButton', onClick: reload }, '重试')),
        notice !== null && react.createElement('div', { className: 'dsh-ee-banner dsh-ee-bannerOk' }, notice),
        addingNow && react.createElement('div', { className: 'dsh-ee-addArea' },
          react.createElement('span', { className: 'dsh-ee-fieldLabel' }, '选择提供商（已配置的在前；点击未配置的将其启用）'),
          candidates.map(function (p) {
            return react.createElement('button', {
              key: p.provider,
              className: 'dsh-ee-addRow' + (p.configured ? ' dsh-ee-addRowDisabled' : ''),
              disabled: p.configured,
              onClick: function () {
                addRoute(api, p.provider).then(function (res) {
                  if (res && res.ok) {
                    setAddingNow(false)
                    setNotice('已添加提供商「' + p.displayName + '（' + p.provider + '）」')
                    reload()
                  } else {
                    setState(function (s) { return Object.assign({}, s, { error: (res && res.error) || '添加失败' }) })
                  }
                }).catch(function (err) {
                  setState(function (s) { return Object.assign({}, s, { error: String((err && err.message) || err) }) })
                })
              },
            },
              react.createElement('span', { className: 'dsh-ee-addName' }, p.displayName),
              react.createElement('code', { className: 'dsh-ee-routeKey' }, p.provider),
              react.createElement('span', { className: 'dsh-ee-tag' }, p.declared ? '手写路由' : '内置目录'),
              p.configured && react.createElement('span', { className: 'dsh-ee-tag dsh-ee-tagOk' }, '已配置'))
          })),
        configured.length === 0 && !addingNow && !state.error
          ? react.createElement('p', { className: 'dsh-ee-empty' }, '尚未配置提供商。点击右上角「添加提供商」选择并启用一个提供商后，即可为其模型配置思考档位。')
          : configured.map(function (p) {
            return react.createElement(RouteCard, {
              key: p.provider,
              provider: p,
              api: api,
              revision: state.revision,
              onSaved: function (msg) { setNotice(msg); reload() },
              onError: function (msg) { setState(function (s) { return Object.assign({}, s, { error: msg }) }) },
            })
          }),
        react.createElement('div', { className: 'dsh-ee-footer' },
          react.createElement('button', { className: 'dsh-ee-secondaryButton', onClick: reload }, '刷新'),
          state.writable === false && react.createElement('span', { className: 'dsh-ee-hint' }, '当前 settings 只读，无法保存'))
      )
    }

    function routeDraftIssues(drafts, provider) {
      var errors = []
      var warnings = []
      var models = Object.keys(drafts)
      for (var i = 0; i < models.length; i++) {
        var model = models[i]
        var d = drafts[model]
        var errs = draftErrors(d)
        for (var e = 0; e < errs.length; e++) errors.push('模型 ' + model + '：' + errs[e])
        if (d === false) continue
        var hasAny = Object.keys(d).length > 0
        var hasThinking = false
        for (var j = 0; j < LEVELS.length; j++) {
          if (LEVELS[j] !== 'off' && d[LEVELS[j]] !== undefined) { hasThinking = true; break }
        }
        if (!hasThinking) {
          var current = null
          for (var k = 0; k < provider.models.length; k++) {
            if (provider.models[k].id === model) { current = provider.models[k].efforts; break }
          }
          if (!hasAny) {
            if (current !== null && current !== undefined && current !== false) {
              warnings.push('模型 ' + model + '：未选择任何档位，保存后将清除档位声明（未声明）')
            }
          } else {
            warnings.push('模型 ' + model + '：仅剩 off，保存后将设为「无思考能力（false）」')
          }
        }
      }
      return { errors: errors, warnings: warnings }
    }

    function budgetValuesValid(values) {
      var keys = ['minimal', 'low', 'medium', 'high']
      for (var i = 0; i < 4; i++) {
        var k = keys[i]
        var v = Number(values[k])
        if (values[k] === '' || !Number.isFinite(v) || v < 1) return false
      }
      return true
    }

    function parseBudgets(values) {
      return {
        minimal: Math.floor(Number(values.minimal)),
        low: Math.floor(Number(values.low)),
        medium: Math.floor(Number(values.medium)),
        high: Math.floor(Number(values.high)),
      }
    }

    function RouteCard(props) {
      var p = props.provider
      var api = props.api
      var useState = react.useState
      var useEffect = react.useEffect
      var drafts0 = useState({})
      var drafts = drafts0[0]
      var setDrafts = drafts0[1]
      var open0 = useState({})
      var openModels = open0[0]
      var setOpenModels = open0[1]
      var def0 = useState(undefined)
      var defaultDraft = def0[0]
      var setDefaultDraft = def0[1]
      var bm0 = useState('keep')
      var budgetMode = bm0[0]
      var setBudgetMode = bm0[1]
      var bv0 = useState({ minimal: '', low: '', medium: '', high: '' })
      var budgetValues = bv0[0]
      var setBudgetValues = bv0[1]
      var busy0 = useState(false)
      var busy = busy0[0]
      var setBusy = busy0[1]
      var ce0 = useState(null)
      var cardError = ce0[0]
      var setCardError = ce0[1]
      var cd0 = useState(false)
      var confirmDelete = cd0[0]
      var setConfirmDelete = cd0[1]

      useEffect(function () {
        setDrafts({})
        setOpenModels({})
        setDefaultDraft(undefined)
        setBudgetMode('keep')
        setCardError(null)
        setConfirmDelete(false)
      }, [props.revision])

      var issues = routeDraftIssues(drafts, p)
      var isAnthropic = p.api === 'anthropic-messages'
      var budgetInvalid = isAnthropic && budgetMode === 'set' && !budgetValuesValid(budgetValues)
      var canSave = !busy && issues.errors.length === 0 && !budgetInvalid

      var save = function () {
        var ops = []
        var models = Object.keys(drafts)
        for (var i = 0; i < models.length; i++) {
          ops.push({ type: 'set-efforts', route: p.provider, model: models[i], efforts: drafts[models[i]] })
        }
        if (defaultDraft !== undefined) ops.push({ type: 'set-route-default', route: p.provider, level: defaultDraft })
        if (isAnthropic && budgetMode === 'set') ops.push({ type: 'set-budgets', route: p.provider, budgets: parseBudgets(budgetValues) })
        if (isAnthropic && budgetMode === 'clear') ops.push({ type: 'set-budgets', route: p.provider, budgets: null })
        if (ops.length === 0) return
        setBusy(true)
        setCardError(null)
        saveOps(api, ops, props.revision).then(function (res) {
          if (res && res.ok) {
            var updated = []
            if (ops.some(function (o) { return o.type === 'set-efforts' })) updated.push('档位')
            if (ops.some(function (o) { return o.type === 'set-route-default' })) updated.push('路由默认档位')
            if (ops.some(function (o) { return o.type === 'set-budgets' })) updated.push('Anthropic token 预算')
            props.onSaved('已保存：' + updated.join('、') + ' 已更新。可在模型选择框的 Effort 面板中直接调节档位。')
          } else {
            setCardError((res && res.error) || '保存失败')
          }
        }).catch(function (err) {
          setCardError(String((err && err.message) || err))
        }).then(function () {
          setBusy(false)
        })
      }

      var remove = function () {
        setBusy(true)
        setCardError(null)
        removeRoute(api, p.provider).then(function (res) {
          if (res && res.ok) {
            props.onSaved('已删除提供商「' + p.displayName + '（' + p.provider + '）」及其全部思考档位配置。')
          } else {
            setCardError((res && res.error) || '删除失败')
            setConfirmDelete(false)
          }
        }).catch(function (err) {
          setCardError(String((err && err.message) || err))
          setConfirmDelete(false)
        }).then(function () {
          setBusy(false)
        })
      }

      var unionLevels = []
      for (var mi = 0; mi < p.models.length; mi++) {
        var m = p.models[mi]
        if (m.efforts === false || m.efforts === null || m.efforts === undefined) continue
        for (var li = 0; li < LEVELS.length; li++) {
          var level = LEVELS[li]
          if (level !== 'off' && m.efforts[level] !== undefined && unionLevels.indexOf(level) === -1) unionLevels.push(level)
        }
      }
      var budgetSummary = budgetsSummary(p.budgets)

      return react.createElement('div', { className: 'dsh-ee-routeCard' },
        react.createElement('div', { className: 'dsh-ee-routeHead' },
          react.createElement('div', { className: 'dsh-ee-routeIdentity' },
            react.createElement('span', { className: 'dsh-ee-routeName' }, p.displayName),
            react.createElement('code', { className: 'dsh-ee-routeKey' }, p.provider),
            react.createElement('span', { className: 'dsh-ee-tag' }, p.declared ? '手写路由' : '内置目录'),
            react.createElement('div', { className: 'dsh-ee-routeActions' },
              confirmDelete
                ? react.createElement(react.Fragment, null,
                    react.createElement('span', { className: 'dsh-ee-warn' }, '将移除该提供商及其全部思考档位配置' + (p.declared ? '（手写路由删除后需在配置文件中重新声明）' : '')),
                    react.createElement('button', { className: 'dsh-ee-dangerButton', disabled: busy, onClick: remove }, '确认删除'),
                    react.createElement('button', { className: 'dsh-ee-linkButton', disabled: busy, onClick: function () { setConfirmDelete(false) } }, '取消'))
                : react.createElement('button', { className: 'dsh-ee-dangerButton', onClick: function () { setConfirmDelete(true) } }, '删除'))),
          react.createElement('div', { className: 'dsh-ee-routeMeta' },
            p.api !== null && react.createElement('span', { className: 'dsh-ee-hint' }, '协议：' + p.api),
            react.createElement('span', { className: 'dsh-ee-hint' }, isAnthropic ? '提示：可配置自适应 effort 档位，或使用下方 token 预算（budget_tokens）' : '提示：wire 默认建议档位名，可按网关要求改写'))),
        p.models.length === 0
          ? react.createElement('p', { className: 'dsh-ee-empty' }, '该路由暂无可用模型（模型列表来自内置目录；若刚启用请点「刷新」）。')
          : p.models.map(function (m) {
            return react.createElement('div', { className: 'dsh-ee-modelRow', key: m.id },
              react.createElement('div', { className: 'dsh-ee-modelLine' },
                react.createElement('span', { className: 'dsh-ee-modelName' }, m.name),
                react.createElement('code', { className: 'dsh-ee-modelId' }, m.id),
                react.createElement('span', { className: 'dsh-ee-chips' }, effortChips(m.efforts)),
                react.createElement('button', {
                  className: 'dsh-ee-linkButton',
                  onClick: function () {
                    setOpenModels(function (o) {
                      var next = Object.assign({}, o)
                      if (next[m.id]) { delete next[m.id] } else { next[m.id] = true }
                      return next
                    })
                    setDrafts(function (d) { return d[m.id] !== undefined ? d : Object.assign({}, d, (function (x) { x[m.id] = effortsToDict(m.efforts); return x })({})) })
                  },
                }, openModels[m.id] ? '收起' : '编辑档位')),
              openModels[m.id] && react.createElement(ModelEditor, {
                draft: drafts[m.id],
                onChange: function (next) { setDrafts(function (d) { return Object.assign({}, d, (function (x) { x[m.id] = next; return x })({})) }) },
              }))
          }),
        react.createElement('div', { className: 'dsh-ee-routeSettings' },
          react.createElement('label', { className: 'dsh-ee-field' },
            react.createElement('span', { className: 'dsh-ee-fieldLabel' }, '路由默认档位'),
            react.createElement('select', {
              className: 'dsh-ee-input dsh-ee-select',
              value: defaultDraft !== undefined ? (defaultDraft === null ? '__none__' : defaultDraft) : (p.reasoning || '__none__'),
              disabled: unionLevels.length === 0 && defaultDraft === undefined && p.reasoning === null,
              onChange: function (e) { setDefaultDraft(e.target.value === '__none__' ? null : e.target.value) },
            },
              react.createElement('option', { value: '__none__' }, '不设置（提供方默认）'),
              unionLevels.map(function (l) { return react.createElement('option', { value: l, key: l }, l) })),
            unionLevels.length === 0 && react.createElement('span', { className: 'dsh-ee-hint' }, '先为模型声明档位后才能设置路由默认档位')),
          isAnthropic && react.createElement('div', { className: 'dsh-ee-field' },
            react.createElement('span', { className: 'dsh-ee-fieldLabel' }, 'Anthropic token 预算（thinkingBudgets）'),
            react.createElement('select', {
              className: 'dsh-ee-input dsh-ee-select',
              value: budgetMode,
              onChange: function (e) {
                var mode = e.target.value
                setBudgetMode(mode)
                if (mode === 'set' && p.budgets !== null && p.budgets !== undefined) {
                  setBudgetValues({
                    minimal: String(p.budgets.minimal !== undefined ? p.budgets.minimal : ''),
                    low: String(p.budgets.low !== undefined ? p.budgets.low : ''),
                    medium: String(p.budgets.medium !== undefined ? p.budgets.medium : ''),
                    high: String(p.budgets.high !== undefined ? p.budgets.high : ''),
                  })
                }
              },
            },
              react.createElement('option', { value: 'keep' }, budgetSummary !== null ? '保留现状（' + budgetSummary + '）' : '不修改'),
              react.createElement('option', { value: 'set' }, '设置预算'),
              react.createElement('option', { value: 'clear' }, '清除预算')),
            budgetMode === 'set' && react.createElement('div', { className: 'dsh-ee-budgetRow' },
              ['minimal', 'low', 'medium', 'high'].map(function (k) {
                return react.createElement('label', { className: 'dsh-ee-budgetField', key: k },
                  react.createElement('span', { className: 'dsh-ee-fieldLabel' }, k),
                  react.createElement('input', {
                    className: 'dsh-ee-input dsh-ee-budgetInput' + (budgetValues[k] !== '' && (Number(budgetValues[k]) < 1 || !Number.isFinite(Number(budgetValues[k]))) ? ' dsh-ee-inputInvalid' : ''),
                    type: 'number',
                    min: '1',
                    value: budgetValues[k],
                    onChange: function (e) {
                      setBudgetValues(function (b) { return Object.assign({}, b, (function (x) { x[k] = e.target.value; return x })({})) })
                    },
                  }))
              })))),
        (issues.errors.length > 0 || issues.warnings.length > 0 || cardError !== null) && react.createElement('div', { className: 'dsh-ee-error' },
          issues.errors.map(function (msg, i) { return react.createElement('p', { key: 'e' + i }, msg) }),
          issues.warnings.map(function (msg, i) { return react.createElement('p', { key: 'w' + i, className: 'dsh-ee-warn' }, msg) }),
          cardError !== null && react.createElement('p', null, cardError)),
        react.createElement('div', { className: 'dsh-ee-actions' },
          react.createElement('button', { className: 'dsh-ee-primaryButton', disabled: !canSave, onClick: save },
            busy ? '保存中…' : '保存'),
          react.createElement('button', {
            className: 'dsh-ee-secondaryButton',
            disabled: busy,
            onClick: function () {
              setDrafts({})
              setOpenModels({})
              setDefaultDraft(undefined)
              setBudgetMode('keep')
              setCardError(null)
            },
          }, '撤销修改'))
      )
    }

    function ModelEditor(props) {
      var draft = props.draft || {}
      var errors = draftErrors(draft)
      var hasAny = Object.keys(draft).length > 0
      var hasThinking = false
      for (var i = 0; i < LEVELS.length; i++) {
        if (LEVELS[i] !== 'off' && draft[LEVELS[i]] !== undefined) { hasThinking = true; break }
      }
      return react.createElement('div', { className: 'dsh-ee-editor' },
        LEVELS.map(function (level) {
          var checked = draft[level] !== undefined
          var invalid = checked && level !== 'off' && (typeof draft[level] !== 'string' || draft[level].length === 0)
          return react.createElement('label', { className: 'dsh-ee-levelRow', key: level },
            react.createElement('input', {
              type: 'checkbox',
              checked: checked,
              onChange: function (e) {
                var next = Object.assign({}, draft)
                if (e.target.checked) next[level] = defaultWire(level)
                else delete next[level]
                props.onChange(next)
              },
            }),
            react.createElement('span', { className: 'dsh-ee-levelName' }, level),
            react.createElement('span', { className: 'dsh-ee-levelHint' }, LEVEL_HINTS[level]),
            react.createElement('input', {
              className: 'dsh-ee-input dsh-ee-wireInput' + (invalid ? ' dsh-ee-inputInvalid' : ''),
              type: 'text',
              placeholder: level === 'off' ? '留空 = 不发送参数' : 'wire 拼写',
              value: wireText(draft[level]),
              disabled: !checked,
              onChange: function (e) {
                var next = Object.assign({}, draft)
                next[level] = e.target.value === '' && level === 'off' ? null : e.target.value
                props.onChange(next)
              },
            }))
        }),
        !hasThinking && react.createElement('p', { className: 'dsh-ee-hint' },
          hasAny ? '仅剩 off：保存后将设为「无思考能力（reasoningEfforts: false）」。' : '未选择任何档位：保存后将保持「未声明」（不写入档位）。'),
        errors.length > 0 && react.createElement('div', { className: 'dsh-ee-error' },
          errors.map(function (msg, i) { return react.createElement('p', { key: i }, msg) }))
      )
    }

    // ---- 插件主体 ----

    var inject = ['slots', 'connection', 'remote']

    var CSS = '.dsh-ee-section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}' +
      '.dsh-ee-title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}' +
      '.dsh-ee-intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}' +
      '.dsh-ee-empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}' +
      '.dsh-ee-actionButton{box-sizing:border-box;height:32px;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);background:0 0;border-radius:16px;align-items:center;gap:4px;padding:0 12px;font-size:13px;line-height:20px;display:inline-flex}' +
      '.dsh-ee-actionButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}' +
      '.dsh-ee-actionButtonActive{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}' +
      '.dsh-ee-addArea{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:6px;padding:12px 14px;display:flex}' +
      '.dsh-ee-addRow{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;width:100%;font:inherit;cursor:pointer;background:0 0;color:var(--dsw-alias-label-primary);flex-direction:row;gap:8px;align-items:center;padding:8px 10px;font-size:13px;line-height:20px;display:flex}' +
      '.dsh-ee-addRow:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}' +
      '.dsh-ee-addRow:disabled{cursor:default;opacity:.7}' +
      '.dsh-ee-addName{font-weight:500}' +
      '.dsh-ee-tagOk{color:var(--dsw-alias-state-success-primary)}' +
      '.dsh-ee-routeCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;flex-direction:column;gap:12px;padding:12px 14px;display:flex}' +
      '.dsh-ee-routeHead{flex-direction:column;gap:4px;display:flex}' +
      '.dsh-ee-routeIdentity{align-items:center;gap:8px;min-width:0;display:flex;flex-wrap:wrap}' +
      '.dsh-ee-routeName{font-size:14px;font-weight:500;line-height:22px}' +
      '.dsh-ee-routeKey{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}' +
      '.dsh-ee-routeActions{align-items:center;gap:6px;margin-left:auto;display:inline-flex;flex-wrap:wrap}' +
      '.dsh-ee-tag{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}' +
      '.dsh-ee-routeMeta{flex-direction:row;gap:12px;flex-wrap:wrap;display:flex}' +
      '.dsh-ee-hint{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px;line-height:18px}' +
      '.dsh-ee-modelRow{flex-direction:column;gap:6px;display:flex}' +
      '.dsh-ee-modelLine{align-items:center;gap:8px;min-width:0;display:flex;flex-wrap:wrap}' +
      '.dsh-ee-modelName{font-size:13px;font-weight:500;line-height:20px}' +
      '.dsh-ee-modelId{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}' +
      '.dsh-ee-chips{flex-direction:row;gap:4px;flex-wrap:wrap;align-items:center;display:flex}' +
      '.dsh-ee-chip{border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;padding:1px 6px;font-size:11px;line-height:16px}' +
      '.dsh-ee-chipFalse{color:var(--dsw-alias-state-error-primary)}' +
      '.dsh-ee-chipNone{color:var(--dsw-alias-label-dimmed)}' +
      '.dsh-ee-editor{background:var(--dsw-alias-bg-module-platform);border-radius:8px;flex-direction:column;gap:6px;padding:10px 12px;display:flex}' +
      '.dsh-ee-levelRow{align-items:center;gap:8px;display:flex}' +
      '.dsh-ee-levelName{width:74px;flex:none;font-size:13px;font-weight:500;line-height:20px}' +
      '.dsh-ee-levelHint{color:var(--dsw-alias-label-tertiary);flex:auto;font-size:12px;line-height:18px}' +
      '.dsh-ee-input{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);height:32px;font:inherit;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:8px;padding:0 10px;font-size:13px;line-height:20px}' +
      '.dsh-ee-input:focus{border-color:var(--dsw-alias-brand-primary);outline:none}' +
      '.dsh-ee-input:disabled{opacity:.6;cursor:default}' +
      '.dsh-ee-inputInvalid{border-color:var(--dsw-alias-state-error-primary)}' +
      'select.dsh-ee-input{cursor:pointer;max-width:320px}' +
      '.dsh-ee-wireInput{width:160px;flex:none}' +
      '.dsh-ee-budgetRow{flex-direction:row;gap:10px;flex-wrap:wrap;display:flex}' +
      '.dsh-ee-budgetField{flex-direction:column;gap:4px;display:flex}' +
      '.dsh-ee-budgetInput{width:90px}' +
      '.dsh-ee-routeSettings{flex-direction:row;gap:20px;flex-wrap:wrap;display:flex}' +
      '.dsh-ee-field{flex-direction:column;gap:6px;display:flex}' +
      '.dsh-ee-fieldLabel{color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:500;line-height:18px}' +
      '.dsh-ee-error{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px}' +
      '.dsh-ee-error p{margin:2px 0}' +
      '.dsh-ee-warn{color:var(--dsw-alias-state-warn-label)}' +
      '.dsh-ee-banner{border-radius:8px;flex-direction:row;gap:10px;align-items:center;padding:8px 12px;font-size:13px;line-height:20px;display:flex}' +
      '.dsh-ee-bannerError{background:var(--dsw-alias-state-error-container);color:var(--dsw-alias-state-error-primary)}' +
      '.dsh-ee-bannerOk{background:var(--dsw-alias-state-success-container);color:var(--dsw-alias-state-success-primary)}' +
      '.dsh-ee-actions{flex-direction:row;gap:8px;justify-content:flex-end;display:flex}' +
      '.dsh-ee-footer{flex-direction:row;gap:12px;align-items:center;display:flex}' +
      '.dsh-ee-primaryButton{box-sizing:border-box;height:36px;font:inherit;cursor:pointer;border:none;border-radius:18px;padding:0 14px;font-size:14px;line-height:22px;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);display:inline-flex;align-items:center;gap:4px;justify-content:center}' +
      '.dsh-ee-primaryButton:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}' +
      '.dsh-ee-primaryButton:disabled{opacity:.4;cursor:default}' +
      '.dsh-ee-secondaryButton{box-sizing:border-box;height:36px;font:inherit;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);border-radius:18px;padding:0 14px;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:0 0;display:inline-flex;align-items:center;gap:4px;justify-content:center}' +
      '.dsh-ee-secondaryButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}' +
      '.dsh-ee-secondaryButton:disabled{opacity:.4;cursor:default}' +
      '.dsh-ee-dangerButton{box-sizing:border-box;height:28px;color:var(--dsw-alias-state-error-primary);font:inherit;cursor:pointer;background:0 0;border:1px solid var(--dsw-alias-border-l2);border-radius:14px;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}' +
      '.dsh-ee-dangerButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);border-color:var(--dsw-alias-state-error-primary)}' +
      '.dsh-ee-dangerButton:disabled{opacity:.4;cursor:default}' +
      '.dsh-ee-linkButton{box-sizing:border-box;height:28px;color:var(--dsw-alias-label-tertiary);font:inherit;cursor:pointer;background:0 0;border:none;border-radius:14px;align-items:center;padding:0 10px;font-size:12px;line-height:18px;display:inline-flex}' +
      '.dsh-ee-linkButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}' +
      '.dsh-ee-linkButton:disabled{opacity:.4;cursor:default}'

    function apply(ctx) {
      var slots = ctx.get('slots')
      if (slots === undefined) return
      var connection = ctx.get('connection')
      if (connection === undefined || connection.api === undefined) return
      var api = connection.api
      var remote = ctx.get('remote')

      // 注入样式（页面级一次性）。
      var styleEl = document.createElement('style')
      styleEl.setAttribute('data-dsh-effort-config', '')
      styleEl.textContent = CSS
      document.head.appendChild(styleEl)
      ctx.effect(function () {
        return function () {
          if (styleEl.parentNode !== null) styleEl.parentNode.removeChild(styleEl)
        }
      }, 'dsh-effort-config: styles')

      // 「添加提供商」模式：settings.action 按钮与设置页共享。
      var addingListeners = []
      var adding = false
      function setAdding(value) {
        adding = value
        for (var i = 0; i < addingListeners.length; i++) {
          try { addingListeners[i]() } catch (e) { /* noop */ }
        }
      }
      function useAdding() {
        var state0 = react.useState(adding)
        var value = state0[0]
        var setValue = state0[1]
        react.useEffect(function () {
          var fn = function () { setValue(adding) }
          addingListeners.push(fn)
          return function () {
            addingListeners = addingListeners.filter(function (f) { return f !== fn })
          }
        }, [])
        return [value, setAdding]
      }

      var AddProviderAction = function () {
        var pair = useAdding()
        var addingNow = pair[0]
        var setAddingNow = pair[1]
        return react.createElement('button', {
          className: 'dsh-ee-actionButton' + (addingNow ? ' dsh-ee-actionButtonActive' : ''),
          onClick: function () { setAddingNow(!addingNow) },
        }, addingNow ? '取消' : '添加提供商')
      }

      var Section = function (props) {
        var pair = useAdding()
        return react.createElement(EffortPage, {
          api: api,
          remote: remote,
          ctx: ctx,
          close: props.close,
          addingNow: pair[0],
          setOnAdding: pair[1],
        })
      }

      slots.inject('settings.section', function () {
        return slots.register(
          { name: 'settings.section', id: 'thinking-effort', order: 11, label: '思考努力度' },
          Section
        )
      })
      slots.inject('settings.action', function () {
        return slots.register(
          { name: 'settings.action', id: 'thinking-effort-add', order: 5, label: '添加提供商' },
          AddProviderAction
        )
      })
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})

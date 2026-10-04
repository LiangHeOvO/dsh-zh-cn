# dsh-zh-cn · 全局中文模式

安装一次，**所有会话、所有模型（默认模型与你手动添加的自定义模型）的思考过程和回复都会用简体中文显示**；除非你在插件管理器里主动卸载，否则新开对话、切换模型、重启 Harness 都依然生效。

## 安装

在 DeepSeek Harness 里打开**插件管理器** → 安装 bundle，粘贴仓库地址 `https://github.com/LiangHeOvO/dsh-zh-cn` 即可（DSH 的 `install_bundle` 原生支持 git 仓库 URL，也支持本机绝对路径）。装好即生效，**不需要任何配置**；要停用时在插件管理器里移除这个 bundle 就行，规则会随插件一起消失。

也可以先克隆再用绝对路径安装：

```bash
git clone https://github.com/LiangHeOvO/dsh-zh-cn.git
# 然后在插件管理器里填入克隆目录的绝对路径
```

> 前提：你的 profile 使用 `nodeLinker: hoisted`（DSH 默认 profile 就是），本插件无任何运行时依赖。

## 它做了什么

规则是分**三层**下发的，因为实测只在系统提示词开头放一段，仍会滑回英文——那段规则后面跟着上万 token 的英文工具文档，而模型生成时离它已经很远：

| 层 | 注入点 | 位置 | 作用 |
|---|---|---|---|
| 1 主段 | `systemPrompt.section` | `order: -900`，紧跟 harness 身份 | 立场声明，提示词最前端的完整规则 |
| 2 收尾段 | `systemPrompt.section` | `order: 10500`，在部署 persona 后缀（10200）之后 | 系统提示词的**最后一个字**，模型生成前最新鲜的一句 |
| 3 每步快照 | `systemPrompt.context` | `order: 130`，排在 sandbox/approval/delegation 之后 | 作为带来源的 user 快照进入历史**末尾**，紧贴本次生成 |

第 3 层不会撑爆 token：快照由 `RuntimeContextProjection` 投影，**内容没变就不产生新消息**，恒定规则只占一条，不随步数堆积。

三层都在 `apply()` 里注册到插件自己的 fiber 上，Cordis 在卸载时自动撤销——"卸载即失效"因此天然成立，不需要清理代码。

规则内容概括：

1. **思考过程**从第一个字起就用简体中文，不中英混写，也不因话题/代码/工具输出是英文就切换；
2. **正式回复**（正文、计划、进度说明、工具说明、总结、提问、标题）一律简体中文，即使用户用英文提问也用中文回答；
3. **代码、命令、路径、报错原文、API 与专有名词**保持原样，只用中文解释；
4. 主段结尾附一句英文，兜底英文优先的模型。

> **措辞上的讲究**：三层都写成"既定前提"（像环境事实），而不是"编号规则 + 最高优先级 + 禁止/必须"。后者会让模型在思考开头复述一遍规则，用户看到的思考过程就变成"好的，我需要用中文……"这类自证，非常突兀。所以每层还明确写了不要提及它，`selftest.mjs` 里有断言把这类措辞挡住，防止以后改回去。

因为规则是随系统提示词发给模型的，所以它对**默认模型和自定义模型一视同仁**——语言规则在模型路由之前就已经拼进提示词，不依赖任何具体厂商接口。

## 文件

| 文件 | 作用 |
|---|---|
| `index.js` | Host 插件本体：`apply(ctx, config)` 注册三层规则 |
| `cordis.patch.yml` | bundle 补丁：把 `zh-cn` 这一行插入 profile |
| `package.json` | 声明 `dsh.bundle.patch`，使本包成为一个 bundle |
| `locale/zh.json` `locale/en.json` | 插件管理器里显示的标题与描述 |
| `icon.svg` | 插件图标 |
| `selftest.mjs` | 离线自测：`node selftest.mjs` 跑 6 组断言，不需要 Harness |

## 可选配置

行为默认全开，无需任何配置。如需调整，在 profile 的 `cordis.patch.yml` 里给 `zh-cn` 这一行加 `config`：

```yaml
- id: zh-cn
  name: 'dsh-zh-cn'
  config:
    enabled: true      # 改成 false 即临时停用（不等于卸载）
    order: -900        # 主段在系统提示词中的位置，越小越靠前
    tail: true         # 第 2 层：系统提示词收尾段，false 关闭
    snapshot: true     # 第 3 层：历史末尾的每步快照，false 关闭
    extra: "讨论代码时可以保留英文术语。"   # 追加到主段末尾
    text: "……"         # 完全替换主段正文（写了自己的正文后默认正文不再使用，extra 仍会追加在后面）
```

> 关掉 `snapshot` 会让 UI 里那条运行时上下文快照少一段；第 1、2 层不受影响。

## 修改代码后必须重启

profile 的 HMR 条目是 `root: []`，按 `dsh-hmr` 的含义是"仅保留配置监听、不监听模块源码"——**所以改动 `index.js` 不会热重载**，必须重启 DeepSeek Harness 才会加载新模块。重新 `install_bundle` 会返回 `ambiguous-install`（包已装好，`changed:false`），那不是故障。

## 卸载

插件管理器 → 找到「全局中文模式 / Always Chinese」→ 移除。段是由插件上下文注册的 Cordis effect，卸载即自动撤销，不会残留。

## 注意

- 本插件**改写的是模型收到的指令**，不是渲染层：模型偶尔仍可能漏用中文，出现这种情况时回复一句"用中文"即可；它无法把模型已经生成的英文推理改写成中文。三层是为了把这种概率压到最低，但"0% 英文"由模型遵循度决定，不是代码能硬保证的。
- 每次请求会多出这三层规则的 token（主段约 300 字，收尾段约 50 字，快照约 60 字），属于固定开销。

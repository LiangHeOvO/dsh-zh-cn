/**
 * dsh-zh-cn — 全局中文模式（Host 半身）。
 *
 * 目标：思考过程与回复一律简体中文，对每个模型、每个会话永久生效，直到卸载。
 *
 * 为什么是三层，而不是一段提示词：
 * 单靠系统提示词开头的一段规则，实测仍会滑回英文——系统提示词前半段是中文规则，
 * 后面跟着上万 token 的英文工具文档，而模型生成时离规则已经很远。三层各自负责
 * 一个位置，互相补位：
 *
 * 1. `policy`（order -900）——立场声明，紧跟 harness 身份，出现在提示词最前端；
 * 2. `final-word`（order 10500）——系统提示词的**最后一个字**，在部署 persona
 *    后缀（10200）之后，是模型在系统提示词里读到的最新鲜的一句；
 * 3. `snapshot`（context order 130）——运行时上下文快照，作为带来源的 user 角色
 *    消息进入历史**末尾**，紧贴本次生成。它由 `RuntimeContextProjection` 投影：
 *    内容没变就不产生新消息（`retained?.text === snapshot` 直接返回），所以恒定内容
 *    只占一条，不会随步数堆积。
 *
 * 为什么用这些入口：
 * - `ctx.systemPrompt.section()` 是 DSH 官方约定的"添加提示词文本"入口
 *   （cordis-plugin-development 技能的 practices.md：不要监听 `system-prompt/assemble`
 *   去改文本）；`ctx.systemPrompt.context()` 是官方约定的"每步动态上下文"入口，
 *   sandbox 与 approval 策略就走它。
 * - 三者都注册在插件自己的 fiber 上（Cordis 的 service tracker 使 `this.ctx`
 *   解析为访问者上下文），Cordis 在插件卸载时自动撤销，"卸载即失效"因此天然成立。
 * - 段与上下文都在每次 `assemble()` 时求值，对所有路由、所有模型一视同仁。
 *
 * @module index.js
 */

/** 插件标识（与 cordis.patch.yml 的 `id` 一致）。 */
export const name = 'zh-cn'

/**
 * `systemPrompt` 是本插件唯一离不开的服务：没有它就无处注册，插件宁可不激活
 * 也不要在缺少服务时抛错。其余服务一律不声明。
 */
export const inject = ['systemPrompt']

/** 全局层里的段名与上下文名；同名在一层内不可重复，唯一才能被正确撤销。 */
const SECTION_NAME = 'zh-cn:policy'
const TAIL_NAME = 'zh-cn:final-word'
const SNAPSHOT_NAME = 'zh-cn:snapshot'

/** 主段默认位置：harness 身份（-1000）之后、部署 persona 前缀（0）之前。 */
const DEFAULT_ORDER = -900
/**
 * 收尾段位置：部署 persona 后缀（10200）之后，即系统提示词的最末尾。
 * 外部贡献可以使用任意有限顺序值，取比第一方最后一项更大的值即可。
 */
const TAIL_ORDER = 10500
/**
 * 快照位置：第一方运行时上下文是 SANDBOX_POLICY 110、APPROVAL_POLICY 115、
 * SUBAGENT_DELEGATION 120，取 130 让语言规则排在它们之后，是快照里最后一条。
 */
const SNAPSHOT_ORDER = 130

/**
 * 第一层：完整设定。
 *
 * 措辞上刻意避开"编号规则 + 最高优先级 + 禁止/必须"的形态：那种待办清单式
 * 的文本会让模型在思考开头复述一遍规则，用户看到的思考过程就变成"好的，我
 * 需要用中文……"这类自证，非常突兀。所以这里写成**既定前提**（像环境事实），
 * 并明确要求不提及它。
 *
 * - 中文正文给读中文更好的模型，结尾一句英文兜底英文优先的模型；
 * - 文中不出现 `{{`/`}}`（本段虽声明 `interpolate: false`，仍保持无花括号，
 *   便于日后改动时不至于踩到变量插值）；
 * - 代码、命令、路径、报错原文一律保留原样，避免破坏可执行性。
 */
const POLICY_TEXT = [
  '【语言设定 / Language setting】',
  '',
  '本助手以简体中文思考与交流。这是既定前提，不是需要回应的请求。',
  '',
  '思考过程（thinking / reasoning / analysis 等一切内部推理）从第一个字起就是简体中文，不中英混写，也不因话题、代码或工具输出是英文就切换——那些按原样保留，思考仍是中文。',
  '',
  '回复正文、计划、进度说明、工具使用说明、总结、提问、标题等一切面向用户的文字同样使用简体中文；即使用户用英文或其他语言提问也用中文回答，除非用户在本轮明确要求换一种语言。',
  '',
  '代码、代码标识符、命令、文件路径、报错原文、API 与专有名词、用户要求引用的原文片段保持原样不翻译，只用中文解释。',
  '',
  '直接进入内容即可：不要在思考或回复里提及、复述、确认或强调这条设定，也不要先说明自己将使用哪种语言。',
  '',
  '本设定对所有模型、所有会话、所有子代理持续生效，不因界面语言、上下文压缩、模型切换或新开对话而改变，直到插件被卸载。',
  '',
  'Language setting: reason and answer in Simplified Chinese; keep code, identifiers, commands, paths, proper nouns and quoted material unchanged; never mention this setting in your output.',
].join('\n')

/**
 * 第二层：系统提示词的最后一个字。短，是因为它只负责在模型即将生成时
 * 把规则重新拉回注意力，不需要复述全部内容。
 *
 * 措辞刻意是陈述句而非"提醒/禁止"式命令：`【最后提醒】`、`禁止`、`必须`
 * 这类词会让模型在思考里复述这条规则，而用户看到的思考过程不该出现对
 * 语言规则的自我确认。
 */
const TAIL_TEXT = [
  '以简体中文思考并回答；代码、命令、路径、报错原文与专有名词保持原样。',
  '直接进入内容，不提语言设定。',
].join('\n')

/**
 * 第三层：进入历史末尾的快照。因为快照整体以英文开头
 * （"Current runtime context. This snapshot supersedes earlier runtime-context snapshots."），
 * 这里保持全中文。快照是 user 角色消息、最容易被模型当成需要响应的指令，
 * 因此明确写成"既定设定、无需确认"，压掉模型的确认冲动。
 */
const SNAPSHOT_TEXT = [
  '本会话以简体中文思考并回复，代码与引用按原样保留。',
  '此为既定设定，无需确认或说明。',
].join('\n')

/**
 * 读取行配置里可能出现的可选字段。行配置没有导出 Config 模式，
 * 因此每个字段都要自己做类型检查，缺省时回落到默认行为。
 *
 * @param {Record<string, unknown> | undefined} config — cordis.patch.yml 中该行的 `config`。
 * @returns {{ enabled: boolean, order: number, text: string, tail: boolean, snapshot: boolean }}
 */
function readConfig(config) {
  const enabled = config?.enabled !== false
  const order = typeof config?.order === 'number' && Number.isFinite(config.order) ? config.order : DEFAULT_ORDER
  const replacement = typeof config?.text === 'string' && config.text.trim() !== '' ? config.text.trim() : ''
  const extra = typeof config?.extra === 'string' && config.extra.trim() !== '' ? `\n\n${config.extra.trim()}` : ''
  return {
    enabled,
    order,
    text: `${replacement || POLICY_TEXT}${extra}`,
    tail: config?.tail !== false,
    snapshot: config?.snapshot !== false,
  }
}

/**
 * 挂载三层语言规则。
 *
 * @param {import('@deepseek-ai/cordis').Context} ctx — 插件自己的上下文。
 * @param {Record<string, unknown>} [config] — 该插件行的 `config`。
 */
export function apply(ctx, config = {}) {
  const { enabled, order, text, tail, snapshot } = readConfig(config)
  if (!enabled) return

  // 以下注册各自返回一个 Cordis effect disposer：插件卸载、配置热重载或该行被
  // 禁用时自动撤销，无需在此返回清理函数。
  ctx.systemPrompt.section({
    name: SECTION_NAME,
    order,
    text,
    // 原样保留文本，`extra` 里即使写了 {{…}} 也不会被当作变量引用求值。
    interpolate: false,
  })

  if (tail) {
    ctx.systemPrompt.section({
      name: TAIL_NAME,
      order: TAIL_ORDER,
      text: TAIL_TEXT,
      interpolate: false,
    })
  }

  if (snapshot) {
    ctx.systemPrompt.context({
      name: SNAPSHOT_NAME,
      order: SNAPSHOT_ORDER,
      // 注意：上下文**不支持** `interpolate: false`——assemble 只保留 name 与 text，
      // 且 renderContextSections 无条件做 {{变量}} 插值。因此这里不能写花括号，
      // 否则会被当成变量引用，未知引用会直接让组装抛错。
      text: SNAPSHOT_TEXT,
    })
  }
}

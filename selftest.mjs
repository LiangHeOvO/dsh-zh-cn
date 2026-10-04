// 一次性校验：跑一遍 apply()，断言三层注册结果与文本安全。
import assert from 'node:assert/strict'
import { apply } from './index.js'

function run(config) {
  const sections = []
  const contexts = []
  apply({
    systemPrompt: {
      section: (s) => (sections.push(s), () => {}),
      context: (c) => (contexts.push(c), () => {}),
    },
  }, config)
  return { sections, contexts }
}

// 1. 默认配置：三层齐全
const def = run({})
assert.equal(def.sections.length, 2, '应注册 2 个 section')
assert.equal(def.contexts.length, 1, '应注册 1 个 context')
assert.equal(def.sections[0].name, 'zh-cn:policy')
assert.equal(def.sections[0].order, -900)
assert.equal(def.sections[1].name, 'zh-cn:final-word')
assert.equal(def.sections[1].order, 10500)
assert.equal(def.contexts[0].name, 'zh-cn:snapshot')
assert.equal(def.contexts[0].order, 130)

// 2. 文本不能含未闭合/成对花括号（context 永远插值，花括号会抛错）
for (const item of [...def.sections, ...def.contexts]) {
  assert.ok(!item.text.includes('{{'), `${item.name} 不得含 {{`)
  assert.ok(!item.text.includes('}}'), `${item.name} 不得含 }}`)
  assert.ok(item.text.trim().length > 0, `${item.name} 文本不能为空`)
}

// 2b. 文案不得诱发模型在思考里复述语言规则：用户反馈过"AI 特意强调自己要用
//     中文回答"很突兀，元凶就是编号+强制+提醒这类待办清单式措辞。
for (const item of [...def.sections, ...def.contexts]) {
  for (const bad of ['禁止', '必须', '强制', '最高优先级', '【最后提醒】', '硬性']) {
    assert.ok(!item.text.includes(bad), `${item.name} 含诱发复述的措辞「${bad}」——改回"既定前提"式写法`)
  }
}
// 必须有明确的"不提及"指令，否则模型仍会自我确认
assert.ok(
  def.sections[0].text.includes('不要在思考或回复里提及'),
  '主段需明确禁止提及语言设定',
)
assert.ok(def.contexts[0].text.includes('无需确认'), '快照需写明无需确认')

// 3. 主段与收尾段声明了不插值；context 不接受该字段
assert.equal(def.sections[0].interpolate, false)
assert.equal(def.sections[1].interpolate, false)
assert.equal('interpolate' in def.contexts[0], false)

// 4. 关闭开关
assert.deepEqual(run({ enabled: false }), { sections: [], contexts: [] })
assert.equal(run({ tail: false }).sections.length, 1)
assert.equal(run({ snapshot: false }).contexts.length, 0)

// 5. 自定义 order / text / extra
const custom = run({ order: -1000, text: '自定义正文', extra: '补充一句' })
assert.equal(custom.sections[0].order, -1000)
assert.equal(custom.sections[0].text, '自定义正文\n\n补充一句')

// 6. 非法 order 回落默认（避免 section() 抛 TypeError 导致 fiber 失败）
assert.equal(run({ order: NaN }).sections[0].order, -900)

console.log('全部断言通过')

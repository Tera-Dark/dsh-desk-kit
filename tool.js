/**
 * 工具定义器(本地兜底)。
 *
 * 为什么需要它:插件若以 junction / 符号链接方式挂进 profile,Node 会把模块
 * realpath 解析到链接目标(如 E:\DSH\plugins\...),于是从那里向上找不到
 * profile 的 node_modules,裸导入 '@deepseek-ai/dsh-tools' 直接
 * ERR_MODULE_NOT_FOUND,整个宿主半侧加载失败(实测踩过)。
 *
 * 策略:优先用宿主提供的 defineTool(参数校验、schema 编译都由官方实现);
 * 导入失败时退回本文件的最小实现,只编译本插件用到的那部分参数写法。
 */
export function convertValueSchema(spec) {
  if (!spec || typeof spec !== 'object') return {}
  const { required, ...rest } = spec
  const type = rest.type
  if (type === 'json' || type === undefined) {
    // 宿主把 author 的 json 节点编译成"纯注解 schema",等价于任意值
    const annotations = {}
    if (typeof rest.description === 'string') annotations.description = rest.description
    return annotations
  }
  if (type === 'array') return { type: 'array', ...(rest.description ? { description: rest.description } : {}), items: convertValueSchema(rest.items) }
  if (type === 'object') {
    const properties = {}
    const req = []
    for (const [k, v] of Object.entries(rest.properties || {})) {
      if (v && v.required) req.push(k)
      properties[k] = convertValueSchema(v)
    }
    return {
      type: 'object',
      ...(rest.description ? { description: rest.description } : {}),
      properties,
      ...(req.length ? { required: req } : {}),
      ...(rest.additionalProperties === false ? { additionalProperties: false } : {}),
    }
  }
  const out = { type }
  if (typeof rest.description === 'string') out.description = rest.description
  if (Array.isArray(rest.enum)) out.enum = rest.enum
  if (Object.hasOwn(rest, 'const')) out.const = rest.const
  return out
}

/** 把 author 的属性表参数编译成 raw JSON Schema(与宿主同口径)。 */
export function convertParameters(spec) {
  const properties = {}
  const required = []
  for (const [key, value] of Object.entries(spec || {})) {
    if (value && value.required) required.push(key)
    properties[key] = convertValueSchema(value)
  }
  return { type: 'object', properties, ...(required.length ? { required } : {}) }
}

/** defineTool 的最小兼容实现(仅在本机导入官方包失败时兜底)。 */
export function localDefineTool(options) {
  const parameters = convertParameters(options.parameters)
  const outputSchema = convertValueSchema(options.output && options.output.schema)
  const render = (options.output && options.output.render) || ((_a, v) => [{ type: 'text', text: String(v) }])
  return {
    name: options.name,
    description: options.description,
    parameters,
    output: { schema: outputSchema, render },
    async execute(args, exec) {
      return options.execute(args || {}, exec)
    },
  }
}

// JSON-Schema → tool-parameter tree. Pure: turns a tool's `parameters` schema
// into the nested rows ToolsDetail renders (arrays/objects recursed). Split
// out of models.ts (which is otherwise just types) so it can be tested.

export interface ToolParam {
  name: string
  type: string
  description: string
  required: boolean
  enumValues?: string[] | null
  children: ToolParam[]
  defaultValue?: string | null
}

/** Parse a JSON-Schema object into a flat list of leaf params (recursed for
 *  object properties and array item objects). */
export function parseToolParams(
  schema?: Record<string, unknown> | null,
): ToolParam[] {
  if (!schema) return []
  const properties = schema['properties']
  if (!properties || typeof properties !== 'object') return []
  const requiredList = new Set(
    Array.isArray(schema['required']) ? schema['required'].map(String) : [],
  )
  const out: ToolParam[] = []
  for (const [key, value] of Object.entries(
    properties as Record<string, unknown>,
  )) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const type = (v['type'] as string) || 'object'
    const children: ToolParam[] = []
    const items = v['items']
    if (items && typeof items === 'object') {
      const im = items as Record<string, unknown>
      if (im['type'] === 'array' || (im['properties'] as object | undefined)) {
        children.push(
          ...parseToolParams({
            type: 'object',
            properties: im['properties'],
            required: im['required'],
          }),
        )
      }
    } else if (type === 'object' && v['properties']) {
      children.push(...parseToolParams(v))
    }
    out.push({
      name: key,
      type,
      description: (v['description'] as string) || '',
      required: requiredList.has(key),
      enumValues: Array.isArray(v['enum']) ? v['enum'].map(String) : null,
      defaultValue: v['default'] == null ? null : String(v['default']),
      children,
    })
  }
  return out
}

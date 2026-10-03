#!/usr/bin/env node
// Parses every tracked JSON file and validates .claude-plugin/quick-menu.json against
// schema/quick-menu.schema.json. Dependency-free: it implements only the keywords the schema uses
// (type, const, required, properties, items, minLength, maxLength, maxItems, pattern).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '*.json'], { encoding: 'utf8' }).split('\n').filter(Boolean)
const errors = []
const docs = new Map()

for (const file of files) {
  try {
    docs.set(file, JSON.parse(readFileSync(file, 'utf8')))
  } catch (e) {
    errors.push(`${file}: ${e.message}`)
  }
}

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v)

function validate(value, schema, path, out) {
  if ('const' in schema && value !== schema.const) out.push(`${path}: must be ${JSON.stringify(schema.const)}`)
  if (schema.type && typeOf(value) !== schema.type) {
    out.push(`${path}: must be ${schema.type}`)
    return
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) out.push(`${path}: shorter than ${schema.minLength}`)
    if (schema.maxLength !== undefined && value.length > schema.maxLength) out.push(`${path}: longer than ${schema.maxLength}`)
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) out.push(`${path}: does not match ${schema.pattern}`)
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) out.push(`${path}: missing "${key}"`)
    for (const [key, sub] of Object.entries(schema.properties ?? {})) if (key in value) validate(value[key], sub, `${path}/${key}`, out)
  }
  if (Array.isArray(value) && schema.maxItems !== undefined && value.length > schema.maxItems) out.push(`${path}: more than ${schema.maxItems} items`)
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => validate(item, schema.items, `${path}/${i}`, out))
}

const schema = docs.get('schema/quick-menu.schema.json')
const menu = docs.get('.claude-plugin/quick-menu.json')
if (!schema || !menu) errors.push('schema/quick-menu.schema.json or .claude-plugin/quick-menu.json is missing or invalid')
else validate(menu, schema, '.claude-plugin/quick-menu.json', errors)

if (errors.length) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`check-json: ${files.length} JSON files parsed, quick-menu.json valid`)

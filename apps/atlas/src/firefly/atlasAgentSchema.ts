const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

export function validateAgentSchema(schema: unknown, value: unknown): boolean {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return false;
  const rule = schema as Record<string, unknown>;
  if (Array.isArray(rule.enum) && !rule.enum.some((candidate) => same(candidate, value))) return false;
  if (Array.isArray(rule.anyOf) && !rule.anyOf.some((candidate) => validateAgentSchema(candidate, value))) return false;
  if (Array.isArray(rule.oneOf) && rule.oneOf.filter((candidate) => validateAgentSchema(candidate, value)).length !== 1) return false;
  if (rule.not && validateAgentSchema(rule.not, value)) return false;
  const types = Array.isArray(rule.type) ? rule.type : rule.type ? [rule.type] : [];
  if (types.length) {
    const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
    if (!types.some((expected) => expected === actual || (expected === 'number' && typeof value === 'number'))) return false;
  }
  if (typeof value === 'string' && ((typeof rule.minLength === 'number' && value.length < rule.minLength) || (typeof rule.maxLength === 'number' && value.length > rule.maxLength))) return false;
  if (typeof value === 'number' && (!Number.isFinite(value) || (typeof rule.minimum === 'number' && value < rule.minimum) || (typeof rule.maximum === 'number' && value > rule.maximum))) return false;
  if (Array.isArray(value)) {
    if ((typeof rule.minItems === 'number' && value.length < rule.minItems) || (typeof rule.maxItems === 'number' && value.length > rule.maxItems)) return false;
    if (rule.uniqueItems === true && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) return false;
    if (rule.items && !value.every((item) => validateAgentSchema(rule.items, item))) return false;
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
    const object = value as Record<string, unknown>; const properties = rule.properties && typeof rule.properties === 'object' ? rule.properties as Record<string, unknown> : {};
    if (Array.isArray(rule.required) && rule.required.some((name) => typeof name === 'string' && !(name in object))) return false;
    if (rule.additionalProperties === false && Object.keys(object).some((name) => !(name in properties))) return false;
    if (Object.entries(object).some(([name, child]) => name in properties && !validateAgentSchema(properties[name], child))) return false;
  }
  return true;
}

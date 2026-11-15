// Keep names readable while giving case/spacing variants one shared identity.
export function normalizeToolName(name) {
  return String(name || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
export function toolDocumentId(name) {
  const key = normalizeToolName(name);
  if (!key) throw new Error('Enter a tool name.');
  const id = `tool_${encodeURIComponent(key)}`;
  if (new TextEncoder().encode(id).length > 1400) throw new Error('Tool name is too long.');
  return id;
}

export function expertiseKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('en');
}

export function normalizeExpertiseAreas(input, { limit = Number.POSITIVE_INFINITY } = {}) {
  const values = Array.isArray(input) ? input : String(input || '').split(/[\n,]/);
  const seen = new Set();
  const result = [];

  for (const raw of values) {
    const label = String(raw || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
    const key = expertiseKey(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
    if (result.length >= limit) break;
  }

  return result;
}

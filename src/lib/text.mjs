export function sanitizeName(value) {
  return (
    String(value || 'task')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'task'
  );
}

export function summarizePrompt(prompt, maxLength = 180) {
  const normalized = String(prompt || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}\u2026`;
}

export function shortenText(text, maxLength = 280) {
  const normalized = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}\u2026`;
}

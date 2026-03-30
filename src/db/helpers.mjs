export function json(value) {
  return value == null ? null : JSON.stringify(value);
}

export function parseJson(value) {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

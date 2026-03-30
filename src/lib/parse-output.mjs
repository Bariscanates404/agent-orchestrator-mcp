import { shortenText } from './text.mjs';

export function parseClaudeResult(lines) {
  const lastLine = [...lines].reverse().find(Boolean);
  if (!lastLine) {
    return null;
  }
  try {
    const payload = JSON.parse(lastLine);
    return payload.result || null;
  } catch {
    return null;
  }
}

export function parseCodexResult(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    try {
      const payload = JSON.parse(line);
      if (payload?.type === 'item.completed' && payload.item?.type === 'agent_message') {
        return payload.item.text || null;
      }
    } catch {
      // ignore non-JSON lines
    }
  }
  return null;
}

export function parseJsonFromWorkerOutput(text) {
  if (!text || typeof text !== 'string') {
    throw new Error('Worker returned empty or non-string output');
  }

  const trimmed = text.trim();

  // Strategy 1: direct parse
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {
    // fallthrough
  }

  // Strategy 2: extract from markdown fence
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // fallthrough
    }
  }

  // Strategy 3: bracket scan — find outermost [ ] or { }
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ]) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1));
        if (parsed && typeof parsed === 'object') {
          return parsed;
        }
      } catch {
        // fallthrough
      }
    }
  }

  throw new Error(`Failed to extract JSON from worker output (length=${trimmed.length}): ${shortenText(trimmed, 300)}`);
}

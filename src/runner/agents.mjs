export function buildClaudeArgs(task, cwd) {
  const args = ['-p', '--output-format', 'json', '--permission-mode', 'bypassPermissions', '--add-dir', task.repoRoot];
  if (task.model) {
    args.push('--model', task.model);
  }
  if (task.effort && ['low', 'medium', 'high'].includes(task.effort)) {
    args.push('--effort', task.effort);
  }
  if (task.systemPrompt) {
    args.push('--append-system-prompt', task.systemPrompt);
  }
  if (Array.isArray(task.additionalArgs) && task.additionalArgs.length > 0) {
    args.push(...task.additionalArgs);
  }
  args.push('--', task.prompt);
  return { command: 'claude', args, cwd };
}

export function buildCodexArgs(task, cwd) {
  const args = ['exec', '--json', '--cd', cwd, '--dangerously-bypass-approvals-and-sandbox'];
  if (task.model) {
    args.push('--model', task.model);
  }
  if (task.effort) {
    args.push('--config', `model_reasoning_effort="${task.effort}"`);
  }
  if (task.profile) {
    args.push('--profile', task.profile);
  }
  if (Array.isArray(task.additionalArgs) && task.additionalArgs.length > 0) {
    args.push(...task.additionalArgs);
  }
  args.push(task.prompt);
  return { command: 'codex', args, cwd };
}

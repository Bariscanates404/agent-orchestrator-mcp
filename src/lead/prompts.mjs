import { shortenText } from '../lib/index.mjs';

export function composePlannerPrompt(run, rulesText) {
  const rulesBlock = rulesText
    ? `Project rules (from CLAUDE.md):\n${rulesText}\nYou MUST follow these rules.`
    : 'No external rules were injected.';

  return [
    'You are a planning agent. Break the following objective into concrete subtasks.',
    '',
    `Objective: ${run.objective}`,
    '',
    rulesBlock,
    '',
    'Return ONLY a JSON array of subtask objects. Each object must have:',
    '- "label": short descriptive name (kebab-case)',
    '- "instruction": detailed instruction for a worker agent',
    '',
    'Example:',
    '[{"label": "fix-auth-bug", "instruction": "Find and fix the authentication timeout in login.mjs..."}]',
    '',
    'Requirements:',
    '- Keep subtasks independent and parallelizable where possible.',
    '- Each subtask should be completable by a single worker session.',
    '- Return between 1 and 12 subtasks.',
    '- Return ONLY the JSON array, no markdown fences, no commentary.',
  ].join('\n');
}

export function composeEvaluatorPrompt(run, items, rulesText) {
  const rulesBlock = rulesText ? `Project rules (from CLAUDE.md):\n${rulesText}` : 'No external rules were injected.';

  const itemSummaries = items
    .map((item) => {
      const result = item.resultText ? shortenText(item.resultText, 800) : '(no result captured)';
      const error = item.error || 'none';
      return [
        `--- Subtask ${item.taskIndex + 1}: ${item.label || 'unlabeled'} ---`,
        `Status: ${item.status}`,
        `Round: ${item.round}`,
        `Error: ${error}`,
        `Result: ${result}`,
      ].join('\n');
    })
    .join('\n\n');

  return [
    'You are an evaluation agent. Assess whether the objective has been achieved.',
    '',
    `Objective: ${run.objective}`,
    '',
    rulesBlock,
    '',
    'Subtask results:',
    itemSummaries,
    '',
    'Return ONLY a JSON object with:',
    '- "verdict": "pass" | "retry" | "fail"',
    '- "reason": brief explanation of your verdict',
    '- "followUpTasks": (only if verdict is "retry") array of new subtask objects [{label, instruction}]',
    '',
    'Verdict guidelines:',
    '- "pass": All subtasks completed successfully and the objective is met.',
    '- "retry": Some subtasks need rework or follow-up tasks are needed. Include followUpTasks.',
    '- "fail": The objective cannot be met with the current approach.',
    '',
    'Return ONLY the JSON object, no markdown fences, no commentary.',
  ].join('\n');
}

export function composeWorkerPrompt({ run, item, rulesText, round, previousOutcome }) {
  const retryNote = previousOutcome
    ? [
        'Previous attempt did not pass completion criteria.',
        `Previous status: ${previousOutcome.status}`,
        previousOutcome.error ? `Previous error: ${previousOutcome.error}` : 'Previous error: none captured',
        previousOutcome.resultText
          ? `Previous result excerpt: ${shortenText(previousOutcome.resultText, 1200)}`
          : 'Previous result excerpt: none',
        'Fix issues and produce a stronger final outcome.',
      ].join('\n')
    : '';

  const rulesBlock = rulesText
    ? [
        'Mandatory project rules (from CLAUDE.md):',
        rulesText,
        'You MUST follow these rules while executing this subtask.',
      ].join('\n\n')
    : 'No external CLAUDE.md rules were injected for this run.';

  return [
    `Lead run label: ${run.label}`,
    `Lead objective: ${run.objective}`,
    `Subtask ${item.taskIndex + 1}: ${item.instruction}`,
    `Attempt round: ${round}/${run.maxRounds}`,
    '',
    rulesBlock,
    '',
    retryNote,
    '',
    'Execution requirements:',
    '- Keep scope limited to this subtask.',
    '- Run relevant checks/tests when code is changed.',
    '- End with a concise result summary and residual risks.',
  ]
    .filter(Boolean)
    .join('\n');
}

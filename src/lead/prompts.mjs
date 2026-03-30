import { getWorkspaceSummary, shortenText } from '../lib/index.mjs';

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
    'IMPORTANT: Each subtask instruction you write MUST include:',
    '1. A clear, specific task description',
    '2. Which files/modules to focus on',
    '3. Which files/modules NOT to touch',
    '4. A reminder to read CLAUDE.md before starting',
    '5. Expected output/verification criteria',
    '',
    'Return ONLY a JSON array of subtask objects. Each object must have:',
    '- "label": short descriptive name (kebab-case)',
    '- "instruction": detailed instruction for a worker agent (include scope, files, constraints)',
    '',
    'Example:',
    '[{"label": "fix-auth-bug", "instruction": "Read CLAUDE.md first. Fix the authentication timeout in src/auth/login.mjs. Only modify files in src/auth/. Do NOT touch src/api/ or tests/. Run npm test after fixing. Expected: login timeout set to 30s instead of 5s."}]',
    '',
    'Requirements:',
    '- Keep subtasks independent and parallelizable where possible.',
    '- Each subtask should be completable by a single worker session.',
    '- Return between 1 and 12 subtasks.',
    '- Return ONLY the JSON array, no markdown fences, no commentary.',
  ].join('\n');
}

export async function composeEvaluatorPrompt(run, items, rulesText, wsPath) {
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

  let workspaceBlock = '';
  if (wsPath) {
    const wsSummary = await getWorkspaceSummary(wsPath, 3000);
    if (wsSummary) {
      workspaceBlock = `Shared workspace summary (inter-agent outputs):\n${wsSummary}`;
    }
  }

  return [
    'You are an evaluation agent. Assess whether the objective has been achieved.',
    '',
    `Objective: ${run.objective}`,
    '',
    rulesBlock,
    '',
    workspaceBlock,
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

export function composeWorkerPrompt({ run, item, rulesText, round, previousOutcome, wsPath }) {
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

  const wsNote = wsPath
    ? `Shared workspace: ${wsPath}\nYou may read this JSON file to see outputs from other agents in this run.`
    : '';

  // Mission briefing — always prepended so workers never lose context after compaction
  const missionBriefing = [
    '=== ZORUNLU BRIFING (her zaman gecerli, context sıkıştırılsa bile) ===',
    `Proje: ${run.label}`,
    `Genel hedef: ${run.objective}`,
    `Senin gorevin: Subtask #${item.taskIndex + 1} — ${shortenText(item.instruction, 200)}`,
    `Round: ${round}/${run.maxRounds}`,
    '',
    'KRITIK KURALLAR:',
    '1. CLAUDE.md dosyasini oku ve kurallarina uy. Her round basinda tekrar oku.',
    '2. Sadece sana verilen subtask kapsaminda calis. Diger dosyalara/modullere dokunma.',
    '3. Degisiklik yaptiginda test calistir. Test kirilirsa fixle.',
    '4. Isini bitirdiginde sonuc ozetini yaz: ne yaptin, ne degistirdin, kalan riskler.',
    '5. Rate limit hatasi alirsan 30 saniye bekleyip tekrar dene, fail olarak bitirme.',
    '6. Bu bir orkestrasyon sistemi — sen alt iscisin. Kapsamini asma.',
    '=== BRIFING SONU ===',
  ].join('\n');

  return [
    missionBriefing,
    '',
    rulesBlock,
    '',
    `Full subtask instruction: ${item.instruction}`,
    '',
    retryNote,
    '',
    wsNote,
    '',
    'Execution requirements:',
    '- Keep scope limited to this subtask.',
    '- Read CLAUDE.md at the start of your session.',
    '- Run relevant checks/tests when code is changed.',
    '- If you hit a rate limit, wait 30 seconds and retry. Do NOT give up.',
    '- End with a concise result summary and residual risks.',
  ]
    .filter(Boolean)
    .join('\n');
}

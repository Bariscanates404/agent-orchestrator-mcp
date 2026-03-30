export const TASK_STATUS = Object.freeze({
  QUEUED: 'queued',
  PREPARING: 'preparing',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const TASK_TERMINAL_STATES = new Set([TASK_STATUS.COMPLETED, TASK_STATUS.FAILED, TASK_STATUS.CANCELLED]);

export const TASK_ACTIVE_STATES = new Set([TASK_STATUS.QUEUED, TASK_STATUS.PREPARING, TASK_STATUS.RUNNING]);

export const LEAD_STATUS = Object.freeze({
  QUEUED: 'queued',
  PLANNING: 'planning',
  RUNNING: 'running',
  EVALUATING: 'evaluating',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

export const LEAD_TERMINAL_STATES = new Set([LEAD_STATUS.COMPLETED, LEAD_STATUS.FAILED, LEAD_STATUS.CANCELLED]);

export const TASK_EVENT = Object.freeze({
  TASK_CREATED: 'task_created',
  STATUS_CHANGED: 'status_changed',
  AGENT_STARTED: 'agent_started',
  STDOUT_CHUNK: 'stdout_chunk',
  STDERR_CHUNK: 'stderr_chunk',
  ESCALATED: 'escalated',
  CANCELLED: 'cancelled',
  CLEANUP: 'cleanup',
  RUNNER_STARTED: 'runner_started',
  RUNNER_ERROR: 'runner_error',
});

export const LEAD_EVENT = Object.freeze({
  LEAD_RUN_CREATED: 'lead_run_created',
  RUN_STARTED: 'run_started',
  PLANNING_STARTED: 'planning_started',
  PLANNING_COMPLETED: 'planning_completed',
  EXECUTION_STARTED: 'execution_started',
  EXECUTION_COMPLETED: 'execution_completed',
  ITEM_LAUNCHED: 'item_launched',
  ITEM_FINISHED: 'item_finished',
  ITEM_RETRY_QUEUED: 'item_retry_queued',
  ITEM_ADDED: 'item_added',
  EVALUATION_STARTED: 'evaluation_started',
  EVALUATION_VERDICT: 'evaluation_verdict',
  FOLLOWUP_ITEMS_CREATED: 'followup_items_created',
  RUN_FINISHED: 'run_finished',
  RUN_FAILED: 'run_failed',
  PAUSED: 'paused',
  RESUMED: 'resumed',
  CANCELLED: 'cancelled',
});

export const VERDICT = Object.freeze({
  PASS: 'pass',
  RETRY: 'retry',
  FAIL: 'fail',
});

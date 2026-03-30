import { readBody, sendJson } from '../http-helpers.mjs';
import { addLeadRunItem, cancelLeadRun, createLeadRun, pauseLeadRun, resumeLeadRun } from '../mcp-proxy.mjs';
import { buildLeadRunDetailPayload, buildLeadRunsPayload } from '../payloads.mjs';

export function registerLeadRoutes(router, { repoRoot, stateRoot }) {
  router.get('/api/leads', (_req, res, url) => {
    return sendJson(res, 200, buildLeadRunsPayload(repoRoot, stateRoot, Number(url.searchParams.get('limit') || 40)));
  });

  router.get(/^\/api\/leads\/[^/]+$/, (_req, res, url) => {
    const leadRunId = decodeURIComponent(url.pathname.split('/').pop());
    const payload = buildLeadRunDetailPayload(stateRoot, leadRunId);
    if (!payload) {
      return sendJson(res, 404, { error: 'Lead run not found' });
    }
    return sendJson(res, 200, payload);
  });

  router.post('/api/leads/launch', async (req, res) => {
    const body = await readBody(req);
    if (!body.objective) {
      return sendJson(res, 400, { error: 'objective is required' });
    }
    const result = await createLeadRun(repoRoot, stateRoot, body);
    return sendJson(res, 200, result);
  });

  router.post(/^\/api\/leads\/[^/]+\/pause$/, async (_req, res, url) => {
    const leadRunId = decodeURIComponent(url.pathname.split('/')[3]);
    const result = await pauseLeadRun(repoRoot, stateRoot, leadRunId);
    return sendJson(res, 200, result);
  });

  router.post(/^\/api\/leads\/[^/]+\/resume$/, async (_req, res, url) => {
    const leadRunId = decodeURIComponent(url.pathname.split('/')[3]);
    const result = await resumeLeadRun(repoRoot, stateRoot, leadRunId);
    return sendJson(res, 200, result);
  });

  router.post(/^\/api\/leads\/[^/]+\/cancel$/, async (_req, res, url) => {
    const leadRunId = decodeURIComponent(url.pathname.split('/')[3]);
    const result = await cancelLeadRun(repoRoot, stateRoot, leadRunId);
    return sendJson(res, 200, result);
  });

  router.post(/^\/api\/leads\/[^/]+\/items$/, async (req, res, url) => {
    const leadRunId = decodeURIComponent(url.pathname.split('/')[3]);
    const body = await readBody(req);
    if (!body.instruction) {
      return sendJson(res, 400, { error: 'instruction is required' });
    }
    const result = await addLeadRunItem(repoRoot, stateRoot, leadRunId, body);
    return sendJson(res, 200, result);
  });
}

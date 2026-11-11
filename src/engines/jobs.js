/**
 * Job runner for background memory work (extraction, embedding, reflection).
 * It is deliberately pull-based: the host decides when to spend idle time.
 */
export function createJobRunner({ queue, handlers = {}, logger = null } = {}) {
  if (!queue) throw new Error('job runner needs a queue');

  async function runOne({ now = Date.now(), kinds = null } = {}) {
    const job = queue.claimNext({ now, kinds });
    if (!job) return { ran: false };
    const handler = handlers[job.kind];
    if (typeof handler !== 'function') {
      const failed = queue.fail(job.id, `no handler for ${job.kind}`, { now, retryAfterMs: 0 });
      return { ran: true, job: failed, ok: false, error: `no handler for ${job.kind}` };
    }
    try {
      const result = await handler(job.payload, job);
      return { ran: true, job: queue.complete(job.id, result), ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn?.(`cortex job ${job.id} failed: ${message}`);
      return { ran: true, job: queue.fail(job.id, message, { now }), ok: false, error: message };
    }
  }

  async function runUntilIdle({ now = Date.now(), max = 50, kinds = null } = {}) {
    const results = [];
    for (let i = 0; i < Math.max(1, Math.min(500, max)); i += 1) {
      const result = await runOne({ now, kinds });
      if (!result.ran) break;
      results.push(result);
    }
    return { ran: results.length, results, counts: queue.counts() };
  }

  return { runOne, runUntilIdle };
}

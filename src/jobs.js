'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { LcError } = require('./api');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

class Jobs {
  constructor(store, api, { sleep = delay, now = Date.now, pollMs = 1500, timeoutMs = 120000 } = {}) {
    Object.assign(this, { store, api, sleep, now, pollMs, timeoutMs });
    this.busy = false;
  }
  async start(kind, problem, snapshot, input, auth, user, progress, token) {
    if (this.busy) throw new LcError('BUSY', 'A remote operation is already running.');
    this.busy = true;
    let job;
    try {
      job = { token: randomUUID(), kind, slug: problem.titleSlug, title: problem.title, number: problem.questionFrontendId, user,
        file: snapshot.file, version: snapshot.version, hash: createHash('sha256').update(snapshot.code).digest('hex'), startedAt: new Date(this.now()).toISOString() };
      await this.store.acquire(job);
      if (token?.isCancellationRequested) { await this.store.release(); return undefined; }
      progress('Sending exact editor snapshot to LeetCode…');
      try { job.id = await this.api.start(kind, problem, snapshot.code, input, auth); }
      catch (e) { if (e.rejected) await this.store.release(); throw e; }
      await this.store.atomic('pending.json', job);
      return await this.poll(job, auth, progress, token);
    } finally { this.busy = false; }
  }
  async resume(auth, user, progress, token) {
    if (this.busy) throw new LcError('BUSY', 'An operation is already running.');
    const job = await this.store.pending();
    if (!job) throw new LcError('NO_PENDING', 'There is no pending operation.');
    if (job.user !== user) throw new LcError('ACCOUNT', 'This pending operation belongs to a different LeetCode account. Reconnect that account.');
    if (!job.id) throw new LcError('UNKNOWN', 'LeetCode may have received the request, but no ID was saved. Check your LeetCode submission history before clearing the pending operation.');
    this.busy = true;
    try { return await this.poll(job, auth, progress, token); }
    finally { this.busy = false; }
  }
  async poll(job, auth, progress, token) {
    const deadline = this.now() + this.timeoutMs;
    while (this.now() < deadline) {
      if (token?.isCancellationRequested) throw new LcError('CANCELLED', 'Stopped waiting. LeetCode may still be judging. Use Retrieve Pending Result; no second request will be sent.');
      const result = await this.api.check(job.id, auth);
      if (result.state === 'SUCCESS') {
        const record = { job, result };
        await this.store.atomic('last-result.json', record);
        // Another window may have completed this same poll; never delete a newer job.
        if (await this.store.claimCompletion(job.token)) {
          if ((await this.store.pending())?.token === job.token) await this.store.release();
        }
        return record;
      }
      progress(`LeetCode ${result.state.toLowerCase()} · ${job.id}`);
      await this.sleep(this.pollMs);
    }
    throw new LcError('POLL_TIMEOUT', 'LeetCode is taking longer than two minutes. Use Retrieve Pending Result later; your operation has not been sent again.');
  }
}

module.exports = { Jobs };

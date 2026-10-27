/* Node-only: a worker_threads pool implementing Evaluator (scenarios are independent and seeded,
   so results are identical to the in-thread evaluator, just faster). */
import { Worker } from 'node:worker_threads';
import os from 'node:os';
import type { Evaluator, Job, Res } from './evaluate.ts';

export class EvalPool {
  private workers: Worker[];
  readonly size: number;
  constructor(n = Math.max(1, os.availableParallelism() - 1)) {
    this.size = n;
    this.workers = Array.from({ length: n }, () => new Worker(new URL('./pool-worker.ts', import.meta.url)));
  }

  run: Evaluator = jobs => new Promise<Res[]>((resolve, reject) => {
    const out: Res[] = Array(jobs.length);
    let next = 0, done = 0;
    if (!jobs.length) return resolve(out);
    const feed = (w: Worker) => { if (next < jobs.length) { const id = next++; w.postMessage({ id, job: jobs[id] satisfies Job }); } };
    const offs: (() => void)[] = [];
    for (const w of this.workers) {
      const onMsg = (m: { id: number; res: Res }) => {
        out[m.id] = m.res;
        if (++done === jobs.length) { offs.forEach(f => f()); resolve(out); } else feed(w);
      };
      const onErr = (e: Error) => { offs.forEach(f => f()); reject(e); };
      w.on('message', onMsg); w.on('error', onErr);
      offs.push(() => { w.off('message', onMsg); w.off('error', onErr); });
      feed(w); feed(w);   // two in flight per worker hides message latency
    }
  });

  close() { return Promise.all(this.workers.map(w => w.terminate())); }
}

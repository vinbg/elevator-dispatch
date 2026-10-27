/* worker_threads entry for EvalPool: run one (spec, scenario) job per message. */
import { parentPort } from 'node:worker_threads';
import { runJob, type Job } from './evaluate.ts';

parentPort!.on('message', (m: { id: number; job: Job }) => parentPort!.postMessage({ id: m.id, res: runJob(m.job) }));

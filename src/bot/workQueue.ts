/** FIFO per key: each job waits for the previous one on the same key. */

const tails = new Map<string, Promise<void>>();

export function enqueueWork<T>(key: string, run: () => Promise<T>): Promise<T> {
  const prev = tails.get(key) ?? Promise.resolve();
  const job = prev.then(run, run);
  const done = job.then(
    () => undefined,
    () => undefined,
  );
  tails.set(key, done);
  void done.then(() => {
    if (tails.get(key) === done) tails.delete(key);
  });
  return job;
}

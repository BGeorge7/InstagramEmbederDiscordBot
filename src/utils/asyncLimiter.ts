export type Limit = <Result>(task: () => Promise<Result>) => Promise<Result>;

export function createLimiter(concurrency: number): Limit {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("Concurrency must be a positive integer.");
  }

  let activeCount = 0;
  const queue: Array<() => void> = [];

  function release(): void {
    activeCount -= 1;
    queue.shift()?.();
  }

  return async function limit<Result>(
    task: () => Promise<Result>,
  ): Promise<Result> {
    if (activeCount >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }

    activeCount += 1;
    try {
      return await task();
    } finally {
      release();
    }
  };
}

const sampleSize = 600;

export function frameStats() {
  const intervals = new Float64Array(sampleSize);
  let previous: number | undefined;
  let count = 0;
  let cursor = 0;
  return {
    record(now: number) {
      if (previous !== undefined && now > previous) {
        intervals[cursor] = now - previous;
        cursor = (cursor + 1) % sampleSize;
        count = Math.min(count + 1, sampleSize);
      }
      previous = now;
    },
    read() {
      const sorted = intervals.slice(0, count).sort();
      const total = sorted.reduce((sum, interval) => sum + interval, 0);
      return { fps: total ? count * 1000 / total : 0, p95: sorted[Math.ceil(count * 0.95) - 1] ?? 0 };
    },
  };
}

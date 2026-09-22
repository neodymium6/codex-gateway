import { useIntervalFn, useTimestamp } from "@vueuse/core";

/** VueUse 15 delegates cadence to a scheduler. Keep one shared scheduler so elapsed-time labels
 * update at their requested precision without falling back to requestAnimationFrame. */
export function usePausableTimestamp(intervalMs: number) {
  return useTimestamp({
    controls: true,
    scheduler: (update) =>
      useIntervalFn(update, intervalMs, { immediate: true, immediateCallback: true }),
  });
}

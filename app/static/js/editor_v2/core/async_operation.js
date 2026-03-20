export const DEFAULT_OPERATION_TIMEOUT_MS = 12000;

export function withTimeout(promise, { timeoutMs = DEFAULT_OPERATION_TIMEOUT_MS, label = "Operation" } = {}) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = window.setTimeout(() => {
      reject(new Error(`${label} timed out`));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      window.clearTimeout(timer);
    }
  });
}

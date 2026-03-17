const REDACTION_PATTERNS = [
  /(authorization["']?\s*:\s*["']?bearer\s+)[^"',\s]+/gi,
  /(access_token["']?\s*:\s*["']?)[^"',\s]+/gi,
  /(refresh_token["']?\s*:\s*["']?)[^"',\s]+/gi,
  /(code["']?\s*:\s*["']?)[^"',\s]+/gi,
];

function redactString(value) {
  let next = String(value);
  for (const pattern of REDACTION_PATTERNS) {
    next = next.replace(pattern, "$1[redacted]");
  }
  return next;
}

export function redactSensitive(value) {
  if (value == null) return value;
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (typeof value === "object") {
    const output = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/(token|authorization|code|session)/i.test(key)) {
        output[key] = "[redacted]";
      } else {
        output[key] = redactSensitive(entry);
      }
    }
    return output;
  }
  return value;
}

export function createLogger(scope) {
  return {
    info(message, details) {
      if (details === undefined) {
        console.info(`[Writior:${scope}] ${message}`);
        return;
      }
      console.info(`[Writior:${scope}] ${message}`, redactSensitive(details));
    },
    warn(message, details) {
      if (details === undefined) {
        console.warn(`[Writior:${scope}] ${message}`);
        return;
      }
      console.warn(`[Writior:${scope}] ${message}`, redactSensitive(details));
    },
    error(message, details) {
      if (details === undefined) {
        console.error(`[Writior:${scope}] ${message}`);
        return;
      }
      console.error(`[Writior:${scope}] ${message}`, redactSensitive(details));
    },
  };
}


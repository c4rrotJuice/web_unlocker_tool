export function isRestrictedRuntimePage(url) {
  const value = String(url || "");
  return (
    value.startsWith("chrome://")
    || value.startsWith("chrome-extension://")
    || value.startsWith("edge://")
    || value.startsWith("about:")
    || value.startsWith("moz-extension://")
  );
}

export function copyTextWithFallback(text, { navigatorRef = navigator, documentRef = document } = {}) {
  return (async () => {
    const value = String(text || "");
    try {
      if (navigatorRef?.clipboard?.writeText) {
        await navigatorRef.clipboard.writeText(value);
        return { ok: true, method: "clipboard" };
      }
    } catch {
      // Intentional fallback to command-based copy.
    }

    try {
      const textarea = documentRef.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "true");
      textarea.style.position = "fixed";
      textarea.style.top = "-9999px";
      textarea.style.left = "-9999px";
      (documentRef.body || documentRef.documentElement).appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = documentRef.execCommand?.("copy");
      textarea.remove();
      return copied ? { ok: true, method: "execCommand" } : { ok: false, error: "copy_command_rejected" };
    } catch (error) {
      return { ok: false, error: error?.message || "copy_unavailable" };
    }
  })();
}

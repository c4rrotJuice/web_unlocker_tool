function fallbackCopy(documentRef, text) {
  const textarea = documentRef.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  textarea.style.left = "-9999px";
  documentRef.body?.appendChild(textarea);
  textarea.focus?.();
  textarea.select?.();
  const success = typeof documentRef.execCommand === "function" ? documentRef.execCommand("copy") : false;
  textarea.remove?.();
  return success;
}

export async function copyTextToClipboard(text, { navigatorRef = globalThis.navigator, documentRef = globalThis.document } = {}) {
  const normalized = String(text || "");
  try {
    if (navigatorRef?.clipboard?.writeText) {
      await navigatorRef.clipboard.writeText(normalized);
      return { ok: true, method: "clipboard" };
    }
  } catch {
    // fall through
  }
  if (fallbackCopy(documentRef, normalized)) {
    return { ok: true, method: "execCommand" };
  }
  return { ok: false, method: "none" };
}

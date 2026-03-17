export function readBootPayload() {
  const node = document.getElementById("app-boot");
  if (!node) {
    throw new Error("Missing app boot payload");
  }
  return JSON.parse(node.textContent || "{}");
}

export function once(key) {
  const marker = `__writior_once_${key}`;
  if (window[marker]) {
    return false;
  }
  window[marker] = true;
  return true;
}

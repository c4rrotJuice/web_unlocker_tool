export async function getLocal(keys) {
  return chrome.storage.local.get(keys);
}

export async function setLocal(payload) {
  await chrome.storage.local.set(payload);
}

export async function removeLocal(keys) {
  await chrome.storage.local.remove(keys);
}


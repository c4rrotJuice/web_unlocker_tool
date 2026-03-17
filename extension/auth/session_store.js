import { getLocal, removeLocal, setLocal } from "../storage/kv.js";

const SESSION_KEY = "session";

export async function readRawSession() {
  const payload = await getLocal({ [SESSION_KEY]: null });
  return payload[SESSION_KEY] || null;
}

export async function writeRawSession(session) {
  if (!session) {
    await removeLocal([SESSION_KEY]);
    return;
  }
  await setLocal({ [SESSION_KEY]: session });
}

import { getLocal, setLocal } from "../storage/kv.js";

const CACHE_KEY = "extension_capability_cache";

export function createCapabilityCache() {
  return {
    async read() {
      const payload = await getLocal({ [CACHE_KEY]: null });
      return payload[CACHE_KEY];
    },
    async write(capabilities) {
      await setLocal({
        [CACHE_KEY]: {
          capabilities: capabilities || null,
          updated_at: new Date().toISOString(),
        },
      });
    },
    async summarize() {
      const entry = await this.read();
      return entry || { capabilities: null, updated_at: null };
    },
  };
}


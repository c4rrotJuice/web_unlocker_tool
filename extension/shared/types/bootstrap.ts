export function normalizeBootstrapPayload(payload = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  return {
    profile: source.profile ?? null,
    entitlement: source.entitlement ?? null,
    capabilities: source.capabilities ?? null,
    app: source.app ?? null,
    taxonomy: source.taxonomy ?? null,
  };
}

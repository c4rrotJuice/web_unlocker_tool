export function createCitationStore(api) {
  const summaries = new Map();
  const details = new Map();

  function prime(rows = []) {
    for (const row of rows) {
      if (!row?.id) continue;
      summaries.set(row.id, row);
      details.set(row.id, row);
    }
  }

  return {
    async list(params) {
      const rows = await api.listCitations(params);
      prime(rows);
      return rows;
    },
    async get(id) {
      if (details.has(id)) return details.get(id);
      const row = await api.getCitation(id);
      prime([row]);
      return row;
    },
    prime,
  };
}

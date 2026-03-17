export function createCitationStore(api) {
  const summaries = new Map();
  const details = new Map();
  return {
    async list(params) {
      const rows = await api.listCitations(params);
      for (const row of rows) summaries.set(row.id, row);
      return rows;
    },
    async get(id) {
      if (details.has(id)) return details.get(id);
      const row = await api.getCitation(id);
      details.set(id, row);
      summaries.set(id, row);
      return row;
    },
  };
}

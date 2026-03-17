export function createTagStore(api) {
  let tags = null;
  return {
    async list() {
      if (tags) return tags;
      tags = await api.listTags();
      return tags;
    },
  };
}

export function createProjectStore(api) {
  let projects = null;
  return {
    async list() {
      if (projects) return projects;
      projects = await api.listProjects();
      return projects;
    },
  };
}

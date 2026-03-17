export function createCommandRegistry({ workspaceState, selectionState, handlers, renderMenu }) {
  const commands = [
    {
      id: "insert_citation",
      label: "Insert citation",
      group: "Insert",
      when: ({ document }) => !!document,
      run: () => handlers.openInsertSearch("citations"),
    },
    {
      id: "insert_quote",
      label: "Insert quote",
      group: "Insert",
      when: ({ document }) => !!document,
      run: () => handlers.openInsertSearch("quotes"),
    },
    {
      id: "insert_note",
      label: "Insert note",
      group: "Insert",
      when: ({ document }) => !!document,
      run: () => handlers.openInsertSearch("notes"),
    },
    {
      id: "insert_bibliography",
      label: "Insert bibliography",
      group: "Insert",
      when: ({ document }) => !!document,
      run: () => handlers.insertBibliography(),
    },
    {
      id: "focus_explorer",
      label: "Search research explorer",
      group: "Navigate",
      when: () => true,
      run: () => handlers.focusExplorerSearch(),
    },
    {
      id: "create_checkpoint",
      label: "Create checkpoint",
      group: "Document",
      when: ({ document, saveStatus }) => !!document && saveStatus !== "error",
      run: () => handlers.createCheckpoint(),
    },
  ];

  return {
    list(filter = "") {
      const state = workspaceState.getState();
      const selection = selectionState.getState();
      const needle = filter.trim().toLowerCase();
      return commands.filter((command) => {
        if (!command.when({ document: state.active_document, selection, saveStatus: state.save_status })) {
          return false;
        }
        if (!needle) return true;
        return command.label.toLowerCase().includes(needle) || command.group.toLowerCase().includes(needle);
      });
    },
    invoke(id) {
      const command = commands.find((item) => item.id === id);
      if (!command) return false;
      const state = workspaceState.getState();
      const selection = selectionState.getState();
      if (!command.when({ document: state.active_document, selection, saveStatus: state.save_status })) {
        return false;
      }
      command.run();
      return true;
    },
    open(filter = "") {
      renderMenu(this.list(filter), filter);
    },
  };
}

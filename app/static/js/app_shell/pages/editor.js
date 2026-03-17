export async function initEditor(boot) {
  const { createEditorApp } = await import("../../editor_v2/core/editor_app.js");
  const app = await createEditorApp({ boot });
  await app.start();
}

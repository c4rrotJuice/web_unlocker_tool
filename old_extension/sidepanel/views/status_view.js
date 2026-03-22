import { createStatusView } from "../components/index.js";

export function renderStatusView(root, snapshot = {}, options = {}) {
  if (!root) {
    return { mounted: false };
  }
  const documentRef = options.documentRef || globalThis.document;
  const statusView = createStatusView({
    documentRef,
    title: snapshot.title || "Loading",
    message: snapshot.message || "",
    tone: snapshot.tone || (snapshot.status === "error" ? "error" : "neutral"),
  });
  root.innerHTML = "";
  root.appendChild(statusView.root);
  return {
    mounted: true,
    update(nextSnapshot = snapshot) {
      statusView.render(
        nextSnapshot.title || "Loading",
        nextSnapshot.message || "",
        nextSnapshot.tone || (nextSnapshot.status === "error" ? "error" : "neutral"),
      );
      return { mounted: true };
    },
  };
}

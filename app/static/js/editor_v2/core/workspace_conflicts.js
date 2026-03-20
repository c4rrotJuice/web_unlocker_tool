function readConflictDetail(error) {
  if (!error || typeof error !== "object") return {};
  const payload = error.payload && typeof error.payload === "object" ? error.payload : {};
  const detail = payload.detail && typeof payload.detail === "object" ? payload.detail : null;
  if (detail) return detail;
  if (payload && typeof payload === "object" && Object.keys(payload).length) return payload;
  return {};
}

export function isWorkspaceConflictError(error) {
  const detail = readConflictDetail(error);
  return (
    error?.status === 409
    || detail.code === "revision_conflict"
    || detail.error_code === "revision_conflict"
    || detail.kind === "revision_conflict"
  );
}

export function getWorkspaceConflictSnapshot(error) {
  const detail = readConflictDetail(error);
  const currentDocument = detail.current_document || detail.document || null;
  return {
    code: "revision_conflict",
    message: detail.message || "Document changed on another surface. Reload the latest version before saving again.",
    operation: detail.operation || null,
    expected_revision: detail.expected_revision || null,
    current_revision: detail.current_revision || currentDocument?.revision || currentDocument?.updated_at || null,
    current_document: currentDocument,
  };
}

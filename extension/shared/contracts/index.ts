export const CONTRACTS = Object.freeze({
  MESSAGE_ENVELOPE: "message-envelope",
  RESULT_ENVELOPE: "result-envelope",
  ERROR_ENVELOPE: "error-envelope",
});

export {
  validateBootstrapSnapshot,
  validateCaptureEntityResponse,
  validateCitationRenderBundlePayload,
  validateInternalMessageRequest,
  validateInternalMessageResponse,
  validateResultEnvelope,
  validateWorkInEditorResponseData,
} from "./validators.ts";
export {
  getActionAvailability,
  getTierLabel,
  getUsageItems,
  normalizeCapabilitySurface,
} from "../types/capability_surface.ts";
export {
  buildWorkInEditorPayload,
  normalizeWorkInEditorRequest,
  normalizeWorkInEditorResponse,
} from "../types/work_in_editor.ts";

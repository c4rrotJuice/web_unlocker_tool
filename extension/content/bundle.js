(function() {
  const modules = {
"shared/constants/message_names.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_NAMES = void 0;
exports.MESSAGE_NAMES = Object.freeze({
    PING: "runtime.ping",
    OPEN_SIDEPANEL: "ui.open_sidepanel",
    AUTH_START: "auth.start",
    AUTH_STATUS_GET: "auth.status_get",
    AUTH_LOGOUT: "auth.logout",
    BOOTSTRAP_FETCH: "bootstrap.fetch",
    CAPTURE_CREATE_CITATION: "capture.create_citation",
    CAPTURE_CREATE_QUOTE: "capture.create_quote",
    CAPTURE_CREATE_NOTE: "capture.create_note",
    CITATION_RENDER: "citation.render",
    CITATION_SAVE: "citation.save",
    WORK_IN_EDITOR_REQUEST: "editor.work_in_editor_request",
});

},
"shared/types/contracts.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGE_CONTRACTS = exports.SURFACE_NAMES = exports.MESSAGE_TOPICS = void 0;
const message_names_ts_1 = require("../constants/message_names.ts");
exports.MESSAGE_TOPICS = Object.freeze({
    UI: "ui",
    AUTH: "auth",
    BOOTSTRAP: "bootstrap",
    CAPTURE: "capture",
    CITATION: "citation",
    EDITOR: "editor",
});
exports.SURFACE_NAMES = Object.freeze({
    POPUP: "popup",
    SIDEPANEL: "sidepanel",
    CONTENT: "content",
    BACKGROUND: "background",
});
exports.MESSAGE_CONTRACTS = Object.freeze({
    [message_names_ts_1.MESSAGE_NAMES.PING]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.UI,
        payloadShape: "surface:string, href?:string",
        resultShape: "ack:boolean, surface:string, timestamp:string",
    }),
    [message_names_ts_1.MESSAGE_NAMES.OPEN_SIDEPANEL]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.UI,
        payloadShape: "surface:string",
        resultShape: "opened:boolean, target:string",
    }),
    [message_names_ts_1.MESSAGE_NAMES.AUTH_START]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.AUTH,
        payloadShape: "surface:string, trigger:string, redirectPath?:string",
        resultShape: "auth:AuthState",
    }),
    [message_names_ts_1.MESSAGE_NAMES.AUTH_STATUS_GET]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.AUTH,
        payloadShape: "surface:string",
        resultShape: "auth:AuthState",
    }),
    [message_names_ts_1.MESSAGE_NAMES.AUTH_LOGOUT]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.AUTH,
        payloadShape: "surface:string",
        resultShape: "auth:AuthState",
    }),
    [message_names_ts_1.MESSAGE_NAMES.BOOTSTRAP_FETCH]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.BOOTSTRAP,
        payloadShape: "surface:string",
        resultShape: "auth:AuthState",
    }),
    [message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_CITATION]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.CAPTURE,
        payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string}",
        resultShape: "citation:canonical backend response",
    }),
    [message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_QUOTE]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.CAPTURE,
        payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string}",
        resultShape: "quote:canonical backend response",
    }),
    [message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_NOTE]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.CAPTURE,
        payloadShape: "surface:string, noteText?:string, capture?:{selectionText?:string, pageTitle?:string, pageUrl?:string, pageDomain?:string}",
        resultShape: "note:canonical backend response",
    }),
    [message_names_ts_1.MESSAGE_NAMES.CITATION_RENDER]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.CITATION,
        payloadShape: "surface:string, citationId:string, style:string",
        resultShape: "renders:{apa|mla|chicago|harvard:{inline|footnote|bibliography:string}}",
    }),
    [message_names_ts_1.MESSAGE_NAMES.CITATION_SAVE]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.CITATION,
        payloadShape: "surface:string, citationId:string, style:string, format:string, copy?:boolean",
        resultShape: "saved:boolean, citationId:string, style:string, format:string, copy:boolean",
    }),
    [message_names_ts_1.MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST]: Object.freeze({
        topic: exports.MESSAGE_TOPICS.EDITOR,
        payloadShape: "surface:string, sourceId:string",
        resultShape: "phase:string",
    }),
});

},
"shared/contracts/messages.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SURFACE_NAMES = void 0;
exports.createPingRequest = createPingRequest;
exports.createOpenSidepanelRequest = createOpenSidepanelRequest;
exports.createAuthStartRequest = createAuthStartRequest;
exports.createAuthStatusGetRequest = createAuthStatusGetRequest;
exports.createAuthLogoutRequest = createAuthLogoutRequest;
exports.createBootstrapFetchRequest = createBootstrapFetchRequest;
exports.createCaptureCreateCitationRequest = createCaptureCreateCitationRequest;
exports.createCaptureCreateQuoteRequest = createCaptureCreateQuoteRequest;
exports.createCaptureCreateNoteRequest = createCaptureCreateNoteRequest;
exports.createCitationRenderRequest = createCitationRenderRequest;
exports.createCitationSaveRequest = createCitationSaveRequest;
exports.createWorkInEditorRequest = createWorkInEditorRequest;
const message_names_ts_1 = require("../constants/message_names.ts");
const contracts_ts_1 = require("../types/contracts.ts");
Object.defineProperty(exports, "SURFACE_NAMES", { enumerable: true, get: function () { return contracts_ts_1.SURFACE_NAMES; } });
function createRequest(type, requestId, payload) {
    return { type, requestId, payload };
}
function createPingRequest(requestId, payload) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.PING, requestId, payload);
}
function createOpenSidepanelRequest(requestId, surface) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.OPEN_SIDEPANEL, requestId, { surface });
}
function createAuthStartRequest(requestId, surface, trigger, redirectPath = undefined) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.AUTH_START, requestId, {
        surface,
        trigger,
        redirectPath,
    });
}
function createAuthStatusGetRequest(requestId, surface) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.AUTH_STATUS_GET, requestId, { surface });
}
function createAuthLogoutRequest(requestId, surface) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.AUTH_LOGOUT, requestId, { surface });
}
function createBootstrapFetchRequest(requestId, surface) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.BOOTSTRAP_FETCH, requestId, { surface });
}
function createCaptureCreateCitationRequest(requestId, payload) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_CITATION, requestId, payload);
}
function createCaptureCreateQuoteRequest(requestId, payload) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_QUOTE, requestId, payload);
}
function createCaptureCreateNoteRequest(requestId, payload) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_NOTE, requestId, payload);
}
function createCitationRenderRequest(requestId, payload) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.CITATION_RENDER, requestId, payload);
}
function createCitationSaveRequest(requestId, payload) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.CITATION_SAVE, requestId, payload);
}
function createWorkInEditorRequest(requestId, payload) {
    return createRequest(message_names_ts_1.MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST, requestId, payload);
}

},
"shared/utils/request_id.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRequestId = createRequestId;
let sequence = 0;
function createRequestId(prefix = "runtime") {
    sequence += 1;
    return `${prefix}-${Date.now()}-${sequence}`;
}

},
"shared/types/messages.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ERROR_CODES = exports.RESULT_STATUS = void 0;
exports.createOkResult = createOkResult;
exports.createErrorResult = createErrorResult;
exports.createNotImplementedResult = createNotImplementedResult;
exports.isErrorResult = isErrorResult;
exports.isOkResult = isOkResult;
exports.RESULT_STATUS = Object.freeze({
    OK: "ok",
    ERROR: "error",
});
exports.ERROR_CODES = Object.freeze({
    INVALID_PAYLOAD: "invalid_payload",
    INVALID_CONTEXT: "invalid_context",
    UNSUPPORTED_MESSAGE: "unsupported_message",
    NOT_IMPLEMENTED: "not_implemented",
    UNEXPECTED_ERROR: "unexpected_error",
    NETWORK_ERROR: "network_error",
    UNAUTHORIZED: "unauthorized",
    AUTH_INVALID: "auth_invalid",
    BOOTSTRAP_FAILED: "bootstrap_failed",
    HANDOFF_INVALID: "handoff_invalid",
    HANDOFF_EXPIRED: "handoff_expired",
    HANDOFF_ALREADY_USED: "handoff_already_used",
    HANDOFF_PAYLOAD_INVALID: "handoff_payload_invalid",
    HANDOFF_REFRESH_FAILED: "handoff_refresh_failed",
    AUTH_ATTEMPT_INVALID: "auth_attempt_invalid",
    AUTH_ATTEMPT_EXPIRED: "auth_attempt_expired",
});
function createOkResult(data = null, requestId = undefined, meta = undefined) {
    return {
        ok: true,
        status: exports.RESULT_STATUS.OK,
        requestId,
        data,
        meta,
    };
}
function createErrorResult(code, message, requestId = undefined, details = undefined, meta = undefined) {
    return {
        ok: false,
        status: exports.RESULT_STATUS.ERROR,
        requestId,
        error: {
            code,
            message,
            details,
        },
        meta,
    };
}
function createNotImplementedResult(messageType, requestId = undefined, details = undefined) {
    return createErrorResult(exports.ERROR_CODES.NOT_IMPLEMENTED, `${messageType} is not implemented in this phase.`, requestId, details);
}
function isErrorResult(result) {
    return result.ok === false;
}
function isOkResult(result) {
    return result.ok === true;
}

},
"shared/types/citation.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CITATION_FORMATS = exports.CITATION_STYLES = void 0;
exports.normalizeCitationStyle = normalizeCitationStyle;
exports.normalizeCitationFormat = normalizeCitationFormat;
exports.getLockedCitationStyles = getLockedCitationStyles;
exports.getCitationPreviewText = getCitationPreviewText;
exports.CITATION_STYLES = Object.freeze(["apa", "mla", "chicago", "harvard"]);
exports.CITATION_FORMATS = Object.freeze(["inline", "footnote", "bibliography"]);
function normalizeCitationStyle(value, fallback = "apa") {
    const normalized = String(value || fallback).trim().toLowerCase();
    return exports.CITATION_STYLES.includes(normalized) ? normalized : fallback;
}
function normalizeCitationFormat(value, fallback = "bibliography") {
    const normalized = String(value || fallback).trim().toLowerCase();
    return exports.CITATION_FORMATS.includes(normalized) ? normalized : fallback;
}
function getLockedCitationStyles(allowedStyles) {
    const allowed = Array.isArray(allowedStyles)
        ? allowedStyles
            .map((style) => normalizeCitationStyle(style, ""))
            .filter(Boolean)
        : [];
    if (!allowed.length) {
        return [];
    }
    return exports.CITATION_STYLES.filter((style) => !allowed.includes(style));
}
function getCitationPreviewText(record, style = "apa", format = "bibliography") {
    const normalizedStyle = normalizeCitationStyle(style);
    const normalizedFormat = normalizeCitationFormat(format);
    const styleBundle = record?.render_bundle?.renders?.[normalizedStyle] || record?.renders?.[normalizedStyle] || null;
    if (styleBundle && typeof styleBundle[normalizedFormat] === "string" && styleBundle[normalizedFormat].trim()) {
        return styleBundle[normalizedFormat].trim();
    }
    if (record?.citation?.style === normalizedStyle || record?.style === normalizedStyle) {
        if (normalizedFormat === "inline" && typeof (record?.citation?.inline_citation || record?.inline_citation) === "string") {
            return String(record?.citation?.inline_citation || record?.inline_citation).trim();
        }
        if (normalizedFormat === "footnote" && typeof (record?.citation?.footnote || record?.footnote) === "string") {
            return String(record?.citation?.footnote || record?.footnote).trim();
        }
        if (normalizedFormat === "bibliography") {
            const value = record?.citation?.full_citation || record?.citation?.full_text || record?.full_citation || record?.full_text || "";
            return String(value).trim();
        }
    }
    return "";
}

},
"shared/types/capture.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTURE_TYPES = void 0;
exports.normalizeCaptureContext = normalizeCaptureContext;
exports.buildContentCapturePayload = buildContentCapturePayload;
exports.buildCaptureExtractionPayload = buildCaptureExtractionPayload;
exports.buildCitationCaptureRequest = buildCitationCaptureRequest;
exports.buildQuoteCaptureRequest = buildQuoteCaptureRequest;
exports.buildNoteCaptureRequest = buildNoteCaptureRequest;
function normalizeText(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
function truncateText(value, maxLength = 80) {
    const normalized = normalizeText(value);
    if (!normalized || normalized.length <= maxLength) {
        return normalized;
    }
    return `${normalized.slice(0, maxLength - 1)}...`;
}
function deriveDomain(pageUrl, explicitDomain = "") {
    const normalizedDomain = normalizeText(explicitDomain).toLowerCase();
    if (normalizedDomain) {
        return normalizedDomain;
    }
    const normalizedUrl = normalizeText(pageUrl);
    if (!normalizedUrl) {
        return "";
    }
    try {
        return new URL(normalizedUrl).hostname.toLowerCase();
    }
    catch {
        return "";
    }
}
function buildExternalNoteSource({ pageUrl, pageDomain, pageTitle, } = {}) {
    const url = normalizeText(pageUrl);
    if (!url) {
        return [];
    }
    return [{
            relation_type: "external",
            url,
            hostname: deriveDomain(url, pageDomain) || null,
            title: normalizeText(pageTitle) || null,
            position: 0,
        }];
}
exports.CAPTURE_TYPES = Object.freeze({
    CITATION: "citation",
    QUOTE: "quote",
    NOTE: "note",
});
function normalizeCaptureContext(input = {}) {
    const selectionText = normalizeText(input.selectionText);
    const pageTitle = normalizeText(input.pageTitle);
    const pageUrl = normalizeText(input.pageUrl);
    const pageDomain = deriveDomain(pageUrl, input.pageDomain);
    return {
        selectionText,
        pageTitle,
        pageUrl,
        pageDomain,
    };
}
function buildContentCapturePayload({ selectionText, pageTitle, pageUrl, pageDomain, } = {}) {
    return {
        capture: normalizeCaptureContext({
            selectionText,
            pageTitle,
            pageUrl,
            pageDomain,
        }),
    };
}
function buildCaptureExtractionPayload(input = {}) {
    const context = normalizeCaptureContext(input);
    return {
        identifiers: {},
        canonical_url: context.pageUrl || null,
        page_url: context.pageUrl || null,
        title_candidates: context.pageTitle
            ? [{ value: context.pageTitle, confidence: 0.9, source: "document.title" }]
            : [],
        author_candidates: [],
        date_candidates: [],
        publisher_candidates: context.pageDomain
            ? [{ value: context.pageDomain, confidence: 0.4, source: "page.domain" }]
            : [],
        container_candidates: [],
        source_type_candidates: [{ value: "webpage", confidence: 0.8, source: "extension.capture" }],
        selection_text: context.selectionText || null,
        locator: {},
        extraction_evidence: {
            capture_source: "extension_selection",
            page_domain: context.pageDomain || null,
        },
        raw_metadata: {
            title: context.pageTitle || null,
            page_domain: context.pageDomain || null,
        },
    };
}
function buildCitationCaptureRequest(input = {}) {
    const context = normalizeCaptureContext(input);
    return {
        extraction_payload: buildCaptureExtractionPayload(context),
        excerpt: context.selectionText || null,
        locator: {},
    };
}
function buildQuoteCaptureRequest({ citationId, selectionText, annotation, } = {}) {
    return {
        citation_id: normalizeText(citationId),
        excerpt: normalizeText(selectionText),
        locator: {},
        annotation: normalizeText(annotation) || null,
    };
}
function buildNoteCaptureRequest({ selectionText, noteText, pageTitle, pageUrl, pageDomain, citationId = null, quoteId = null, } = {}) {
    const normalizedSelection = normalizeText(selectionText);
    const normalizedBody = normalizeText(noteText) || normalizedSelection;
    const titleSeed = normalizedBody || normalizeText(pageTitle) || "Captured note";
    return {
        title: truncateText(titleSeed, 72) || "Captured note",
        note_body: normalizedBody,
        highlight_text: normalizedSelection || null,
        citation_id: normalizeText(citationId) || null,
        quote_id: normalizeText(quoteId) || null,
        tag_ids: [],
        sources: buildExternalNoteSource({ pageUrl, pageDomain, pageTitle }),
        linked_note_ids: [],
    };
}

},
"shared/contracts/validators.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REQUEST_PAYLOAD_VALIDATORS = void 0;
exports.validateCitationRenderBundle = validateCitationRenderBundle;
exports.validateMessageEnvelope = validateMessageEnvelope;
exports.validateMessageResult = validateMessageResult;
exports.validateResultEnvelope = validateResultEnvelope;
exports.validateBootstrapSnapshot = validateBootstrapSnapshot;
const message_names_ts_1 = require("../constants/message_names.ts");
const contracts_ts_1 = require("../types/contracts.ts");
const citation_ts_1 = require("../types/citation.ts");
const capture_ts_1 = require("../types/capture.ts");
const messages_ts_1 = require("../types/messages.ts");
const KNOWN_MESSAGE_TYPES = new Set(Object.values(message_names_ts_1.MESSAGE_NAMES));
const KNOWN_SURFACES = new Set(Object.values(contracts_ts_1.SURFACE_NAMES));
function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function isNonEmptyString(value) {
    return typeof value === "string" && value.trim().length > 0;
}
function validateSurface(payload) {
    if (!isPlainObject(payload) || !isNonEmptyString(payload.surface) || !KNOWN_SURFACES.has(payload.surface)) {
        return "payload.surface must be one of the canonical extension surfaces.";
    }
    return null;
}
function validatePingPayload(payload) {
    const surfaceError = validateSurface(payload);
    if (surfaceError) {
        return surfaceError;
    }
    if (payload.href != null && !isNonEmptyString(payload.href)) {
        return "payload.href must be a non-empty string when provided.";
    }
    return null;
}
function validateOpenSidepanelPayload(payload) {
    return validateSurface(payload);
}
function validateAuthStartPayload(payload) {
    const surfaceError = validateSurface(payload);
    if (surfaceError) {
        return surfaceError;
    }
    if (!isNonEmptyString(payload.trigger)) {
        return "payload.trigger must be a non-empty string.";
    }
    if (payload.redirectPath != null && !isNonEmptyString(payload.redirectPath)) {
        return "payload.redirectPath must be a non-empty string when provided.";
    }
    return null;
}
function validateStatusPayload(payload) {
    return validateSurface(payload);
}
function validateCaptureEntityPayload(payload, contentField) {
    const surfaceError = validateSurface(payload);
    if (surfaceError) {
        return surfaceError;
    }
    if (!isPlainObject(payload.capture)) {
        return "payload.capture must be an object.";
    }
    const capture = (0, capture_ts_1.normalizeCaptureContext)(payload.capture);
    if (!isNonEmptyString(capture[contentField])) {
        return `payload.capture.${contentField} must be a non-empty string.`;
    }
    if (!isNonEmptyString(capture.pageTitle)) {
        return "payload.capture.pageTitle must be a non-empty string.";
    }
    if (!isNonEmptyString(capture.pageUrl)) {
        return "payload.capture.pageUrl must be a non-empty string.";
    }
    return null;
}
function validateCaptureNotePayload(payload) {
    const surfaceError = validateSurface(payload);
    if (surfaceError) {
        return surfaceError;
    }
    if (payload.noteText != null && !isNonEmptyString(payload.noteText)) {
        return "payload.noteText must be a non-empty string when provided.";
    }
    if (payload.capture != null && !isPlainObject(payload.capture)) {
        return "payload.capture must be an object when provided.";
    }
    const capture = payload.capture ? (0, capture_ts_1.normalizeCaptureContext)(payload.capture) : null;
    const hasSelection = isNonEmptyString(capture?.selectionText);
    const hasNoteText = isNonEmptyString(payload.noteText);
    if (!hasSelection && !hasNoteText) {
        return "payload.noteText or payload.capture.selectionText must be a non-empty string.";
    }
    if (capture) {
        if (payload.capture.pageTitle != null && !isNonEmptyString(capture.pageTitle)) {
            return "payload.capture.pageTitle must be a non-empty string when provided.";
        }
        if (payload.capture.pageUrl != null && !isNonEmptyString(capture.pageUrl)) {
            return "payload.capture.pageUrl must be a non-empty string when provided.";
        }
    }
    return null;
}
function validateEditorPayload(payload) {
    const surfaceError = validateSurface(payload);
    if (surfaceError) {
        return surfaceError;
    }
    if (!isNonEmptyString(payload.sourceId)) {
        return "payload.sourceId must be a non-empty string.";
    }
    return null;
}
function validateCitationRenderPayload(payload) {
    const surfaceError = validateSurface(payload);
    if (surfaceError) {
        return surfaceError;
    }
    if (!isNonEmptyString(payload.citationId)) {
        return "payload.citationId must be a non-empty string.";
    }
    if (!isNonEmptyString(payload.style)) {
        return "payload.style must be a non-empty string.";
    }
    if ((0, citation_ts_1.normalizeCitationStyle)(payload.style, "") !== payload.style.trim().toLowerCase()) {
        return "payload.style must be one of the supported citation styles.";
    }
    return null;
}
function validateCitationSavePayload(payload) {
    const renderError = validateCitationRenderPayload(payload);
    if (renderError) {
        return renderError;
    }
    if (!isNonEmptyString(payload.format)) {
        return "payload.format must be a non-empty string.";
    }
    if ((0, citation_ts_1.normalizeCitationFormat)(payload.format, "") !== payload.format.trim().toLowerCase()) {
        return "payload.format must be one of the supported citation formats.";
    }
    if (payload.copy != null && typeof payload.copy !== "boolean") {
        return "payload.copy must be a boolean when provided.";
    }
    return null;
}
exports.REQUEST_PAYLOAD_VALIDATORS = Object.freeze({
    [message_names_ts_1.MESSAGE_NAMES.PING]: validatePingPayload,
    [message_names_ts_1.MESSAGE_NAMES.OPEN_SIDEPANEL]: validateOpenSidepanelPayload,
    [message_names_ts_1.MESSAGE_NAMES.AUTH_START]: validateAuthStartPayload,
    [message_names_ts_1.MESSAGE_NAMES.AUTH_STATUS_GET]: validateStatusPayload,
    [message_names_ts_1.MESSAGE_NAMES.AUTH_LOGOUT]: validateStatusPayload,
    [message_names_ts_1.MESSAGE_NAMES.BOOTSTRAP_FETCH]: validateStatusPayload,
    [message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_CITATION]: (payload) => validateCaptureEntityPayload(payload, "selectionText"),
    [message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_QUOTE]: (payload) => validateCaptureEntityPayload(payload, "selectionText"),
    [message_names_ts_1.MESSAGE_NAMES.CAPTURE_CREATE_NOTE]: validateCaptureNotePayload,
    [message_names_ts_1.MESSAGE_NAMES.CITATION_RENDER]: validateCitationRenderPayload,
    [message_names_ts_1.MESSAGE_NAMES.CITATION_SAVE]: validateCitationSavePayload,
    [message_names_ts_1.MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST]: validateEditorPayload,
});
function validateCitationRenderBundle(payload) {
    if (!isPlainObject(payload)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle must be a JSON object.");
    }
    if (!isPlainObject(payload.renders)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle must include renders.");
    }
    const renders = {};
    let hasRenderableText = false;
    for (const [style, bundle] of Object.entries(payload.renders)) {
        if (!citation_ts_1.CITATION_STYLES.includes(style)) {
            return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, `Unsupported citation style: ${style}.`);
        }
        if (!isPlainObject(bundle)) {
            return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, `Citation render bundle for ${style} must be an object.`);
        }
        renders[style] = {};
        for (const format of citation_ts_1.CITATION_FORMATS) {
            if (bundle[format] == null) {
                continue;
            }
            if (typeof bundle[format] !== "string") {
                return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, `Citation render bundle for ${style}.${format} must be a string.`);
            }
            renders[style][format] = bundle[format];
            if (bundle[format].trim()) {
                hasRenderableText = true;
            }
        }
    }
    if (!hasRenderableText) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Citation render bundle did not include any render text.");
    }
    return {
        ok: true,
        status: messages_ts_1.RESULT_STATUS.OK,
        data: {
            ...payload,
            renders,
            cache_hit: Boolean(payload.cache_hit),
        },
        meta: payload.meta ?? null,
    };
}
function validateMessageEnvelope(message, { allowedTypes = null } = {}) {
    if (!isPlainObject(message)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Invalid message envelope.");
    }
    if (!isNonEmptyString(message.type)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Message type is required.", message?.requestId);
    }
    if (message.requestId != null && !isNonEmptyString(message.requestId)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "requestId must be a non-empty string when provided.");
    }
    if (!("payload" in message) || !isPlainObject(message.payload)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "payload must be an object.", message?.requestId);
    }
    const typeAllowed = Array.isArray(allowedTypes) && allowedTypes.length
        ? allowedTypes.includes(message.type)
        : KNOWN_MESSAGE_TYPES.has(message.type);
    if (!typeAllowed) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.UNSUPPORTED_MESSAGE, `Unsupported message: ${message.type}`, message?.requestId);
    }
    const payloadValidator = exports.REQUEST_PAYLOAD_VALIDATORS[message.type];
    if (typeof payloadValidator !== "function") {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.UNSUPPORTED_MESSAGE, `Unsupported message: ${message.type}`, message?.requestId);
    }
    const payloadError = payloadValidator(message.payload);
    if (payloadError) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, payloadError, message.requestId);
    }
    return null;
}
function validateMessageResult(result, requestId = undefined) {
    if (!isPlainObject(result)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Runtime result must be an object.", requestId);
    }
    if (result.ok !== true && result.ok !== false) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Runtime result must include a boolean ok flag.", requestId);
    }
    if (result.status !== messages_ts_1.RESULT_STATUS.OK && result.status !== messages_ts_1.RESULT_STATUS.ERROR) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Runtime result must include a canonical status.", requestId);
    }
    if (result.requestId != null && !isNonEmptyString(result.requestId)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Runtime result requestId must be a non-empty string when provided.", requestId);
    }
    if (result.ok === true) {
        return null;
    }
    if (!isPlainObject(result.error) || !isNonEmptyString(result.error.code) || !isNonEmptyString(result.error.message)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_PAYLOAD, "Runtime error result must include a structured error payload.", requestId);
    }
    return null;
}
function validateResultEnvelope(payload, { fallbackCode = messages_ts_1.ERROR_CODES.NETWORK_ERROR, label = "Backend response" } = {}) {
    if (!isPlainObject(payload)) {
        return (0, messages_ts_1.createErrorResult)(fallbackCode, `${label} must be a JSON object.`);
    }
    if (payload.ok !== true && payload.ok !== false) {
        return (0, messages_ts_1.createErrorResult)(fallbackCode, `${label} must include an ok flag.`);
    }
    if (payload.ok === false) {
        const error = payload.error || {};
        return (0, messages_ts_1.createErrorResult)(typeof error.code === "string" ? error.code : fallbackCode, typeof error.message === "string" && error.message.trim() ? error.message : `${label} failed.`, undefined, error.details ?? null, payload.meta ?? null);
    }
    return {
        ok: true,
        status: messages_ts_1.RESULT_STATUS.OK,
        data: payload.data ?? null,
        meta: payload.meta ?? null,
    };
}
function validateBootstrapSnapshot(payload) {
    if (!isPlainObject(payload)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap payload must be an object.");
    }
    if (!isPlainObject(payload.profile)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap profile is required.");
    }
    if (!isPlainObject(payload.entitlement)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap entitlement is required.");
    }
    if (!isPlainObject(payload.capabilities)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap capabilities are required.");
    }
    if (!isPlainObject(payload.app)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap app config is required.");
    }
    if (!isPlainObject(payload.taxonomy)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.BOOTSTRAP_FAILED, "Bootstrap taxonomy is required.");
    }
    return {
        ok: true,
        status: messages_ts_1.RESULT_STATUS.OK,
        data: payload,
        meta: null,
    };
}

},
"shared/utils/runtime_message.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendRuntimeMessage = sendRuntimeMessage;
const messages_ts_1 = require("../types/messages.ts");
const validators_ts_1 = require("../contracts/validators.ts");
function mapRuntimeFailure(messageText, requestId) {
    const normalized = String(messageText || "").trim();
    if (/Extension context invalidated/i.test(normalized)) {
        return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.INVALID_CONTEXT, "Extension context invalidated. Reload the page and try again.", requestId);
    }
    return (0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.UNEXPECTED_ERROR, normalized || "Runtime message failed.", requestId);
}
function sendRuntimeMessage(chromeApi, message) {
    const envelopeError = (0, validators_ts_1.validateMessageEnvelope)(message);
    if (envelopeError) {
        return Promise.resolve(envelopeError);
    }
    if (!chromeApi?.runtime?.sendMessage) {
        return Promise.resolve((0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.NOT_IMPLEMENTED, "chrome.runtime.sendMessage is unavailable.", message.requestId));
    }
    return new Promise((resolve) => {
        try {
            chromeApi.runtime.sendMessage(message, (response) => {
                if (chromeApi.runtime?.lastError) {
                    resolve(mapRuntimeFailure(chromeApi.runtime.lastError.message, message.requestId));
                    return;
                }
                if (!response) {
                    resolve((0, messages_ts_1.createErrorResult)(messages_ts_1.ERROR_CODES.UNEXPECTED_ERROR, "No response received from background.", message.requestId));
                    return;
                }
                const resultError = (0, validators_ts_1.validateMessageResult)(response, message.requestId);
                if (resultError) {
                    resolve(resultError);
                    return;
                }
                resolve(response);
            });
        }
        catch (error) {
            resolve(mapRuntimeFailure(error?.message, message.requestId));
        }
    });
}

},
"shared/utils/runtime_client.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SURFACE_NAMES = void 0;
exports.createRuntimeClient = createRuntimeClient;
const messages_ts_1 = require("../contracts/messages.ts");
Object.defineProperty(exports, "SURFACE_NAMES", { enumerable: true, get: function () { return messages_ts_1.SURFACE_NAMES; } });
const request_id_ts_1 = require("./request_id.ts");
const runtime_message_ts_1 = require("./runtime_message.ts");
function createRuntimeClient(chromeApi, surface) {
    return {
        ping(payload = {}) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-ping`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createPingRequest)(requestId, {
                surface,
                ...payload,
            }));
        },
        openSidepanel() {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-open-sidepanel`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createOpenSidepanelRequest)(requestId, surface));
        },
        authStart({ trigger = "manual", redirectPath = undefined } = {}) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-auth-start`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createAuthStartRequest)(requestId, surface, trigger, redirectPath));
        },
        authStatusGet() {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-auth-status`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createAuthStatusGetRequest)(requestId, surface));
        },
        authLogout() {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-auth-logout`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createAuthLogoutRequest)(requestId, surface));
        },
        bootstrapFetch() {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-bootstrap-fetch`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createBootstrapFetchRequest)(requestId, surface));
        },
        createCitation(payload) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-create-citation`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createCaptureCreateCitationRequest)(requestId, {
                surface,
                ...payload,
            }));
        },
        createQuote(payload) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-create-quote`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createCaptureCreateQuoteRequest)(requestId, {
                surface,
                ...payload,
            }));
        },
        createNote(payload) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-create-note`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createCaptureCreateNoteRequest)(requestId, {
                surface,
                ...payload,
            }));
        },
        renderCitation(payload) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-render-citation`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createCitationRenderRequest)(requestId, {
                surface,
                ...payload,
            }));
        },
        saveCitation(payload) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-save-citation`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createCitationSaveRequest)(requestId, {
                surface,
                ...payload,
            }));
        },
        workInEditorRequest(payload) {
            const requestId = (0, request_id_ts_1.createRequestId)(`${surface}-work-in-editor`);
            return (0, runtime_message_ts_1.sendRuntimeMessage)(chromeApi, (0, messages_ts_1.createWorkInEditorRequest)(requestId, {
                surface,
                ...payload,
            }));
        },
    };
}

},
"content/unlock/dom.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isElementNode = isElementNode;
exports.getEventPath = getEventPath;
exports.firstElementFromPath = firstElementFromPath;
exports.getElementPath = getElementPath;
exports.isFormControl = isFormControl;
exports.isContentEditableElement = isContentEditableElement;
exports.isEditorLikeElement = isEditorLikeElement;
exports.isSensitiveWidget = isSensitiveWidget;
exports.isSafeContentElement = isSafeContentElement;
exports.classifyTarget = classifyTarget;
exports.classifyEventPath = classifyEventPath;
const SAFE_TEXT_TAGS = new Set([
    "A",
    "ARTICLE",
    "ASIDE",
    "BLOCKQUOTE",
    "CODE",
    "DD",
    "DIV",
    "DL",
    "DT",
    "EM",
    "FIGCAPTION",
    "FIGURE",
    "H1",
    "H2",
    "H3",
    "H4",
    "H5",
    "H6",
    "IMG",
    "LABEL",
    "LI",
    "MAIN",
    "MARK",
    "P",
    "PRE",
    "SECTION",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TABLE",
    "TBODY",
    "TD",
    "TH",
    "THEAD",
    "TR",
]);
const INTERACTIVE_TAGS = new Set([
    "BUTTON",
    "CANVAS",
    "DIALOG",
    "DETAILS",
    "EMBED",
    "IFRAME",
    "INPUT",
    "OPTION",
    "PROGRESS",
    "SELECT",
    "SUMMARY",
    "TEXTAREA",
    "VIDEO",
    "AUDIO",
]);
const EDITOR_TOKENS = [
    "ace_editor",
    "codemirror",
    "editor",
    "lexical",
    "monaco",
    "prosemirror",
    "ql-editor",
    "quill",
    "slate",
    "tox-",
];
function isElementNode(node) {
    return Boolean(node) && typeof node === "object" && typeof node.tagName === "string";
}
function getEventPath(event) {
    if (!event) {
        return [];
    }
    if (typeof event.composedPath === "function") {
        const path = event.composedPath();
        return Array.isArray(path) ? path : [];
    }
    const path = [];
    let node = event.target || null;
    while (node) {
        path.push(node);
        node = node.parentNode || node.host || null;
    }
    return path;
}
function firstElementFromPath(event) {
    const path = getEventPath(event);
    for (const node of path) {
        if (isElementNode(node)) {
            return node;
        }
    }
    return isElementNode(event?.target) ? event.target : null;
}
function getElementPath(eventOrPath) {
    const rawPath = Array.isArray(eventOrPath) ? eventOrPath : getEventPath(eventOrPath);
    return rawPath.filter(isElementNode);
}
function getStringAttributes(element) {
    if (!isElementNode(element) || typeof element.getAttribute !== "function") {
        return "";
    }
    const values = [
        element.id,
        element.className,
        element.getAttribute("role"),
        element.getAttribute("aria-label"),
        element.getAttribute("data-testid"),
        element.getAttribute("data-test"),
        element.getAttribute("data-editor"),
    ];
    return values.filter(Boolean).join(" ").toLowerCase();
}
function isFormControl(element) {
    if (!isElementNode(element)) {
        return false;
    }
    return ["INPUT", "TEXTAREA", "SELECT", "OPTION"].includes(String(element.tagName || "").toUpperCase());
}
function isContentEditableElement(element) {
    if (!isElementNode(element)) {
        return false;
    }
    if (typeof element.isContentEditable === "boolean" && element.isContentEditable) {
        return true;
    }
    const contentEditable = typeof element.getAttribute === "function"
        ? element.getAttribute("contenteditable")
        : element.contentEditable;
    return contentEditable === "" || contentEditable === "true" || contentEditable === "plaintext-only";
}
function isEditorLikeElement(element) {
    if (!isElementNode(element)) {
        return false;
    }
    const label = getStringAttributes(element);
    if (!label) {
        return false;
    }
    if (label.includes("role textbox")) {
        return true;
    }
    return EDITOR_TOKENS.some((token) => label.includes(token));
}
function isSensitiveWidget(element) {
    if (!isElementNode(element)) {
        return false;
    }
    const tagName = String(element.tagName || "").toUpperCase();
    if (INTERACTIVE_TAGS.has(tagName)) {
        return true;
    }
    if (typeof element.getAttribute === "function") {
        const role = String(element.getAttribute("role") || "").toLowerCase();
        if (["button", "dialog", "listbox", "menu", "menuitem", "option", "slider", "tab", "textbox", "tooltip"].includes(role)) {
            return true;
        }
        if (String(element.getAttribute("type") || "").toLowerCase() === "file") {
            return true;
        }
        if (element.getAttribute("draggable") === "true") {
            return true;
        }
    }
    return false;
}
function isSafeContentElement(element) {
    if (!isElementNode(element)) {
        return false;
    }
    const tagName = String(element.tagName || "").toUpperCase();
    if (!SAFE_TEXT_TAGS.has(tagName)) {
        return false;
    }
    if (isSensitiveWidget(element) || isContentEditableElement(element) || isEditorLikeElement(element)) {
        return false;
    }
    return true;
}
function classifyTarget(target) {
    if (!isElementNode(target)) {
        return {
            kind: "unknown",
            element: null,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isFormControl(target)) {
        return {
            kind: "form-control",
            element: target,
            allowClipboardGuard: true,
            allowPassiveGuard: true,
            allowPasteGuard: true,
            allowShortcutGuard: true,
            allowContextMenuGuard: true,
            allowSelectionGuard: true,
        };
    }
    if (isContentEditableElement(target)) {
        return {
            kind: "contenteditable",
            element: target,
            allowClipboardGuard: true,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: true,
            allowContextMenuGuard: true,
            allowSelectionGuard: true,
        };
    }
    if (isEditorLikeElement(target)) {
        return {
            kind: "editor",
            element: target,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isSensitiveWidget(target)) {
        return {
            kind: "sensitive-widget",
            element: target,
            allowClipboardGuard: false,
            allowPassiveGuard: false,
            allowPasteGuard: false,
            allowShortcutGuard: false,
            allowContextMenuGuard: false,
            allowSelectionGuard: false,
        };
    }
    if (isSafeContentElement(target)) {
        return {
            kind: "safe-content",
            element: target,
            allowClipboardGuard: true,
            allowPassiveGuard: true,
            allowPasteGuard: true,
            allowShortcutGuard: true,
            allowContextMenuGuard: true,
            allowSelectionGuard: true,
        };
    }
    return {
        kind: "neutral",
        element: target,
        allowClipboardGuard: false,
        allowPassiveGuard: false,
        allowPasteGuard: false,
        allowShortcutGuard: false,
        allowContextMenuGuard: false,
        allowSelectionGuard: false,
    };
}
function classifyEventPath(eventOrPath) {
    const path = getElementPath(eventOrPath);
    if (path.length === 0) {
        return classifyTarget(null);
    }
    let sawSafeContent = null;
    let sawFormControl = null;
    let sawContentEditable = null;
    for (const element of path) {
        const classification = classifyTarget(element);
        if (classification.kind === "editor" || classification.kind === "sensitive-widget") {
            return classification;
        }
        if (!sawContentEditable && classification.kind === "contenteditable") {
            sawContentEditable = classification;
        }
        if (!sawFormControl && classification.kind === "form-control") {
            sawFormControl = classification;
        }
        if (!sawSafeContent && classification.kind === "safe-content") {
            sawSafeContent = classification;
        }
    }
    return sawContentEditable || sawFormControl || sawSafeContent || classifyTarget(path[0]);
}

},
"content/unlock/engine.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPageUnlockEngine = createPageUnlockEngine;
const dom_ts_1 = require("./dom.ts");
const STYLE_ID = "writior-copy-unlock-style";
const DEBUG_KEY = "__WRITIOR_COPY_UNLOCK_DEBUG";
const OVERLAY_ATTR = "data-writior-unlock-overlay";
const HISTORY_PATCHED = Symbol("writior.unlock.history.patched");
const INLINE_BLOCKER_PROPS = [
    "oncopy",
    "oncut",
    "onpaste",
    "oncontextmenu",
    "onselectstart",
    "ondragstart",
];
const OPTIONAL_INLINE_PROPS = ["onmousedown", "onclick", "onmouseup"];
const INLINE_BLOCKER_ATTRS = [...INLINE_BLOCKER_PROPS];
const INLINE_OPTIONAL_ATTRS = [...OPTIONAL_INLINE_PROPS];
const STYLE_BLOCKER_PROPS = [
    ["userSelect", "user-select"],
    ["webkitUserSelect", "-webkit-user-select"],
    ["MozUserSelect", "-moz-user-select"],
    ["webkitTouchCallout", "-webkit-touch-callout"],
];
const MODE_PROFILES = {
    safe: {
        clearOptionalInlineHandlers: false,
        broadenNeutralCleanup: false,
        guardMouseUp: false,
        guardAuxClick: false,
        guardKeyUp: false,
    },
    balanced: {
        clearOptionalInlineHandlers: true,
        broadenNeutralCleanup: true,
        guardMouseUp: true,
        guardAuxClick: true,
        guardKeyUp: true,
    },
    aggressive: {
        clearOptionalInlineHandlers: true,
        broadenNeutralCleanup: true,
        guardMouseUp: true,
        guardAuxClick: true,
        guardKeyUp: true,
    },
};
function createStyleText() {
    return `
    html, body {
      -webkit-touch-callout: default !important;
    }
    :where(article, aside, blockquote, code, dd, div, dl, dt, figcaption, figure, h1, h2, h3, h4, h5, h6, li, main, p, pre, section, span, strong, sub, sup, table, tbody, td, th, thead, tr, a, img) {
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      user-select: text !important;
      -webkit-touch-callout: default !important;
    }
    :where(input, textarea, select, option, button, canvas, video, audio, iframe, [contenteditable], [draggable="true"], [role="button"], [role="dialog"], [role="slider"], [role="tab"], [role="textbox"]) {
      -webkit-user-select: auto !important;
      -moz-user-select: auto !important;
      user-select: auto !important;
    }
    [${OVERLAY_ATTR}="off"] {
      pointer-events: none !important;
    }
  `;
}
function callStop(event) {
    if (typeof event?.stopImmediatePropagation === "function") {
        event.stopImmediatePropagation();
    }
    else if (typeof event?.stopPropagation === "function") {
        event.stopPropagation();
    }
}
function isShortcutKey(event) {
    const key = String(event?.key || "").toLowerCase();
    if (!(event?.ctrlKey || event?.metaKey)) {
        return false;
    }
    return key === "c" || key === "x" || key === "v";
}
function isModalLike(element) {
    if (!(0, dom_ts_1.isElementNode)(element) || typeof element.getAttribute !== "function") {
        return false;
    }
    const label = [
        element.id,
        element.className,
        element.getAttribute("role"),
        element.getAttribute("aria-modal"),
        element.getAttribute("data-state"),
    ].filter(Boolean).join(" ").toLowerCase();
    if (element.tagName === "DIALOG" || element.open) {
        return true;
    }
    return ["backdrop", "dialog", "drawer", "menu", "modal", "popover", "toast", "tooltip"].some((token) => label.includes(token));
}
function shouldSkipOverlayMitigation(element, documentRef, windowRef) {
    if (!(0, dom_ts_1.isElementNode)(element)) {
        return true;
    }
    if (isModalLike(element)) {
        return true;
    }
    if (typeof documentRef?.body?.getAttribute === "function") {
        const bodyClass = String(documentRef.body.className || "").toLowerCase();
        if (bodyClass.includes("modal-open") || bodyClass.includes("dialog-open")) {
            return true;
        }
    }
    const style = typeof windowRef?.getComputedStyle === "function" ? windowRef.getComputedStyle(element) : element.style || {};
    const pointerEvents = String(style?.pointerEvents || "").toLowerCase();
    if (pointerEvents === "none") {
        return true;
    }
    return false;
}
function isSuspiciousOverlay(element, documentRef, windowRef) {
    if (!(0, dom_ts_1.isElementNode)(element) || element === documentRef?.documentElement || element === documentRef?.body) {
        return false;
    }
    if (shouldSkipOverlayMitigation(element, documentRef, windowRef)) {
        return false;
    }
    const style = typeof windowRef?.getComputedStyle === "function" ? windowRef.getComputedStyle(element) : element.style || {};
    const position = String(style?.position || "").toLowerCase();
    const opacity = Number.parseFloat(String(style?.opacity || "1"));
    const backgroundColor = String(style?.backgroundColor || "").toLowerCase();
    const zIndex = Number.parseInt(String(style?.zIndex || "0"), 10) || 0;
    const pointerEvents = String(style?.pointerEvents || "").toLowerCase();
    const visibility = String(style?.visibility || "").toLowerCase();
    const display = String(style?.display || "").toLowerCase();
    if (visibility === "hidden" || display === "none" || pointerEvents === "none") {
        return false;
    }
    const suspiciousPosition = position === "fixed" || position === "absolute";
    const suspiciousOpacity = opacity <= 0.05 || backgroundColor === "transparent" || backgroundColor === "rgba(0, 0, 0, 0)";
    return suspiciousPosition && suspiciousOpacity && zIndex >= 100;
}
function getElementsFromPoint(documentRef, x, y) {
    if (typeof documentRef?.elementsFromPoint === "function") {
        const elements = documentRef.elementsFromPoint(x, y);
        return Array.isArray(elements) ? elements.filter(dom_ts_1.isElementNode) : [];
    }
    if (typeof documentRef?.elementFromPoint === "function") {
        const element = documentRef.elementFromPoint(x, y);
        return element ? [element] : [];
    }
    return [];
}
function createPageUnlockEngine(options = {}) {
    const typedOptions = options;
    const documentRef = typedOptions.documentRef || globalThis.document;
    const windowRef = typedOptions.windowRef || globalThis.window;
    const MutationObserverRef = typedOptions.MutationObserverRef || globalThis.MutationObserver;
    const queueMicrotaskRef = typedOptions.queueMicrotaskRef || globalThis.queueMicrotask?.bind(globalThis) || ((callback) => Promise.resolve().then(callback));
    const config = {
        enabled: typedOptions.enabled !== false,
        mode: typedOptions.mode || "balanced",
        restoreSelection: typedOptions.restoreSelection !== false,
        restoreClipboard: typedOptions.restoreClipboard !== false,
        restoreContextMenu: typedOptions.restoreContextMenu !== false,
        restorePassiveClicks: typedOptions.restorePassiveClicks !== false,
        overlayMitigation: typedOptions.overlayMitigation || "conservative",
    };
    const profile = MODE_PROFILES[config.mode] || MODE_PROFILES.balanced;
    const debug = typedOptions.debug === true;
    const listeners = [];
    const cleanupHandlers = [];
    const processedNodes = new WeakSet();
    const overlayMitigated = new WeakSet();
    const queuedNodes = new Set();
    const state = {
        enabled: false,
        bootstrapCount: 0,
        styleInstallCount: 0,
        guardInstallCount: 0,
        inlineCleanupCount: 0,
        styleRecoveryCount: 0,
        overlayMitigationCount: 0,
        mutationBatchCount: 0,
        routeChangeCount: 0,
        listenerCount: 0,
        processedNodeCount: 0,
        observerActive: false,
    };
    let observer = null;
    let flushQueued = false;
    let historyCleanup = null;
    let currentUrl = String(windowRef?.location?.href || "");
    function updateDebugHook() {
        if (!debug || !windowRef) {
            return;
        }
        windowRef[DEBUG_KEY] = {
            mode: config.mode,
            config,
            installed: state.enabled,
            counters: {
                bootstrapCount: state.bootstrapCount,
                styleInstallCount: state.styleInstallCount,
                guardInstallCount: state.guardInstallCount,
                inlineCleanupCount: state.inlineCleanupCount,
                styleRecoveryCount: state.styleRecoveryCount,
                overlayMitigationCount: state.overlayMitigationCount,
                mutationBatchCount: state.mutationBatchCount,
                routeChangeCount: state.routeChangeCount,
            },
        };
    }
    function addListener(target, type, handler, optionsValue = true) {
        if (!target?.addEventListener) {
            return;
        }
        target.addEventListener(type, handler, optionsValue);
        listeners.push(() => target.removeEventListener?.(type, handler, optionsValue));
        state.listenerCount += 1;
    }
    function installStyleOverrides() {
        const parent = documentRef?.head || documentRef?.documentElement || documentRef?.body;
        if (!parent) {
            return null;
        }
        const existing = documentRef.getElementById?.(STYLE_ID);
        if (existing) {
            return existing;
        }
        const styleNode = documentRef.createElement("style");
        styleNode.id = STYLE_ID;
        styleNode.textContent = createStyleText();
        parent.appendChild(styleNode);
        state.styleInstallCount += 1;
        updateDebugHook();
        return styleNode;
    }
    function clearInlineProps(node, properties) {
        let cleared = 0;
        for (const property of properties) {
            if (typeof node?.[property] === "function") {
                node[property] = null;
                cleared += 1;
            }
        }
        return cleared;
    }
    function clearInlineAttributes(node, attributes) {
        if (typeof node?.removeAttribute !== "function") {
            return 0;
        }
        let cleared = 0;
        for (const attribute of attributes) {
            if (node.getAttribute?.(attribute) !== null) {
                node.removeAttribute(attribute);
                cleared += 1;
            }
        }
        return cleared;
    }
    function recoverInlineStyles(node, classification) {
        if (!node?.style) {
            return 0;
        }
        const desiredSelection = classification.kind === "form-control" || classification.kind === "contenteditable" ? "auto" : "text";
        let changed = 0;
        for (const [property, cssProperty] of STYLE_BLOCKER_PROPS) {
            const value = String(node.style[property] || "").toLowerCase();
            if (!value) {
                continue;
            }
            if (property === "webkitTouchCallout") {
                if (value === "none") {
                    if (node.style.setProperty) {
                        node.style.setProperty(cssProperty, "default", "important");
                    }
                    else {
                        node.style[property] = "default";
                    }
                    changed += 1;
                }
                continue;
            }
            if (value === "none" || value === "contain" || value === "all") {
                if (node.style.setProperty) {
                    node.style.setProperty(cssProperty, desiredSelection, "important");
                }
                else {
                    node.style[property] = desiredSelection;
                }
                changed += 1;
            }
        }
        if ((classification.kind === "safe-content" || classification.kind === "neutral") && String(node.style.pointerEvents || "").toLowerCase() === "none") {
            if (node.style.setProperty) {
                node.style.setProperty("pointer-events", "auto", "important");
            }
            else {
                node.style.pointerEvents = "auto";
            }
            changed += 1;
        }
        if (changed > 0) {
            state.styleRecoveryCount += changed;
            updateDebugHook();
        }
        return changed;
    }
    function pathHasInlineBlocker(path, eventType) {
        const property = `on${eventType}`;
        return path.some((node) => {
            if (!(0, dom_ts_1.isElementNode)(node)) {
                return false;
            }
            if (typeof node[property] === "function") {
                return true;
            }
            if (typeof node.getAttribute === "function" && node.getAttribute(property) !== null) {
                return true;
            }
            return false;
        });
    }
    function neutralizeRootBlockers() {
        let cleared = 0;
        for (const node of [documentRef, documentRef?.documentElement, documentRef?.body]) {
            if (!node) {
                continue;
            }
            cleared += clearInlineProps(node, INLINE_BLOCKER_PROPS);
            cleared += clearInlineAttributes(node, INLINE_BLOCKER_ATTRS);
            if (profile.clearOptionalInlineHandlers) {
                cleared += clearInlineProps(node, OPTIONAL_INLINE_PROPS);
                cleared += clearInlineAttributes(node, INLINE_OPTIONAL_ATTRS);
            }
        }
        if (cleared > 0) {
            state.inlineCleanupCount += cleared;
            updateDebugHook();
        }
        return cleared;
    }
    function neutralizeInlineBlockers(root = documentRef?.documentElement) {
        if (!root) {
            return 0;
        }
        const stack = [root];
        let cleared = 0;
        while (stack.length) {
            const node = stack.pop();
            if (!(0, dom_ts_1.isElementNode)(node)) {
                continue;
            }
            const alreadyProcessed = processedNodes.has(node);
            if (!alreadyProcessed) {
                processedNodes.add(node);
                state.processedNodeCount += 1;
                const classification = (0, dom_ts_1.classifyTarget)(node);
                if (classification.kind === "safe-content") {
                    cleared += clearInlineProps(node, INLINE_BLOCKER_PROPS);
                    cleared += clearInlineAttributes(node, INLINE_BLOCKER_ATTRS);
                    if (profile.clearOptionalInlineHandlers) {
                        cleared += clearInlineProps(node, OPTIONAL_INLINE_PROPS);
                        cleared += clearInlineAttributes(node, INLINE_OPTIONAL_ATTRS);
                    }
                }
                else if (classification.kind === "form-control" || classification.kind === "contenteditable") {
                    cleared += clearInlineProps(node, ["oncopy", "oncut", "onpaste", "oncontextmenu", "onselectstart"]);
                    cleared += clearInlineAttributes(node, ["oncopy", "oncut", "onpaste", "oncontextmenu", "onselectstart"]);
                }
                else if (profile.broadenNeutralCleanup && classification.kind === "neutral") {
                    cleared += clearInlineProps(node, INLINE_BLOCKER_PROPS);
                    cleared += clearInlineAttributes(node, INLINE_BLOCKER_ATTRS);
                }
                if (classification.kind === "safe-content"
                    || classification.kind === "form-control"
                    || classification.kind === "contenteditable"
                    || (profile.broadenNeutralCleanup && classification.kind === "neutral")) {
                    recoverInlineStyles(node, classification);
                }
            }
            const children = node.children || [];
            for (let index = children.length - 1; index >= 0; index -= 1) {
                stack.push(children[index]);
            }
        }
        if (cleared > 0) {
            state.inlineCleanupCount += cleared;
            updateDebugHook();
        }
        return cleared;
    }
    function flushMutationBatch() {
        flushQueued = false;
        if (queuedNodes.size === 0) {
            return 0;
        }
        const batch = Array.from(queuedNodes);
        queuedNodes.clear();
        let cleared = 0;
        for (const node of batch) {
            cleared += neutralizeInlineBlockers(node);
        }
        state.mutationBatchCount += 1;
        updateDebugHook();
        return cleared;
    }
    function queueNodeForProcessing(node) {
        if (!node || queuedNodes.has(node)) {
            return;
        }
        queuedNodes.add(node);
        if (flushQueued) {
            return;
        }
        flushQueued = true;
        queueMicrotaskRef(() => flushMutationBatch());
    }
    function monitorDomChanges() {
        if (!MutationObserverRef || observer || !documentRef?.documentElement) {
            return observer;
        }
        observer = new MutationObserverRef((records = []) => {
            for (const record of records) {
                if (record?.target) {
                    queueNodeForProcessing(record.target);
                }
                const addedNodes = Array.isArray(record?.addedNodes) ? record.addedNodes : Array.from(record?.addedNodes || []);
                for (const node of addedNodes) {
                    if ((0, dom_ts_1.isElementNode)(node)) {
                        queueNodeForProcessing(node);
                    }
                }
            }
        });
        observer.observe(documentRef.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style"],
        });
        state.observerActive = true;
        return observer;
    }
    function detectAndMitigateOverlay(event) {
        const x = Number(event?.clientX);
        const y = Number(event?.clientY);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            return false;
        }
        const elements = getElementsFromPoint(documentRef, x, y);
        if (elements.length < 2) {
            return false;
        }
        const top = elements[0];
        const underneath = elements.find((element, index) => {
            if (index === 0) {
                return false;
            }
            const classification = (0, dom_ts_1.classifyTarget)(element);
            return classification.kind === "safe-content" || classification.kind === "form-control";
        });
        if (!underneath || !isSuspiciousOverlay(top, documentRef, windowRef) || overlayMitigated.has(top)) {
            return false;
        }
        if (shouldSkipOverlayMitigation(top, documentRef, windowRef)) {
            return false;
        }
        overlayMitigated.add(top);
        if (typeof top.setAttribute === "function") {
            top.setAttribute(OVERLAY_ATTR, "off");
        }
        if (top.style?.setProperty) {
            top.style.setProperty("pointer-events", "none", "important");
        }
        else if (top.style) {
            top.style.pointerEvents = "none";
        }
        state.overlayMitigationCount += 1;
        updateDebugHook();
        return true;
    }
    function shouldPreemptEvent(event) {
        const target = (0, dom_ts_1.firstElementFromPath)(event);
        const path = (0, dom_ts_1.getElementPath)(event);
        const classification = (0, dom_ts_1.classifyEventPath)(path);
        const type = String(event?.type || "");
        const inlineBlocked = pathHasInlineBlocker(path, type);
        if (type === "keydown" || type === "keyup") {
            if (!config.restoreClipboard || !isShortcutKey(event) || !classification.allowShortcutGuard) {
                return false;
            }
            const key = String(event?.key || "").toLowerCase();
            if (classification.kind === "contenteditable" && key === "v") {
                return false;
            }
            return true;
        }
        if (type === "copy" || type === "cut") {
            return config.restoreClipboard && classification.allowClipboardGuard;
        }
        if (type === "paste") {
            return config.restoreClipboard && classification.allowPasteGuard;
        }
        if (type === "contextmenu") {
            return config.restoreContextMenu && (classification.allowContextMenuGuard || inlineBlocked);
        }
        if (type === "selectstart") {
            return config.restoreSelection && (classification.allowSelectionGuard || inlineBlocked);
        }
        if (type === "dragstart") {
            return config.restoreSelection && classification.kind === "safe-content";
        }
        if (type === "mousedown" || type === "mouseup" || type === "auxclick") {
            return config.restorePassiveClicks && (classification.kind === "safe-content" || inlineBlocked);
        }
        if (type === "click") {
            return config.restorePassiveClicks && inlineBlocked && classification.kind === "safe-content";
        }
        return Boolean(target) && false;
    }
    function createGuard(type) {
        return function guard(event) {
            if (type === "click" || type === "contextmenu" || type === "mousedown" || type === "mouseup" || type === "auxclick" || type === "selectstart") {
                detectAndMitigateOverlay(event);
            }
            if (!shouldPreemptEvent(event)) {
                return;
            }
            callStop(event);
            for (const node of (0, dom_ts_1.getEventPath)(event)) {
                if ((0, dom_ts_1.isElementNode)(node)) {
                    queueNodeForProcessing(node);
                }
            }
        };
    }
    function installEventGuards() {
        if (state.guardInstallCount > 0) {
            return;
        }
        const events = ["copy", "cut", "paste", "contextmenu", "selectstart", "dragstart", "keydown", "mousedown", "click"];
        if (profile.guardMouseUp) {
            events.push("mouseup");
        }
        if (profile.guardAuxClick) {
            events.push("auxclick");
        }
        if (profile.guardKeyUp) {
            events.push("keyup");
        }
        for (const type of events) {
            addListener(documentRef, type, createGuard(type), true);
        }
        state.guardInstallCount = 1;
        updateDebugHook();
    }
    function handleRouteChange() {
        const nextUrl = String(windowRef?.location?.href || "");
        if (nextUrl === currentUrl && nextUrl !== "") {
            installStyleOverrides();
            neutralizeRootBlockers();
            queueNodeForProcessing(documentRef?.documentElement || documentRef?.body || null);
            return;
        }
        currentUrl = nextUrl;
        state.routeChangeCount += 1;
        installStyleOverrides();
        neutralizeRootBlockers();
        queueNodeForProcessing(documentRef?.documentElement || documentRef?.body || null);
        updateDebugHook();
    }
    function routeChangeHooks() {
        if (!windowRef?.history || historyCleanup) {
            return historyCleanup;
        }
        const historyRef = windowRef.history;
        const originalPushState = historyRef.pushState?.bind(historyRef);
        const originalReplaceState = historyRef.replaceState?.bind(historyRef);
        if (!historyRef[HISTORY_PATCHED]) {
            if (originalPushState) {
                historyRef.pushState = function patchedPushState(...args) {
                    const result = originalPushState(...args);
                    handleRouteChange();
                    return result;
                };
            }
            if (originalReplaceState) {
                historyRef.replaceState = function patchedReplaceState(...args) {
                    const result = originalReplaceState(...args);
                    handleRouteChange();
                    return result;
                };
            }
            historyRef[HISTORY_PATCHED] = true;
        }
        addListener(windowRef, "popstate", handleRouteChange, true);
        addListener(windowRef, "hashchange", handleRouteChange, true);
        addListener(windowRef, "pageshow", handleRouteChange, true);
        historyCleanup = () => {
            if (originalPushState) {
                historyRef.pushState = originalPushState;
            }
            if (originalReplaceState) {
                historyRef.replaceState = originalReplaceState;
            }
            delete historyRef[HISTORY_PATCHED];
        };
        cleanupHandlers.push(historyCleanup);
        return historyCleanup;
    }
    function bootstrap() {
        if (!config.enabled) {
            return getState();
        }
        if (state.enabled) {
            installStyleOverrides();
            return getState();
        }
        state.enabled = true;
        state.bootstrapCount += 1;
        installStyleOverrides();
        installEventGuards();
        neutralizeRootBlockers();
        neutralizeInlineBlockers(documentRef?.documentElement || documentRef?.body || null);
        monitorDomChanges();
        routeChangeHooks();
        updateDebugHook();
        return getState();
    }
    function destroy() {
        while (listeners.length) {
            const remove = listeners.pop();
            remove?.();
        }
        while (cleanupHandlers.length) {
            const cleanup = cleanupHandlers.pop();
            cleanup?.();
        }
        observer?.disconnect?.();
        observer = null;
        queuedNodes.clear();
        flushQueued = false;
        const styleNode = documentRef?.getElementById?.(STYLE_ID);
        styleNode?.remove?.();
        state.enabled = false;
        state.observerActive = false;
        if (debug && windowRef && Object.prototype.hasOwnProperty.call(windowRef, DEBUG_KEY)) {
            delete windowRef[DEBUG_KEY];
        }
    }
    function getState() {
        return {
            ...state,
            mode: config.mode,
            queuedNodeCount: queuedNodes.size,
            styleInstalled: Boolean(documentRef?.getElementById?.(STYLE_ID)),
        };
    }
    return {
        bootstrap,
        destroy,
        getState,
        classifyTarget: dom_ts_1.classifyTarget,
        installStyleOverrides,
        installEventGuards,
        neutralizeInlineBlockers,
        monitorDomChanges,
        detectAndMitigateOverlay,
        routeChangeHooks,
        flushMutationBatch,
        neutralizeRootBlockers,
    };
}

},
"content/selection/context.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSelectionContextPayload = buildSelectionContextPayload;
const capture_ts_1 = require("../../shared/types/capture.ts");
function buildSelectionContextPayload({ selection, page, }) {
    return {
        version: 1,
        ...(0, capture_ts_1.buildContentCapturePayload)({
            selectionText: selection?.normalized_text || selection?.text || "",
            pageTitle: page?.title || "",
            pageUrl: page?.url || "",
            pageDomain: page?.host || "",
        }),
    };
}

},
"content/selection/extraction.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractNormalizedSelection = extractNormalizedSelection;
exports.selectionSignature = selectionSignature;
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
const MINIMUM_WORD_CHARS = 3;
function normalizeWhitespace(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}
function getElementFromNode(node) {
    let current = node || null;
    while (current) {
        if (typeof current.tagName === "string") {
            return current;
        }
        current = current.parentNode || current.parentElement || null;
    }
    return null;
}
function getSelectionRange(selection) {
    if (!selection || typeof selection.getRangeAt !== "function" || !selection.rangeCount) {
        return null;
    }
    try {
        return selection.getRangeAt(0);
    }
    catch {
        return null;
    }
}
function toRect(rect = {}) {
    const left = Number(rect.left || 0);
    const top = Number(rect.top || 0);
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    const right = "right" in rect ? Number(rect.right || left + width) : left + width;
    const bottom = "bottom" in rect ? Number(rect.bottom || top + height) : top + height;
    return { left, top, right, bottom, width, height };
}
function rectFromRange(range) {
    if (!range) {
        return null;
    }
    if (typeof range.getBoundingClientRect === "function") {
        const rect = range.getBoundingClientRect();
        if (rect) {
            return toRect(rect);
        }
    }
    if (typeof range.getClientRects === "function") {
        const rects = range.getClientRects();
        const firstRect = rects?.[0] || null;
        if (firstRect) {
            return toRect(firstRect);
        }
    }
    return null;
}
function isValidRect(rect) {
    return Boolean(rect) && rect.width >= 0 && rect.height >= 0 && (rect.width > 0 || rect.height > 0);
}
function isInsideExtensionUi(node) {
    let current = getElementFromNode(node);
    while (current) {
        if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
            return true;
        }
        current = current.parentNode || current.parentElement || null;
    }
    return false;
}
function labelFromElement(element) {
    if (!element) {
        return "";
    }
    const values = [
        element.tagName,
        element.id,
        element.className,
        typeof element.getAttribute === "function" ? element.getAttribute("role") : "",
        typeof element.getAttribute === "function" ? element.getAttribute("data-testid") : "",
        typeof element.getAttribute === "function" ? element.getAttribute("data-test") : "",
    ];
    return values.filter(Boolean).join(" ").toLowerCase();
}
function isContentEditableElement(element) {
    if (!element) {
        return false;
    }
    if (typeof element.isContentEditable === "boolean" && element.isContentEditable) {
        return true;
    }
    const contentEditable = typeof element.getAttribute === "function"
        ? element.getAttribute("contenteditable")
        : element.contentEditable;
    return contentEditable === "" || contentEditable === "true" || contentEditable === "plaintext-only";
}
function isEditableElement(element) {
    if (!element || typeof element.tagName !== "string") {
        return false;
    }
    const tagName = String(element.tagName || "").toUpperCase();
    if (["INPUT", "TEXTAREA", "SELECT", "OPTION"].includes(tagName)) {
        return true;
    }
    if (isContentEditableElement(element)) {
        return true;
    }
    const label = labelFromElement(element);
    if (!label) {
        return false;
    }
    return [
        "ace_editor",
        "codemirror",
        "editor",
        "lexical",
        "monaco",
        "prosemirror",
        "ql-editor",
        "quill",
        "slate",
        "textbox",
    ].some((token) => label.includes(token));
}
function isUnsafeSelectionContainer(element) {
    if (!element || typeof element.tagName !== "string") {
        return false;
    }
    const tagName = String(element.tagName || "").toUpperCase();
    if (["BUTTON", "CANVAS", "DIALOG", "EMBED", "IFRAME", "SELECT", "TEXTAREA", "VIDEO", "AUDIO"].includes(tagName)) {
        return true;
    }
    if (isEditableElement(element)) {
        return true;
    }
    const role = typeof element.getAttribute === "function"
        ? String(element.getAttribute("role") || "").toLowerCase()
        : "";
    return ["button", "dialog", "listbox", "menu", "menuitem", "slider", "tab", "textbox", "tooltip"].includes(role);
}
function hasEnoughSignal(text, minimumLength) {
    if (text.length < minimumLength) {
        return false;
    }
    const wordChars = (text.match(/[A-Za-z0-9]/g) || []).length;
    return wordChars >= Math.min(MINIMUM_WORD_CHARS, minimumLength);
}
function extractNormalizedSelection({ documentRef = globalThis.document, minimumLength = 3, } = {}) {
    const selection = documentRef?.getSelection?.();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
        return null;
    }
    const range = getSelectionRange(selection);
    if (!range) {
        return null;
    }
    const text = String(selection.toString ? selection.toString() : "");
    const normalizedText = normalizeWhitespace(text);
    if (!hasEnoughSignal(normalizedText, minimumLength)) {
        return null;
    }
    const anchorNode = selection.anchorNode || range.startContainer || null;
    const focusNode = selection.focusNode || range.endContainer || null;
    const anchorElement = getElementFromNode(anchorNode);
    const focusElement = getElementFromNode(focusNode);
    const commonElement = getElementFromNode(range.commonAncestorContainer || anchorElement || focusElement);
    const targetElement = commonElement || anchorElement || focusElement || null;
    if (!targetElement) {
        return null;
    }
    if (isInsideExtensionUi(targetElement)
        || isInsideExtensionUi(anchorElement)
        || isInsideExtensionUi(focusElement)) {
        return null;
    }
    if (isUnsafeSelectionContainer(targetElement)
        || isUnsafeSelectionContainer(anchorElement)
        || isUnsafeSelectionContainer(focusElement)) {
        return null;
    }
    const rect = rectFromRange(range);
    if (!isValidRect(rect)) {
        return null;
    }
    const anchorOffset = Number(selection.anchorOffset || 0);
    const focusOffset = Number(selection.focusOffset || 0);
    return {
        text: normalizedText,
        normalized_text: normalizedText,
        length: normalizedText.length,
        word_count: normalizedText ? normalizedText.split(/\s+/).filter(Boolean).length : 0,
        line_count: text ? String(text).split(/\n+/).filter(Boolean).length : 0,
        rect,
        anchor_offset: anchorOffset,
        focus_offset: focusOffset,
        is_collapsed: Boolean(selection.isCollapsed),
        direction: focusOffset >= anchorOffset ? "forward" : "backward",
        target: {
            tag_name: typeof targetElement.tagName === "string" ? targetElement.tagName.toLowerCase() : "",
            is_editable: false,
            inside_extension_ui: false,
        },
    };
}
function selectionSignature(snapshot) {
    if (!snapshot) {
        return "";
    }
    const rect = snapshot.rect || {};
    return [
        snapshot.normalized_text || snapshot.text || "",
        snapshot.anchor_offset ?? 0,
        snapshot.focus_offset ?? 0,
        rect.left ?? 0,
        rect.top ?? 0,
        rect.width ?? 0,
        rect.height ?? 0,
    ].join("|");
}

},
"content/selection/page_metadata.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractPageMetadata = extractPageMetadata;
function walkElements(root, visit) {
    if (!root || typeof visit !== "function") {
        return;
    }
    const stack = [root];
    while (stack.length) {
        const node = stack.pop();
        if (!node) {
            continue;
        }
        visit(node);
        const children = node.children || node.childNodes || [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push(children[index]);
        }
    }
}
function readMeta(documentRef, match) {
    let found = "";
    walkElements(documentRef?.head || documentRef?.documentElement || documentRef?.body || null, (node) => {
        if (found || typeof node?.tagName !== "string" || String(node.tagName).toUpperCase() !== "META") {
            return;
        }
        const name = String(typeof node.getAttribute === "function" ? node.getAttribute("name") : node.name || "");
        const property = String(typeof node.getAttribute === "function" ? node.getAttribute("property") : node.property || "");
        if (match(name.toLowerCase(), property.toLowerCase())) {
            const content = typeof node.getAttribute === "function" ? node.getAttribute("content") : node.content;
            found = content ? String(content).trim() : "";
        }
    });
    return found;
}
function readLink(documentRef, relValue) {
    let found = "";
    walkElements(documentRef?.head || documentRef?.documentElement || documentRef?.body || null, (node) => {
        if (found || typeof node?.tagName !== "string" || String(node.tagName).toUpperCase() !== "LINK") {
            return;
        }
        const rel = String(typeof node.getAttribute === "function" ? node.getAttribute("rel") : node.rel || "").toLowerCase();
        if (rel === relValue) {
            const href = typeof node.getAttribute === "function" ? node.getAttribute("href") : node.href;
            found = href ? String(href) : "";
        }
    });
    return found;
}
function extractPageMetadata({ documentRef = globalThis.document, windowRef = globalThis.window, } = {}) {
    const url = String(windowRef?.location?.href || "");
    const title = String(documentRef?.title
        || readMeta(documentRef, (name, property) => name === "title" || property === "og:title")
        || "").trim();
    const description = readMeta(documentRef, (name, property) => name === "description" || property === "og:description");
    const author = readMeta(documentRef, (name, property) => name === "author" || property === "article:author");
    const site_name = readMeta(documentRef, (_name, property) => property === "og:site_name");
    const canonical_url = readLink(documentRef, "canonical");
    const language = String(documentRef?.documentElement?.lang || "");
    let origin = "";
    let host = "";
    try {
        const parsed = url ? new URL(url) : null;
        origin = parsed?.origin || "";
        host = parsed?.host || "";
    }
    catch { }
    return {
        url,
        origin,
        host,
        title,
        description,
        author,
        site_name,
        canonical_url,
        language,
    };
}

},
"content/selection/position.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePillPosition = computePillPosition;
function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
function computePillPosition({ rect, viewportWidth, viewportHeight, panelWidth, panelHeight, gap = 12, margin = 8, }) {
    const width = Math.max(1, Number(panelWidth || 0));
    const height = Math.max(1, Number(panelHeight || 0));
    const safeRect = rect || { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
    const left = clamp(Number(("right" in safeRect ? safeRect.right : Number(safeRect.left || 0) + Number(safeRect.width || 0)) || 0) - width, margin, Math.max(margin, Number(viewportWidth || 0) - width - margin));
    const aboveTop = Number(safeRect.top || 0) - height - gap;
    const belowTop = Number(safeRect.bottom || 0) + gap;
    const top = aboveTop >= margin
        ? aboveTop
        : clamp(belowTop, margin, Math.max(margin, Number(viewportHeight || 0) - height - margin));
    return { top, left };
}

},
"content/ui/selection_menu_button.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSelectionMenuButton = createSelectionMenuButton;
function createSelectionMenuButton({ documentRef = globalThis.document, action, onAction, }) {
    const button = documentRef.createElement("button");
    const isDisabled = action?.active === false || action?.locked === true;
    button.type = "button";
    button.textContent = action?.label || "";
    button.setAttribute("data-selection-action", action?.key || "");
    button.setAttribute("aria-label", action?.label || "");
    button.disabled = isDisabled;
    if (isDisabled) {
        button.setAttribute("aria-disabled", "true");
    }
    button.style.appearance = "none";
    button.style.border = "1px solid rgba(148, 163, 184, 0.28)";
    button.style.background = isDisabled ? "rgba(15, 23, 42, 0.56)" : "rgba(248, 250, 252, 0.1)";
    button.style.color = "#f8fafc";
    button.style.borderRadius = "999px";
    button.style.padding = "6px 10px";
    button.style.fontSize = "12px";
    button.style.lineHeight = "1";
    button.style.fontWeight = "600";
    button.style.cursor = isDisabled ? "not-allowed" : "pointer";
    button.style.opacity = isDisabled ? "0.54" : "1";
    const preserveSelection = (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
    };
    button.addEventListener("pointerdown", preserveSelection);
    button.addEventListener("mousedown", preserveSelection);
    button.addEventListener("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        if (!isDisabled) {
            onAction?.(action?.key);
        }
    });
    return button;
}

},
"content/ui/selection_action_pill.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSelectionActionPill = createSelectionActionPill;
const position_ts_1 = require("../selection/position.ts");
const selection_menu_button_ts_1 = require("./selection_menu_button.ts");
const HOST_ID = "writior-selection-pill";
const HOST_ATTR = "data-writior-selection-pill-host";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
function createContainer(documentRef) {
    const host = documentRef.createElement("div");
    host.id = HOST_ID;
    host.setAttribute(HOST_ATTR, "true");
    host.setAttribute(EXTENSION_UI_ATTR, "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    host.style.display = "none";
    const root = typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;
    if (root && root !== host) {
        const style = documentRef.createElement("style");
        style.textContent = `
      :host, :host * { box-sizing: border-box; }
      [data-selection-pill-panel="true"] button:focus-visible {
        outline: 2px solid rgba(191, 219, 254, 0.9);
        outline-offset: 2px;
      }
    `;
        root.appendChild(style);
    }
    return { host, root };
}
function createPanel(documentRef) {
    const panel = documentRef.createElement("div");
    panel.setAttribute("data-selection-pill-panel", "true");
    panel.setAttribute(EXTENSION_UI_ATTR, "true");
    panel.style.position = "absolute";
    panel.style.display = "none";
    panel.style.pointerEvents = "auto";
    panel.style.minWidth = "auto";
    panel.style.maxWidth = "calc(100vw - 16px)";
    panel.style.padding = "6px";
    panel.style.borderRadius = "999px";
    panel.style.border = "1px solid rgba(148, 163, 184, 0.26)";
    panel.style.background = "rgba(15, 23, 42, 0.96)";
    panel.style.color = "#f8fafc";
    panel.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.2)";
    panel.style.fontFamily = "Georgia, 'Times New Roman', serif";
    panel.style.fontSize = "12px";
    panel.style.lineHeight = "1";
    return panel;
}
function createSelectionActionPill({ documentRef = globalThis.document, windowRef = globalThis.window, onAction, onDismiss, }) {
    const { host, root } = createContainer(documentRef);
    const panel = createPanel(documentRef);
    const menu = documentRef.createElement("div");
    menu.setAttribute("data-selection-menu", "true");
    menu.style.display = "flex";
    menu.style.gap = "6px";
    menu.style.alignItems = "center";
    menu.style.flexWrap = "wrap";
    panel.appendChild(menu);
    if (root !== host) {
        root.appendChild(panel);
    }
    else {
        host.appendChild(panel);
    }
    let visible = false;
    let currentPosition = null;
    let lastMessage = "";
    let resetTimer = null;
    function ensureMounted() {
        if (host.parentNode || host.parentElement) {
            return;
        }
        (documentRef.body || documentRef.documentElement)?.appendChild(host);
    }
    function setButtons(actions = []) {
        menu.innerHTML = "";
        if (Array.isArray(menu.children)) {
            menu.children.length = 0;
        }
        actions
            .filter((action) => action?.active !== false || action?.locked === true)
            .forEach((action) => {
            menu.appendChild((0, selection_menu_button_ts_1.createSelectionMenuButton)({ documentRef, action, onAction }));
        });
    }
    function updatePosition(rect) {
        const panelRect = typeof panel.getBoundingClientRect === "function"
            ? panel.getBoundingClientRect()
            : { width: 188, height: 84 };
        currentPosition = (0, position_ts_1.computePillPosition)({
            rect,
            viewportWidth: Number(windowRef?.innerWidth || 1024),
            viewportHeight: Number(windowRef?.innerHeight || 768),
            panelWidth: Number(panelRect?.width || 188),
            panelHeight: Number(panelRect?.height || 84),
        });
        panel.style.top = `${currentPosition.top}px`;
        panel.style.left = `${currentPosition.left}px`;
    }
    function setMessage(message) {
        lastMessage = message || "";
        const copyButton = Array.from(menu.children || []).find((node) => node.getAttribute?.("data-selection-action") === "copy");
        if (copyButton) {
            copyButton.textContent = lastMessage || "Copy";
        }
    }
    function flash(message, duration = 1200) {
        if (resetTimer) {
            windowRef?.clearTimeout?.(resetTimer);
            resetTimer = null;
        }
        setMessage(message);
        if (duration > 0) {
            resetTimer = windowRef?.setTimeout?.(() => {
                resetTimer = null;
                if (visible) {
                    setMessage("Copy");
                }
            }, duration) || null;
        }
    }
    function render(snapshot) {
        ensureMounted();
        setButtons(snapshot?.actions || []);
        host.style.display = "block";
        panel.style.display = "block";
        visible = true;
        setMessage("Copy");
        updatePosition(snapshot?.selection?.rect || null);
        return getState();
    }
    function hide(reason = "dismiss") {
        visible = false;
        if (resetTimer) {
            windowRef?.clearTimeout?.(resetTimer);
            resetTimer = null;
        }
        host.style.display = "none";
        panel.style.display = "none";
        onDismiss?.(reason);
    }
    function destroy() {
        hide("destroy");
        host.remove?.();
    }
    function isInsidePill(target) {
        let current = target || null;
        while (current) {
            if (current === host || current === panel || current === root) {
                return true;
            }
            if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
                return true;
            }
            current = current.parentNode || current.parentElement || null;
        }
        return false;
    }
    function getState() {
        return {
            visible,
            position: currentPosition,
            previewText: "",
            lastMessage,
        };
    }
    panel.addEventListener("click", (event) => {
        event.stopPropagation?.();
    });
    return {
        host,
        panel,
        render,
        hide,
        destroy,
        flash,
        isInsidePill,
        isVisible: () => visible,
        getState,
        setCopySuccess() {
            flash("Copied");
        },
        setCopyFailure() {
            flash("Copy failed");
        },
    };
}

},
"sidepanel/components/citation_format_tabs.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCitationFormatTabs = createCitationFormatTabs;
const citation_ts_1 = require("../../shared/types/citation.ts");
const FORMAT_LABELS = {
    inline: "Inline",
    footnote: "Footnote",
    bibliography: "Bibliography",
};
function createCitationFormatTabs({ documentRef = globalThis.document, formats = citation_ts_1.CITATION_FORMATS, selectedFormat = "bibliography", onSelect, } = {}) {
    const root = documentRef.createElement("div");
    root.setAttribute("data-citation-format-tabs", "true");
    root.style.display = "flex";
    root.style.flexWrap = "wrap";
    root.style.gap = "8px";
    function render(nextSelectedFormat = selectedFormat) {
        root.innerHTML = "";
        formats.forEach((format) => {
            const button = documentRef.createElement("button");
            button.type = "button";
            button.textContent = FORMAT_LABELS[format] || String(format || "").toUpperCase();
            button.setAttribute("data-format", format);
            button.setAttribute("aria-pressed", String(format === nextSelectedFormat));
            button.style.padding = "8px 10px";
            button.style.borderRadius = "999px";
            button.style.border = "1px solid rgba(148, 163, 184, 0.28)";
            button.style.background = format === nextSelectedFormat ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.72)";
            button.style.color = "#e2e8f0";
            button.style.cursor = "pointer";
            button.addEventListener("click", (event) => {
                event.preventDefault?.();
                onSelect?.(format);
            });
            root.appendChild(button);
        });
    }
    render(selectedFormat);
    return {
        root,
        render,
    };
}

},
"sidepanel/components/citation_preview_card.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCitationPreviewCard = createCitationPreviewCard;
function createCitationPreviewCard({ documentRef = globalThis.document, title = "Backend-derived preview", } = {}) {
    const root = documentRef.createElement("section");
    const heading = documentRef.createElement("div");
    const body = documentRef.createElement("div");
    root.setAttribute("data-citation-preview-card", "true");
    root.style.display = "grid";
    root.style.gap = "12px";
    root.style.padding = "16px";
    root.style.borderRadius = "18px";
    root.style.border = "1px solid rgba(148, 163, 184, 0.2)";
    root.style.background = "rgba(15, 23, 42, 0.72)";
    root.style.minHeight = "144px";
    heading.textContent = title;
    heading.style.fontSize = "12px";
    heading.style.letterSpacing = "0.08em";
    heading.style.textTransform = "uppercase";
    heading.style.color = "#94a3b8";
    body.setAttribute("data-citation-preview-body", "true");
    body.style.whiteSpace = "pre-wrap";
    body.style.wordBreak = "break-word";
    body.style.overflowWrap = "anywhere";
    body.style.userSelect = "text";
    body.style.webkitUserSelect = "text";
    body.style.lineHeight = "1.65";
    body.style.color = "#f8fafc";
    body.style.fontSize = "15px";
    root.append(heading, body);
    return {
        root,
        body,
        render({ text = "", loading = false, error = null } = {}) {
            if (loading) {
                body.textContent = "Loading citation preview";
                body.style.color = "#cbd5e1";
                return;
            }
            if (error) {
                body.textContent = error.message || "Citation preview unavailable.";
                body.style.color = "#fca5a5";
                return;
            }
            body.textContent = text || "No citation preview available.";
            body.style.color = "#f8fafc";
        },
    };
}

},
"sidepanel/components/citation_style_tabs.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCitationStyleTabs = createCitationStyleTabs;
const citation_ts_1 = require("../../shared/types/citation.ts");
const STYLE_LABELS = {
    apa: "APA",
    mla: "MLA",
    chicago: "Chicago",
    harvard: "Harvard",
};
function createCitationStyleTabs({ documentRef = globalThis.document, styles = citation_ts_1.CITATION_STYLES, selectedStyle = "apa", lockedStyles = [], onSelect, } = {}) {
    const root = documentRef.createElement("div");
    root.setAttribute("data-citation-style-tabs", "true");
    root.style.display = "flex";
    root.style.flexWrap = "wrap";
    root.style.gap = "8px";
    function render(nextSelectedStyle = selectedStyle) {
        root.innerHTML = "";
        styles.forEach((style) => {
            const button = documentRef.createElement("button");
            const locked = Array.isArray(lockedStyles) && lockedStyles.includes(style);
            button.type = "button";
            button.textContent = STYLE_LABELS[style] || String(style || "").toUpperCase();
            button.setAttribute("data-style", style);
            button.setAttribute("aria-pressed", String(style === nextSelectedStyle));
            button.style.padding = "8px 10px";
            button.style.borderRadius = "999px";
            button.style.border = "1px solid rgba(148, 163, 184, 0.28)";
            button.style.background = style === nextSelectedStyle ? "rgba(14, 165, 233, 0.18)" : "rgba(15, 23, 42, 0.72)";
            button.style.color = "#e2e8f0";
            button.style.opacity = locked ? "0.52" : "1";
            button.style.cursor = locked ? "not-allowed" : "pointer";
            button.disabled = locked;
            if (locked) {
                button.setAttribute("data-locked", "true");
                button.setAttribute("aria-disabled", "true");
            }
            button.addEventListener("click", (event) => {
                event.preventDefault?.();
                if (!locked) {
                    onSelect?.(style);
                }
            });
            root.appendChild(button);
        });
    }
    render(selectedStyle);
    return {
        root,
        render,
    };
}

},
"sidepanel/app/citation_modal.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderCitationModal = renderCitationModal;
const citation_ts_1 = require("../../shared/types/citation.ts");
const citation_format_tabs_ts_1 = require("../components/citation_format_tabs.ts");
const citation_preview_card_ts_1 = require("../components/citation_preview_card.ts");
const citation_style_tabs_ts_1 = require("../components/citation_style_tabs.ts");
function setButtonDisabled(button, disabled) {
    button.disabled = disabled;
    if (disabled) {
        button.setAttribute("aria-disabled", "true");
    }
    else if (typeof button.removeAttribute === "function") {
        button.removeAttribute("aria-disabled");
    }
}
function renderCitationModal(root, snapshot = {}, options = {}) {
    const { documentRef = globalThis.document, navigatorRef = globalThis.navigator, onRequestRender, onSave, onDismiss, } = options;
    if (!root) {
        return { mounted: false };
    }
    const state = {
        citation: snapshot?.citation || null,
        renderBundle: snapshot?.render_bundle || null,
        selectedStyle: (0, citation_ts_1.normalizeCitationStyle)(snapshot?.selected_style || snapshot?.citation?.style || "apa"),
        selectedFormat: (0, citation_ts_1.normalizeCitationFormat)(snapshot?.selected_format || snapshot?.citation?.format || "bibliography"),
        lockedStyles: Array.isArray(snapshot?.locked_styles) ? snapshot.locked_styles.slice() : [],
        loading: Boolean(snapshot?.loading),
        error: snapshot?.error || null,
        saveStatus: "idle",
    };
    const wrapper = documentRef.createElement("section");
    const title = documentRef.createElement("div");
    const headline = documentRef.createElement("h2");
    const sourceMeta = documentRef.createElement("p");
    const actions = documentRef.createElement("div");
    const copyButton = documentRef.createElement("button");
    const saveButton = documentRef.createElement("button");
    const closeButton = documentRef.createElement("button");
    const statusLine = documentRef.createElement("p");
    wrapper.setAttribute("data-citation-modal", "true");
    wrapper.setAttribute("tabindex", "0");
    wrapper.style.display = "grid";
    wrapper.style.gap = "14px";
    wrapper.style.padding = "16px";
    wrapper.style.borderRadius = "18px";
    wrapper.style.border = "1px solid rgba(148, 163, 184, 0.24)";
    wrapper.style.background = "rgba(2, 6, 23, 0.98)";
    wrapper.style.color = "#e2e8f0";
    wrapper.style.boxShadow = "0 18px 48px rgba(15, 23, 42, 0.28)";
    wrapper.style.fontFamily = "Georgia, 'Times New Roman', serif";
    wrapper.style.maxWidth = "min(560px, calc(100vw - 24px))";
    title.textContent = "Citation";
    title.style.fontSize = "12px";
    title.style.textTransform = "uppercase";
    title.style.letterSpacing = "0.08em";
    title.style.color = "#94a3b8";
    headline.style.margin = "0";
    headline.style.fontSize = "22px";
    headline.style.lineHeight = "1.15";
    headline.style.overflowWrap = "anywhere";
    sourceMeta.style.margin = "0";
    sourceMeta.style.fontSize = "12px";
    sourceMeta.style.lineHeight = "1.5";
    sourceMeta.style.color = "#94a3b8";
    statusLine.style.margin = "0";
    statusLine.style.minHeight = "18px";
    statusLine.style.fontSize = "12px";
    statusLine.style.lineHeight = "1.35";
    actions.style.display = "flex";
    actions.style.flexWrap = "wrap";
    actions.style.gap = "8px";
    for (const button of [copyButton, saveButton, closeButton]) {
        button.type = "button";
        button.style.padding = "9px 12px";
        button.style.borderRadius = "999px";
        button.style.border = "1px solid rgba(148, 163, 184, 0.28)";
        button.style.color = "#f8fafc";
    }
    copyButton.textContent = "Copy";
    copyButton.setAttribute("data-citation-copy", "true");
    copyButton.style.background = "rgba(14, 165, 233, 0.2)";
    saveButton.textContent = "Save";
    saveButton.setAttribute("data-citation-save", "true");
    saveButton.style.background = "rgba(15, 23, 42, 0.72)";
    closeButton.textContent = "Close";
    closeButton.style.background = "rgba(15, 23, 42, 0.72)";
    const styleTabs = (0, citation_style_tabs_ts_1.createCitationStyleTabs)({
        documentRef,
        selectedStyle: state.selectedStyle,
        lockedStyles: state.lockedStyles,
        onSelect: async (style) => {
            if (style === state.selectedStyle) {
                return;
            }
            state.selectedStyle = (0, citation_ts_1.normalizeCitationStyle)(style);
            state.loading = !getCurrentText();
            state.error = null;
            render();
            if (!state.citation?.id) {
                state.loading = false;
                state.error = { code: "invalid_payload", message: "Missing citation id." };
                render();
                return;
            }
            const result = await onRequestRender?.({
                citationId: state.citation.id,
                style: state.selectedStyle,
            });
            if (result?.ok) {
                state.renderBundle = result.data || null;
                state.loading = false;
                state.error = null;
            }
            else {
                state.loading = false;
                state.error = result?.error || { code: "citation_error", message: "Citation preview failed." };
            }
            render();
        },
    });
    const formatTabs = (0, citation_format_tabs_ts_1.createCitationFormatTabs)({
        documentRef,
        selectedFormat: state.selectedFormat,
        onSelect: async (format) => {
            state.selectedFormat = (0, citation_ts_1.normalizeCitationFormat)(format);
            state.error = null;
            render();
        },
    });
    const previewCard = (0, citation_preview_card_ts_1.createCitationPreviewCard)({ documentRef });
    function getCurrentText() {
        return (0, citation_ts_1.getCitationPreviewText)({
            citation: state.citation,
            render_bundle: state.renderBundle,
        }, state.selectedStyle, state.selectedFormat);
    }
    async function saveSelection(copy = false) {
        if (!state.citation?.id) {
            state.error = { code: "invalid_payload", message: "Missing citation id." };
            render();
            return { ok: false, error: state.error };
        }
        state.saveStatus = copy ? "copying" : "saving";
        render();
        const result = await onSave?.({
            citationId: state.citation.id,
            style: state.selectedStyle,
            format: state.selectedFormat,
            copy,
        });
        if (result?.ok) {
            state.saveStatus = copy ? "copied" : "saved";
            state.error = null;
            render();
            return result;
        }
        state.saveStatus = "idle";
        state.error = result?.error || { code: "save_failed", message: copy ? "Copy failed." : "Save failed." };
        render();
        return result;
    }
    copyButton.addEventListener("click", async (event) => {
        event.preventDefault?.();
        const text = getCurrentText();
        if (!text) {
            state.error = { code: "invalid_payload", message: "No citation text is available." };
            render();
            return;
        }
        try {
            if (navigatorRef?.clipboard?.writeText) {
                await navigatorRef.clipboard.writeText(text);
            }
        }
        catch (error) {
            state.error = { code: "copy_failed", message: error?.message || "Copy failed." };
            render();
            return;
        }
        await saveSelection(true);
    });
    saveButton.addEventListener("click", async (event) => {
        event.preventDefault?.();
        await saveSelection(false);
    });
    closeButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        onDismiss?.();
    });
    wrapper.addEventListener("keydown", (event) => {
        const key = String(event?.key || "").toLowerCase();
        if (key === "escape") {
            event.preventDefault?.();
            onDismiss?.();
            return;
        }
        if ((event?.ctrlKey || event?.metaKey) && key === "enter") {
            event.preventDefault?.();
            copyButton.click?.();
            return;
        }
        if ((event?.ctrlKey || event?.metaKey) && key === "s") {
            event.preventDefault?.();
            saveButton.click?.();
        }
    });
    function render() {
        headline.textContent = state.citation?.metadata?.title || state.citation?.source?.title || "Citation preview";
        sourceMeta.textContent = [
            state.citation?.metadata?.author || state.citation?.source?.author || "",
            state.citation?.metadata?.canonical_url || state.citation?.source?.canonical_url || "",
        ].filter(Boolean).join(" • ");
        styleTabs.render(state.selectedStyle);
        formatTabs.render(state.selectedFormat);
        previewCard.render({
            text: getCurrentText(),
            loading: state.loading,
            error: state.error,
        });
        if (state.error) {
            statusLine.textContent = state.error.message || "Citation preview failed.";
            statusLine.style.color = "#fca5a5";
        }
        else if (state.saveStatus === "copied") {
            statusLine.textContent = "Citation copied.";
            statusLine.style.color = "#86efac";
        }
        else if (state.saveStatus === "saved") {
            statusLine.textContent = "Citation saved.";
            statusLine.style.color = "#86efac";
        }
        else if (state.saveStatus === "copying") {
            statusLine.textContent = "Saving copy action...";
            statusLine.style.color = "#93c5fd";
        }
        else if (state.saveStatus === "saving") {
            statusLine.textContent = "Saving citation...";
            statusLine.style.color = "#93c5fd";
        }
        else {
            statusLine.textContent = "";
            statusLine.style.color = "#94a3b8";
        }
        const actionBusy = state.loading || state.saveStatus === "copying" || state.saveStatus === "saving";
        setButtonDisabled(copyButton, actionBusy);
        setButtonDisabled(saveButton, actionBusy);
        copyButton.textContent = state.saveStatus === "copied" ? "Copied" : "Copy";
        saveButton.textContent = state.saveStatus === "saved" ? "Saved" : "Save";
        actions.innerHTML = "";
        actions.append(copyButton, saveButton, closeButton);
        wrapper.innerHTML = "";
        wrapper.append(title, headline, sourceMeta, styleTabs.root, formatTabs.root, previewCard.root, statusLine, actions);
        if (typeof root.replaceChildren === "function") {
            root.replaceChildren(wrapper);
        }
        else {
            root.innerHTML = "";
            root.appendChild(wrapper);
        }
    }
    render();
    return {
        root,
        render,
        getState() {
            return {
                selectedStyle: state.selectedStyle,
                selectedFormat: state.selectedFormat,
                text: getCurrentText(),
                loading: state.loading,
                error: state.error,
                lockedStyles: state.lockedStyles.slice(),
                saveStatus: state.saveStatus,
            };
        },
    };
}

},
"content/ui/citation_modal_host.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCitationModalHost = createCitationModalHost;
const citation_modal_ts_1 = require("../../sidepanel/app/citation_modal.ts");
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
function createCitationModalHost({ documentRef = globalThis.document, onRequestRender, onSave, onDismiss, navigatorRef = globalThis.navigator, } = {}) {
    const host = documentRef.createElement("div");
    const backdrop = documentRef.createElement("div");
    const surface = documentRef.createElement("div");
    host.setAttribute(EXTENSION_UI_ATTR, "true");
    host.setAttribute("data-citation-modal-host", "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.display = "none";
    host.style.pointerEvents = "none";
    backdrop.setAttribute(EXTENSION_UI_ATTR, "true");
    backdrop.style.position = "absolute";
    backdrop.style.inset = "0";
    backdrop.style.background = "rgba(2, 6, 23, 0.38)";
    backdrop.style.pointerEvents = "auto";
    surface.setAttribute(EXTENSION_UI_ATTR, "true");
    surface.style.position = "absolute";
    surface.style.top = "50%";
    surface.style.left = "50%";
    surface.style.transform = "translate(-50%, -50%)";
    surface.style.width = "min(560px, calc(100vw - 24px))";
    surface.style.maxHeight = "calc(100vh - 24px)";
    surface.style.overflow = "auto";
    surface.style.pointerEvents = "auto";
    host.append(backdrop, surface);
    let visible = false;
    let modal = null;
    function ensureMounted() {
        if (host.parentNode || host.parentElement) {
            return;
        }
        (documentRef.body || documentRef.documentElement)?.appendChild(host);
    }
    function render(snapshot) {
        ensureMounted();
        visible = true;
        host.style.display = "block";
        modal = (0, citation_modal_ts_1.renderCitationModal)(surface, snapshot, {
            documentRef,
            navigatorRef,
            onRequestRender,
            onSave,
            onDismiss,
        });
        return modal;
    }
    backdrop.addEventListener("click", (event) => {
        event.preventDefault?.();
        onDismiss?.();
    });
    return {
        host,
        surface,
        render,
        hide() {
            visible = false;
            host.style.display = "none";
            surface.innerHTML = "";
        },
        isVisible() {
            return visible;
        },
        isInside(target) {
            let current = target || null;
            while (current) {
                if (current === host || current === surface) {
                    return true;
                }
                if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
                    return true;
                }
                current = current.parentNode || current.parentElement || null;
            }
            return false;
        },
        getState() {
            return modal?.getState?.() || { visible };
        },
        destroy() {
            host.remove?.();
        },
    };
}

},
"content/ui/highlight_preview.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHighlightPreview = createHighlightPreview;
function truncatePreview(value, maxLength = 220) {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!text || text.length <= maxLength) {
        return text;
    }
    return `${text.slice(0, maxLength - 1)}...`;
}
function createHighlightPreview({ documentRef = globalThis.document, } = {}) {
    const root = documentRef.createElement("section");
    const label = documentRef.createElement("p");
    const text = documentRef.createElement("blockquote");
    const meta = documentRef.createElement("p");
    root.setAttribute("data-highlight-preview", "true");
    root.style.display = "grid";
    root.style.gap = "6px";
    label.textContent = "Highlight";
    label.style.margin = "0";
    label.style.fontSize = "11px";
    label.style.textTransform = "uppercase";
    label.style.letterSpacing = "0.08em";
    label.style.color = "#94a3b8";
    text.style.margin = "0";
    text.style.padding = "10px 12px";
    text.style.borderRadius = "12px";
    text.style.background = "rgba(15, 23, 42, 0.7)";
    text.style.border = "1px solid rgba(148, 163, 184, 0.22)";
    text.style.color = "#e2e8f0";
    text.style.fontSize = "12px";
    text.style.lineHeight = "1.45";
    meta.style.margin = "0";
    meta.style.fontSize = "11px";
    meta.style.lineHeight = "1.4";
    meta.style.color = "#94a3b8";
    root.append(label, text, meta);
    return {
        root,
        render({ text: previewText = "", pageTitle = "", pageUrl = "" } = {}) {
            text.textContent = truncatePreview(previewText) || "No highlight";
            meta.textContent = [pageTitle, pageUrl].filter(Boolean).join(" • ");
        },
    };
}

},
"content/ui/quick_note_panel.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createQuickNotePanel = createQuickNotePanel;
const position_ts_1 = require("../selection/position.ts");
const highlight_preview_ts_1 = require("./highlight_preview.ts");
const HOST_ID = "writior-quick-note-panel";
const HOST_ATTR = "data-writior-quick-note-host";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
function createContainer(documentRef) {
    const host = documentRef.createElement("div");
    host.id = HOST_ID;
    host.setAttribute(HOST_ATTR, "true");
    host.setAttribute(EXTENSION_UI_ATTR, "true");
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.zIndex = "2147483647";
    host.style.pointerEvents = "none";
    host.style.display = "none";
    return host;
}
function setDisabled(element, disabled) {
    element.disabled = disabled;
    if (disabled) {
        element.setAttribute("aria-disabled", "true");
    }
    else if (typeof element.removeAttribute === "function") {
        element.removeAttribute("aria-disabled");
    }
}
function createQuickNotePanel({ documentRef = globalThis.document, windowRef = globalThis.window, onSave, onCancel, onInput, } = {}) {
    const host = createContainer(documentRef);
    const panel = documentRef.createElement("section");
    const heading = documentRef.createElement("p");
    const preview = (0, highlight_preview_ts_1.createHighlightPreview)({ documentRef });
    const textarea = documentRef.createElement("textarea");
    const feedback = documentRef.createElement("p");
    const actions = documentRef.createElement("div");
    const cancelButton = documentRef.createElement("button");
    const saveButton = documentRef.createElement("button");
    panel.setAttribute("data-quick-note-panel", "true");
    panel.setAttribute(EXTENSION_UI_ATTR, "true");
    panel.style.position = "absolute";
    panel.style.display = "none";
    panel.style.width = "min(320px, calc(100vw - 16px))";
    panel.style.padding = "12px";
    panel.style.borderRadius = "16px";
    panel.style.border = "1px solid rgba(148, 163, 184, 0.24)";
    panel.style.background = "rgba(2, 6, 23, 0.98)";
    panel.style.boxShadow = "0 20px 44px rgba(15, 23, 42, 0.28)";
    panel.style.pointerEvents = "auto";
    panel.style.fontFamily = "Georgia, 'Times New Roman', serif";
    panel.style.display = "grid";
    panel.style.gap = "10px";
    heading.textContent = "New note";
    heading.style.margin = "0";
    heading.style.color = "#f8fafc";
    heading.style.fontSize = "14px";
    heading.style.fontWeight = "600";
    textarea.value = "";
    textarea.rows = 5;
    textarea.placeholder = "Add a note about this highlight";
    textarea.setAttribute("data-quick-note-input", "true");
    textarea.style.width = "100%";
    textarea.style.resize = "vertical";
    textarea.style.padding = "12px";
    textarea.style.borderRadius = "12px";
    textarea.style.border = "1px solid rgba(148, 163, 184, 0.22)";
    textarea.style.background = "rgba(15, 23, 42, 0.72)";
    textarea.style.color = "#f8fafc";
    textarea.style.fontFamily = "inherit";
    textarea.style.fontSize = "13px";
    textarea.style.lineHeight = "1.45";
    feedback.style.margin = "0";
    feedback.style.minHeight = "16px";
    feedback.style.fontSize = "12px";
    feedback.style.lineHeight = "1.35";
    feedback.style.color = "#94a3b8";
    actions.style.display = "flex";
    actions.style.justifyContent = "flex-end";
    actions.style.gap = "8px";
    for (const button of [cancelButton, saveButton]) {
        button.type = "button";
        button.style.padding = "8px 12px";
        button.style.borderRadius = "999px";
        button.style.border = "1px solid rgba(148, 163, 184, 0.24)";
        button.style.color = "#f8fafc";
        button.style.cursor = "pointer";
    }
    cancelButton.textContent = "Cancel";
    cancelButton.style.background = "rgba(15, 23, 42, 0.72)";
    saveButton.textContent = "Save note";
    saveButton.setAttribute("data-quick-note-save", "true");
    saveButton.style.background = "rgba(14, 165, 233, 0.2)";
    actions.append(cancelButton, saveButton);
    panel.append(heading, preview.root, textarea, feedback, actions);
    host.appendChild(panel);
    let visible = false;
    let state = {
        status: "closed",
        noteText: "",
        errorMessage: "",
        selectionRect: null,
    };
    function ensureMounted() {
        if (host.parentNode || host.parentElement) {
            return;
        }
        (documentRef.body || documentRef.documentElement)?.appendChild(host);
    }
    function updatePosition(rect) {
        const panelRect = typeof panel.getBoundingClientRect === "function"
            ? panel.getBoundingClientRect()
            : { width: 320, height: 260 };
        const position = (0, position_ts_1.computePillPosition)({
            rect,
            viewportWidth: Number(windowRef?.innerWidth || 1024),
            viewportHeight: Number(windowRef?.innerHeight || 768),
            panelWidth: Number(panelRect?.width || 320),
            panelHeight: Number(panelRect?.height || 260),
        });
        panel.style.left = `${position.left}px`;
        panel.style.top = `${position.top}px`;
    }
    function render(viewModel = {}) {
        state = {
            ...state,
            status: viewModel.status || state.status,
            noteText: typeof viewModel.noteText === "string" ? viewModel.noteText : state.noteText,
            errorMessage: viewModel.errorMessage || "",
            selectionRect: viewModel.selectionRect || state.selectionRect,
        };
        ensureMounted();
        host.style.display = visible ? "block" : "none";
        panel.style.display = visible ? "grid" : "none";
        textarea.value = state.noteText;
        preview.render({
            text: viewModel.selectionText,
            pageTitle: viewModel.pageTitle,
            pageUrl: viewModel.pageUrl,
        });
        if (state.selectionRect) {
            updatePosition(state.selectionRect);
        }
        const saving = state.status === "saving";
        setDisabled(textarea, saving);
        setDisabled(cancelButton, saving);
        setDisabled(saveButton, saving || !String(state.noteText || "").trim());
        saveButton.textContent = saving ? "Saving" : "Save note";
        if (state.status === "error") {
            feedback.textContent = state.errorMessage || "Save failed.";
            feedback.style.color = "#fca5a5";
        }
        else if (state.status === "success") {
            feedback.textContent = "Note saved.";
            feedback.style.color = "#86efac";
        }
        else if (saving) {
            feedback.textContent = "Saving note...";
            feedback.style.color = "#93c5fd";
        }
        else {
            feedback.textContent = "";
            feedback.style.color = "#94a3b8";
        }
    }
    textarea.addEventListener("input", () => {
        onInput?.(textarea.value);
    });
    textarea.addEventListener("keydown", (event) => {
        if ((event?.ctrlKey || event?.metaKey) && String(event?.key || "").toLowerCase() === "enter") {
            event.preventDefault?.();
            void onSave?.();
            return;
        }
        if (String(event?.key || "").toLowerCase() === "escape") {
            event.preventDefault?.();
            onCancel?.();
        }
    });
    cancelButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        onCancel?.();
    });
    saveButton.addEventListener("click", (event) => {
        event.preventDefault?.();
        event.stopPropagation?.();
        void onSave?.();
    });
    panel.addEventListener("click", (event) => {
        event.stopPropagation?.();
    });
    return {
        host,
        panel,
        textarea,
        show(viewModel = {}) {
            visible = true;
            render(viewModel);
        },
        hide() {
            visible = false;
            state = {
                status: "closed",
                noteText: state.noteText,
                errorMessage: "",
                selectionRect: state.selectionRect,
            };
            host.style.display = "none";
            panel.style.display = "none";
        },
        render,
        isVisible() {
            return visible;
        },
        isInsidePanel(target) {
            let current = target || null;
            while (current) {
                if (current === host || current === panel) {
                    return true;
                }
                if (typeof current.getAttribute === "function" && current.getAttribute(EXTENSION_UI_ATTR) === "true") {
                    return true;
                }
                current = current.parentNode || current.parentElement || null;
            }
            return false;
        },
        getState() {
            return {
                visible,
                ...state,
            };
        },
        focusInput() {
            textarea.focus?.();
        },
        destroy() {
            host.remove?.();
        },
    };
}

},
"content/ui/toast.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createContentToastController = createContentToastController;
const HOST_ATTR = "data-writior-toast-host";
const EXTENSION_UI_ATTR = "data-writior-extension-ui";
function createContentToastController({ documentRef = globalThis.document, windowRef = globalThis.window, } = {}) {
    let host = null;
    let timer = null;
    function ensureHost() {
        if (host) {
            return host;
        }
        if (!documentRef?.body) {
            return null;
        }
        host = documentRef.createElement("div");
        host.setAttribute(HOST_ATTR, "true");
        host.setAttribute(EXTENSION_UI_ATTR, "true");
        host.style.position = "fixed";
        host.style.right = "12px";
        host.style.bottom = "12px";
        host.style.zIndex = "2147483647";
        host.style.pointerEvents = "none";
        host.style.fontFamily = "Georgia, 'Times New Roman', serif";
        documentRef.body.appendChild(host);
        return host;
    }
    function hide() {
        if (timer) {
            windowRef?.clearTimeout?.(timer);
            timer = null;
        }
        if (host) {
            host.innerHTML = "";
        }
    }
    function show(message, { duration = 1400 } = {}) {
        const target = ensureHost();
        if (!target) {
            return { visible: false };
        }
        hide();
        const bubble = documentRef.createElement("div");
        bubble.setAttribute(EXTENSION_UI_ATTR, "true");
        bubble.textContent = message;
        bubble.style.background = "rgba(15, 23, 42, 0.96)";
        bubble.style.color = "#f8fafc";
        bubble.style.border = "1px solid rgba(148, 163, 184, 0.22)";
        bubble.style.borderRadius = "999px";
        bubble.style.padding = "7px 10px";
        bubble.style.fontSize = "12px";
        bubble.style.boxShadow = "0 10px 24px rgba(15, 23, 42, 0.22)";
        target.appendChild(bubble);
        timer = windowRef?.setTimeout?.(() => hide(), duration) || null;
        return { visible: true };
    }
    return {
        show,
        hide,
        destroy() {
            hide();
            host?.remove?.();
            host = null;
        },
    };
}

},
"content/selection/index.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSelectionRuntime = createSelectionRuntime;
const context_ts_1 = require("./context.ts");
const extraction_ts_1 = require("./extraction.ts");
const page_metadata_ts_1 = require("./page_metadata.ts");
const selection_action_pill_ts_1 = require("../ui/selection_action_pill.ts");
const citation_modal_host_ts_1 = require("../ui/citation_modal_host.ts");
const quick_note_panel_ts_1 = require("../ui/quick_note_panel.ts");
const toast_ts_1 = require("../ui/toast.ts");
const citation_ts_1 = require("../../shared/types/citation.ts");
const contracts_ts_1 = require("../../shared/types/contracts.ts");
const runtime_client_ts_1 = require("../../shared/utils/runtime_client.ts");
function isCommandShortcut(event) {
    return Boolean(event?.shiftKey && (event?.ctrlKey || event?.metaKey));
}
function describeCaptureFailure(result) {
    const code = result?.error?.code || "";
    if (code === "invalid_context") {
        return "Extension updated. Reload page.";
    }
    if (code === "unauthorized" || code === "auth_invalid") {
        return "Sign in required";
    }
    return result?.error?.message || "Save failed";
}
async function copyTextToClipboard(text, { navigatorRef, documentRef }) {
    const value = String(text || "");
    try {
        if (navigatorRef?.clipboard?.writeText) {
            await navigatorRef.clipboard.writeText(value);
            return { ok: true, method: "clipboard" };
        }
    }
    catch { }
    try {
        if (typeof documentRef?.execCommand === "function") {
            const body = documentRef?.body || documentRef?.documentElement;
            const activeElement = documentRef?.activeElement || null;
            const textarea = typeof documentRef?.createElement === "function"
                ? documentRef.createElement("textarea")
                : null;
            if (body && textarea) {
                const handleCopy = (event) => {
                    event?.stopImmediatePropagation?.();
                    event?.preventDefault?.();
                    event?.clipboardData?.setData?.("text/plain", value);
                };
                textarea.value = value;
                textarea.setAttribute("readonly", "true");
                textarea.setAttribute("aria-hidden", "true");
                textarea.style.position = "fixed";
                textarea.style.top = "0";
                textarea.style.left = "-9999px";
                textarea.style.opacity = "0";
                body.appendChild(textarea);
                textarea.focus?.();
                textarea.select?.();
                documentRef?.addEventListener?.("copy", handleCopy, true);
                const ok = documentRef.execCommand("copy");
                documentRef?.removeEventListener?.("copy", handleCopy, true);
                textarea.remove?.();
                activeElement?.focus?.();
                if (ok) {
                    return { ok: true, method: "execCommand" };
                }
            }
        }
    }
    catch { }
    return { ok: false, method: "none" };
}
function createSelectionRuntime({ documentRef = globalThis.document, windowRef = globalThis.window, MutationObserverRef = globalThis.MutationObserver, navigatorRef = globalThis.navigator, chromeApi = globalThis.chrome, runtimeClientFactory = runtime_client_ts_1.createRuntimeClient, setTimeoutRef = globalThis.setTimeout?.bind(globalThis), clearTimeoutRef = globalThis.clearTimeout?.bind(globalThis), minimumLength = 3, } = {}) {
    const toast = (0, toast_ts_1.createContentToastController)({ documentRef, windowRef });
    const runtimeClient = chromeApi?.runtime?.sendMessage
        ? runtimeClientFactory(chromeApi, contracts_ts_1.SURFACE_NAMES.CONTENT)
        : null;
    const state = {
        enabled: false,
        isPointerSelecting: false,
        visible: false,
        inspectCount: 0,
        renderCount: 0,
        dismissCount: 0,
        lastDismissReason: "",
        pendingAction: "",
        currentSnapshot: null,
        currentSignature: "",
        noteStatus: "closed",
        noteText: "",
        noteError: "",
        citationModalSnapshot: null,
    };
    const listeners = [];
    const pill = (0, selection_action_pill_ts_1.createSelectionActionPill)({
        documentRef,
        windowRef,
        onAction: async (action) => {
            await runAction(action);
        },
        onDismiss: (reason) => {
            state.lastDismissReason = reason;
        },
    });
    const quickNotePanel = (0, quick_note_panel_ts_1.createQuickNotePanel)({
        documentRef,
        windowRef,
        onInput: (value) => {
            state.noteText = value;
            state.noteStatus = "editing";
            state.noteError = "";
            renderQuickNotePanel();
        },
        onCancel: () => {
            closeQuickNotePanel("cancel");
        },
        onSave: async () => {
            await saveQuickNote();
        },
    });
    const citationModal = (0, citation_modal_host_ts_1.createCitationModalHost)({
        documentRef,
        navigatorRef,
        onRequestRender: async (payload) => runtimeClient?.renderCitation(payload),
        onSave: async (payload) => runtimeClient?.saveCitation(payload),
        onDismiss: () => {
            closeCitationModal("dismiss");
        },
    });
    let observer = null;
    let inspectTimer = null;
    let noteSuccessTimer = null;
    function addListener(target, type, handler, options = true) {
        if (!target?.addEventListener) {
            return;
        }
        target.addEventListener(type, handler, options);
        listeners.push(() => target.removeEventListener?.(type, handler, options));
    }
    function buildSelectionActions() {
        return [
            { key: "copy", label: "Copy", active: true, locked: false },
            { key: "cite", label: "Cite", active: Boolean(runtimeClient), locked: false },
            { key: "quote", label: "Quote", active: Boolean(runtimeClient), locked: false },
            { key: "note", label: "Note", active: Boolean(runtimeClient), locked: false },
        ];
    }
    function hide(reason = "dismiss") {
        const wasVisible = state.visible;
        state.visible = false;
        state.currentSnapshot = null;
        state.currentSignature = "";
        state.pendingAction = "";
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        state.noteStatus = "closed";
        state.noteText = "";
        state.noteError = "";
        state.citationModalSnapshot = null;
        quickNotePanel.hide();
        citationModal.hide();
        if (wasVisible) {
            state.dismissCount += 1;
        }
        pill.hide(reason);
    }
    function show(snapshot) {
        const signature = (0, extraction_ts_1.selectionSignature)(snapshot?.selection);
        state.visible = true;
        state.currentSnapshot = snapshot;
        if (!state.currentSignature) {
            state.renderCount += 1;
        }
        state.currentSignature = signature;
        pill.render({
            ...snapshot,
            actions: buildSelectionActions(),
        });
    }
    function inspectSelection() {
        if (citationModal.isVisible() && state.currentSnapshot) {
            return state.currentSnapshot;
        }
        if (quickNotePanel.isVisible() && state.currentSnapshot) {
            renderQuickNotePanel();
            return state.currentSnapshot;
        }
        state.inspectCount += 1;
        const selection = (0, extraction_ts_1.extractNormalizedSelection)({ documentRef, minimumLength });
        if (!selection) {
            hide("selection_invalid");
            return null;
        }
        const signature = (0, extraction_ts_1.selectionSignature)(selection);
        const page = (0, page_metadata_ts_1.extractPageMetadata)({ documentRef, windowRef });
        const snapshot = {
            selection,
            page,
            ui: {
                pill: true,
                status: "copy_only",
            },
            payload: (0, context_ts_1.buildSelectionContextPayload)({ selection, page }),
        };
        if (state.currentSignature === signature && state.visible) {
            state.currentSnapshot = snapshot;
            pill.render({
                ...snapshot,
                actions: buildSelectionActions(),
            });
            return state.currentSnapshot;
        }
        show(snapshot);
        return state.currentSnapshot;
    }
    async function resolveLockedCitationStyles() {
        if (!runtimeClient?.authStatusGet) {
            return [];
        }
        const result = await runtimeClient.authStatusGet();
        const allowedStyles = result?.ok
            ? result.data?.auth?.bootstrap?.capabilities?.citation_styles
            : null;
        return (0, citation_ts_1.getLockedCitationStyles)(allowedStyles);
    }
    function renderCitationModal(snapshot = state.citationModalSnapshot) {
        if (!snapshot) {
            return;
        }
        state.citationModalSnapshot = snapshot;
        citationModal.render(snapshot);
    }
    function closeCitationModal(reason = "citation_closed") {
        state.citationModalSnapshot = null;
        citationModal.hide();
        if (state.currentSnapshot) {
            pill.render({
                ...state.currentSnapshot,
                actions: buildSelectionActions(),
            });
            state.visible = true;
        }
        else {
            pill.hide(reason);
        }
    }
    function scheduleInspect(delay = 30) {
        if (state.isPointerSelecting) {
            return;
        }
        if (inspectTimer) {
            return;
        }
        inspectTimer = setTimeoutRef?.(() => {
            inspectTimer = null;
            inspectSelection();
        }, delay) || null;
    }
    function renderQuickNotePanel() {
        if (!state.currentSnapshot) {
            return;
        }
        const capture = state.currentSnapshot.payload?.capture || {};
        quickNotePanel.render({
            selectionText: capture.selectionText,
            pageTitle: capture.pageTitle,
            pageUrl: capture.pageUrl,
            selectionRect: state.currentSnapshot.selection?.rect || null,
            noteText: state.noteText,
            status: state.noteStatus,
            errorMessage: state.noteError,
        });
    }
    function openQuickNotePanel() {
        if (!runtimeClient || !state.currentSnapshot?.payload?.capture) {
            pill.flash("Failed");
            toast.show("Capture unavailable");
            return { ok: false, error: { code: "capture_unavailable" } };
        }
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        state.noteStatus = "editing";
        state.noteText = "";
        state.noteError = "";
        pill.hide("note_open");
        quickNotePanel.show({
            selectionText: state.currentSnapshot.payload.capture.selectionText,
            pageTitle: state.currentSnapshot.payload.capture.pageTitle,
            pageUrl: state.currentSnapshot.payload.capture.pageUrl,
            selectionRect: state.currentSnapshot.selection?.rect || null,
            noteText: state.noteText,
            status: state.noteStatus,
            errorMessage: state.noteError,
        });
        quickNotePanel.focusInput();
        return { ok: true };
    }
    function closeQuickNotePanel(reason = "note_closed") {
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        state.noteStatus = "closed";
        state.noteText = "";
        state.noteError = "";
        quickNotePanel.hide();
        if (state.currentSnapshot) {
            pill.render({
                ...state.currentSnapshot,
                actions: buildSelectionActions(),
            });
            state.visible = true;
        }
        else {
            pill.hide(reason);
        }
    }
    async function saveQuickNote() {
        if (!runtimeClient || !state.currentSnapshot?.payload?.capture) {
            state.noteStatus = "error";
            state.noteError = "Capture unavailable";
            renderQuickNotePanel();
            return { ok: false, error: { code: "capture_unavailable" } };
        }
        if (state.pendingAction) {
            return { ok: false, error: { code: "capture_pending" } };
        }
        const noteText = String(state.noteText || "").trim();
        if (!noteText) {
            state.noteStatus = "error";
            state.noteError = "Note text is required.";
            renderQuickNotePanel();
            return { ok: false, error: { code: "invalid_note_text" } };
        }
        state.pendingAction = "note";
        state.noteStatus = "saving";
        state.noteError = "";
        renderQuickNotePanel();
        try {
            const result = await runtimeClient.createNote({
                ...state.currentSnapshot.payload,
                noteText,
            });
            if (result?.ok) {
                state.noteStatus = "success";
                state.noteError = "";
                renderQuickNotePanel();
                toast.show("Note saved");
                noteSuccessTimer = setTimeoutRef?.(() => {
                    noteSuccessTimer = null;
                    closeQuickNotePanel("note_saved");
                    hide("note_saved");
                }, 900) || null;
                return result;
            }
            state.noteStatus = "error";
            state.noteError = describeCaptureFailure(result);
            renderQuickNotePanel();
            toast.show(state.noteError);
            return result;
        }
        finally {
            state.pendingAction = "";
        }
    }
    async function runAction(action) {
        if (action === "copy") {
            if (!state.currentSnapshot?.selection?.text) {
                return { ok: false, error: { code: "invalid_selection" } };
            }
            const result = await copyTextToClipboard(state.currentSnapshot.selection.text, { navigatorRef, documentRef });
            if (result.ok) {
                pill.setCopySuccess();
                toast.show("Copied");
                return result;
            }
            pill.setCopyFailure();
            toast.show("Copy failed");
            return result;
        }
        if (action === "note") {
            return openQuickNotePanel();
        }
        if (action === "cite") {
            if (!runtimeClient || !state.currentSnapshot?.payload?.capture) {
                pill.flash("Failed");
                toast.show("Capture unavailable");
                return { ok: false, error: { code: "capture_unavailable" } };
            }
            if (state.pendingAction) {
                return { ok: false, error: { code: "capture_pending" } };
            }
            state.pendingAction = action;
            pill.hide("citation_modal_open");
            state.citationModalSnapshot = {
                citation: null,
                render_bundle: null,
                selected_style: "apa",
                selected_format: "bibliography",
                locked_styles: [],
                loading: true,
                error: null,
            };
            renderCitationModal();
            try {
                const [captureResultRaw, lockedStyles] = await Promise.all([
                    runtimeClient.createCitation(state.currentSnapshot.payload),
                    resolveLockedCitationStyles(),
                ]);
                const captureResult = captureResultRaw;
                if (!captureResult?.ok) {
                    state.citationModalSnapshot = {
                        ...state.citationModalSnapshot,
                        loading: false,
                        error: captureResult?.error || { code: "citation_error", message: "Citation capture failed." },
                        locked_styles: lockedStyles,
                    };
                    renderCitationModal();
                    return captureResult;
                }
                const citation = captureResult.data;
                const selectedStyle = String(citation?.style || "apa").trim().toLowerCase() || "apa";
                const selectedFormat = "bibliography";
                state.citationModalSnapshot = {
                    citation,
                    render_bundle: null,
                    selected_style: selectedStyle,
                    selected_format: selectedFormat,
                    locked_styles: lockedStyles,
                    loading: false,
                    error: null,
                };
                renderCitationModal();
                if (!citationModal.getState()?.text && citation?.id) {
                    state.citationModalSnapshot = {
                        ...state.citationModalSnapshot,
                        loading: true,
                    };
                    renderCitationModal();
                    const renderResult = await runtimeClient.renderCitation({
                        citationId: citation.id,
                        style: selectedStyle,
                    });
                    state.citationModalSnapshot = {
                        ...state.citationModalSnapshot,
                        loading: false,
                        render_bundle: renderResult?.ok ? renderResult.data : null,
                        error: renderResult?.ok ? null : renderResult?.error || { code: "citation_error", message: "Citation preview failed." },
                    };
                    renderCitationModal();
                    return renderResult?.ok ? captureResult : renderResult;
                }
                return captureResult;
            }
            finally {
                state.pendingAction = "";
            }
        }
        if (!runtimeClient || !state.currentSnapshot?.payload?.capture) {
            pill.flash("Failed");
            toast.show("Capture unavailable");
            return { ok: false, error: { code: "capture_unavailable" } };
        }
        if (state.pendingAction) {
            return { ok: false, error: { code: "capture_pending" } };
        }
        state.pendingAction = action;
        pill.flash("Saving", 0);
        try {
            const payload = state.currentSnapshot.payload;
            const result = action === "cite"
                ? await runtimeClient.createCitation(payload)
                : action === "quote"
                    ? await runtimeClient.createQuote(payload)
                    : { ok: false, error: { message: "Unsupported action." } };
            if (result?.ok) {
                pill.flash("Saved");
                toast.show(action === "cite" ? "Citation saved" : "Quote saved");
                return result;
            }
            pill.flash("Failed");
            toast.show(describeCaptureFailure(result));
            return result;
        }
        finally {
            state.pendingAction = "";
        }
    }
    function onKeydown(event) {
        if (citationModal.isVisible()) {
            if (String(event?.key || "").toLowerCase() === "escape") {
                closeCitationModal("escape");
            }
            return;
        }
        if (quickNotePanel.isVisible()) {
            if (String(event?.key || "").toLowerCase() === "escape") {
                closeQuickNotePanel("escape");
            }
            return;
        }
        if (!state.visible) {
            return;
        }
        if (String(event?.key || "").toLowerCase() === "escape") {
            hide("escape");
            return;
        }
        if (!isCommandShortcut(event)) {
            return;
        }
        const key = String(event?.key || "").toLowerCase();
        if (key !== "c") {
            return;
        }
        event.preventDefault?.();
        void runAction("copy");
    }
    function onPointerDown(event) {
        state.isPointerSelecting = true;
        if (citationModal.isVisible()) {
            if (citationModal.isInside(event?.target)) {
                return;
            }
            closeCitationModal("outside_click");
            return;
        }
        if (quickNotePanel.isVisible()) {
            if (quickNotePanel.isInsidePanel(event?.target)) {
                return;
            }
            closeQuickNotePanel("outside_click");
            return;
        }
        if (!state.visible) {
            return;
        }
        if (pill.isInsidePill(event?.target)) {
            return;
        }
        hide("outside_click");
    }
    function onPointerUp() {
        state.isPointerSelecting = false;
        scheduleInspect(90);
    }
    function destroy() {
        while (listeners.length) {
            listeners.pop()?.();
        }
        if (observer?.disconnect) {
            observer.disconnect();
        }
        observer = null;
        if (inspectTimer && clearTimeoutRef) {
            clearTimeoutRef(inspectTimer);
            inspectTimer = null;
        }
        if (noteSuccessTimer && clearTimeoutRef) {
            clearTimeoutRef(noteSuccessTimer);
            noteSuccessTimer = null;
        }
        toast.destroy();
        citationModal.destroy();
        quickNotePanel.destroy();
        pill.destroy();
        state.enabled = false;
    }
    function bootstrap() {
        if (state.enabled) {
            return getState();
        }
        state.enabled = true;
        addListener(documentRef, "selectionchange", () => scheduleInspect(90), true);
        addListener(documentRef, "mouseup", onPointerUp, true);
        addListener(documentRef, "pointerup", onPointerUp, true);
        addListener(documentRef, "keyup", () => {
            state.isPointerSelecting = false;
            scheduleInspect(60);
        }, true);
        addListener(documentRef, "keydown", onKeydown, true);
        addListener(documentRef, "pointerdown", onPointerDown, true);
        addListener(documentRef, "mousedown", onPointerDown, true);
        addListener(documentRef, "click", onPointerDown, true);
        addListener(windowRef, "scroll", scheduleInspect, true);
        addListener(windowRef, "resize", scheduleInspect, true);
        if (MutationObserverRef && documentRef?.documentElement) {
            observer = new MutationObserverRef(() => scheduleInspect());
            observer.observe(documentRef.documentElement, {
                subtree: true,
                childList: true,
                attributes: true,
                characterData: true,
            });
        }
        inspectSelection();
        return getState();
    }
    function getState() {
        return {
            enabled: state.enabled,
            visible: state.visible,
            inspectCount: state.inspectCount,
            renderCount: state.renderCount,
            dismissCount: state.dismissCount,
            lastDismissReason: state.lastDismissReason,
            pendingAction: state.pendingAction,
            currentSignature: state.currentSignature,
            currentSnapshot: state.currentSnapshot,
            pill: pill.getState(),
            citationModal: citationModal.getState(),
            quickNotePanel: quickNotePanel.getState(),
        };
    }
    return {
        bootstrap,
        destroy,
        inspectSelection,
        scheduleInspect,
        getState,
        pill,
        citationModal,
        quickNotePanel,
    };
}

},
"content/index.ts": function(module, exports, require) {
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createContentRuntime = createContentRuntime;
exports.bootstrapContent = bootstrapContent;
const runtime_client_ts_1 = require("../shared/utils/runtime_client.ts");
const engine_ts_1 = require("./unlock/engine.ts");
const index_ts_1 = require("./selection/index.ts");
const RUNTIME_KEY = "__WRITIOR_CONTENT_RUNTIME__";
function createContentRuntime(options = {}) {
    const typedOptions = options;
    const windowRef = typedOptions.windowRef || globalThis.window;
    const documentRef = typedOptions.documentRef || globalThis.document;
    const engine = (0, engine_ts_1.createPageUnlockEngine)({
        ...typedOptions,
        windowRef,
        documentRef,
    });
    const selection = (0, index_ts_1.createSelectionRuntime)({
        ...typedOptions,
        windowRef,
        documentRef,
    });
    return {
        bootstrap() {
            return {
                unlockState: engine.bootstrap(),
                selectionState: selection.bootstrap(),
            };
        },
        destroy() {
            selection.destroy();
            engine.destroy();
        },
        getState() {
            const unlockState = engine.getState();
            return {
                ...unlockState,
                unlock: unlockState,
                selection: selection.getState(),
            };
        },
        runtimeClientFactory: runtime_client_ts_1.createRuntimeClient,
        engine,
        selection,
    };
}
function bootstrapContent(options = {}) {
    const typedOptions = options;
    const windowRef = typedOptions.windowRef || globalThis.window;
    const documentRef = typedOptions.documentRef || globalThis.document;
    if (!windowRef || !documentRef) {
        return null;
    }
    const runtimeWindow = windowRef;
    if (!runtimeWindow[RUNTIME_KEY]) {
        runtimeWindow[RUNTIME_KEY] = createContentRuntime({
            ...typedOptions,
            windowRef,
            documentRef,
        });
    }
    const runtime = runtimeWindow[RUNTIME_KEY];
    runtime.bootstrap();
    return runtime;
}
if (typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined") {
    bootstrapContent();
}

}
  };
  const cache = {};

  function dirname(id) {
    const slash = id.lastIndexOf("/");
    return slash === -1 ? "" : id.slice(0, slash);
  }

  function normalize(parts) {
    const output = [];
    for (const part of parts) {
      if (!part || part === ".") {
        continue;
      }
      if (part === "..") {
        output.pop();
        continue;
      }
      output.push(part);
    }
    return output.join("/");
  }

  function resolve(fromId, specifier) {
    if (!specifier.startsWith(".")) {
      return specifier;
    }
    const baseDir = dirname(fromId);
    const raw = normalize((baseDir ? baseDir.split("/") : []).concat(specifier.split("/")));
    const candidates = [raw, raw + ".ts", raw + ".js", raw + "/index.ts", raw + "/index.js"];
    for (const candidate of candidates) {
      if (Object.prototype.hasOwnProperty.call(modules, candidate)) {
        return candidate;
      }
    }
    throw new Error("Unresolved content bundle import: " + specifier + " from " + fromId);
  }

  function executeModule(id) {
    if (cache[id]) {
      return cache[id].exports;
    }
    if (!Object.prototype.hasOwnProperty.call(modules, id)) {
      throw new Error("Unknown content bundle module: " + id);
    }
    const module = { exports: {} };
    cache[id] = module;
    modules[id](module, module.exports, function(specifier) {
      return executeModule(resolve(id, specifier));
    });
    return module.exports;
  }

  executeModule("content/index.ts");
})();

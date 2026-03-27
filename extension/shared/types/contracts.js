// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { MESSAGE_NAMES } from "../constants/message_names.js";
export const MESSAGE_TOPICS = Object.freeze({
    UI: "ui",
    AUTH: "auth",
    BOOTSTRAP: "bootstrap",
    SIDEPANEL: "sidepanel",
    CAPTURE: "capture",
    CITATION: "citation",
    EDITOR: "editor",
});
export const SURFACE_NAMES = Object.freeze({
    POPUP: "popup",
    SIDEPANEL: "sidepanel",
    CONTENT: "content",
    BACKGROUND: "background",
});
export const MESSAGE_CONTRACTS = Object.freeze({
    [MESSAGE_NAMES.PING]: Object.freeze({
        topic: MESSAGE_TOPICS.UI,
        payloadShape: "surface:string, href?:string",
        resultShape: "ack:boolean, surface:string, timestamp:string",
    }),
    [MESSAGE_NAMES.OPEN_SIDEPANEL]: Object.freeze({
        topic: MESSAGE_TOPICS.UI,
        payloadShape: "surface:string",
        resultShape: "opened:boolean, target:string",
    }),
    [MESSAGE_NAMES.AUTH_START]: Object.freeze({
        topic: MESSAGE_TOPICS.AUTH,
        payloadShape: "surface:string, trigger:string, redirectPath?:string",
        resultShape: "auth:AuthState",
    }),
    [MESSAGE_NAMES.AUTH_STATUS_GET]: Object.freeze({
        topic: MESSAGE_TOPICS.AUTH,
        payloadShape: "surface:string",
        resultShape: "auth:AuthState",
    }),
    [MESSAGE_NAMES.AUTH_LOGOUT]: Object.freeze({
        topic: MESSAGE_TOPICS.AUTH,
        payloadShape: "surface:string",
        resultShape: "auth:AuthState",
    }),
    [MESSAGE_NAMES.BOOTSTRAP_FETCH]: Object.freeze({
        topic: MESSAGE_TOPICS.BOOTSTRAP,
        payloadShape: "surface:string",
        resultShape: "auth:AuthState",
    }),
    [MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_CITATIONS]: Object.freeze({
        topic: MESSAGE_TOPICS.SIDEPANEL,
        payloadShape: "surface:string, limit?:number, offset?:number, query?:string",
        resultShape: "items:Citation[]",
    }),
    [MESSAGE_NAMES.SIDEPANEL_LIST_RECENT_NOTES]: Object.freeze({
        topic: MESSAGE_TOPICS.SIDEPANEL,
        payloadShape: "surface:string, limit?:number, offset?:number, query?:string",
        resultShape: "items:Note[]",
    }),
    [MESSAGE_NAMES.SIDEPANEL_OPEN_EDITOR]: Object.freeze({
        topic: MESSAGE_TOPICS.SIDEPANEL,
        payloadShape: "surface:string",
        resultShape: "opened:boolean, destination:string, url:string",
    }),
    [MESSAGE_NAMES.SIDEPANEL_OPEN_DASHBOARD]: Object.freeze({
        topic: MESSAGE_TOPICS.SIDEPANEL,
        payloadShape: "surface:string",
        resultShape: "opened:boolean, destination:string, url:string",
    }),
    [MESSAGE_NAMES.CAPTURE_CREATE_CITATION]: Object.freeze({
        topic: MESSAGE_TOPICS.CAPTURE,
        payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string, canonicalUrl?:string, locator?:object, titleCandidates?:Candidate[], authorCandidates?:Candidate[], dateCandidates?:Candidate[], publisherCandidates?:Candidate[], containerCandidates?:Candidate[], sourceTypeCandidates?:Candidate[], identifiers?:object, extractionEvidence?:object, rawMetadata?:object}, excerpt?:string, locator?:object, annotation?:string, quote?:string",
        resultShape: "citation:canonical backend response",
    }),
    [MESSAGE_NAMES.CAPTURE_CREATE_QUOTE]: Object.freeze({
        topic: MESSAGE_TOPICS.CAPTURE,
        payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string, canonicalUrl?:string, locator?:object, titleCandidates?:Candidate[], authorCandidates?:Candidate[], dateCandidates?:Candidate[], publisherCandidates?:Candidate[], containerCandidates?:Candidate[], sourceTypeCandidates?:Candidate[], identifiers?:object, extractionEvidence?:object, rawMetadata?:object}, locator?:object, annotation?:string",
        resultShape: "quote:canonical backend response",
    }),
    [MESSAGE_NAMES.CAPTURE_CREATE_NOTE]: Object.freeze({
        topic: MESSAGE_TOPICS.CAPTURE,
        payloadShape: "surface:string, noteText?:string, capture?:{selectionText?:string, pageTitle?:string, pageUrl?:string, pageDomain?:string}",
        resultShape: "note:canonical backend response",
    }),
    [MESSAGE_NAMES.CITATION_PREVIEW]: Object.freeze({
        topic: MESSAGE_TOPICS.CITATION,
        payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string, canonicalUrl?:string, locator?:object, titleCandidates?:Candidate[], authorCandidates?:Candidate[], dateCandidates?:Candidate[], publisherCandidates?:Candidate[], containerCandidates?:Candidate[], sourceTypeCandidates?:Candidate[], identifiers?:object, extractionEvidence?:object, rawMetadata?:object}, excerpt?:string, locator?:object, annotation?:string, quote?:string, style:string",
        resultShape: "citation:{id:null, renders:...}, render_bundle:{renders:{...quote_attribution:string}}",
    }),
    [MESSAGE_NAMES.CITATION_RENDER]: Object.freeze({
        topic: MESSAGE_TOPICS.CITATION,
        payloadShape: "surface:string, citationId:string, style:string",
        resultShape: "renders:{apa|mla|chicago|harvard:{inline|footnote|bibliography:string}}",
    }),
    [MESSAGE_NAMES.CITATION_SAVE]: Object.freeze({
        topic: MESSAGE_TOPICS.CITATION,
        payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string, canonicalUrl?:string, locator?:object, titleCandidates?:Candidate[], authorCandidates?:Candidate[], dateCandidates?:Candidate[], publisherCandidates?:Candidate[], containerCandidates?:Candidate[], sourceTypeCandidates?:Candidate[], identifiers?:object, extractionEvidence?:object, rawMetadata?:object}, excerpt?:string, locator?:object, annotation?:string, quote?:string, style:string, format:string",
        resultShape: "citation:canonical backend response",
    }),
    [MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST]: Object.freeze({
        topic: MESSAGE_TOPICS.EDITOR,
        payloadShape: "surface:string, url:string, title?:string, selected_text?:string, citation_format?:string, citation_text?:string, extraction_payload?:ExtractionPayload, metadata?:object, locator?:object, project_id?:string, document_title?:string, note?:object, idempotency_key?:string",
        resultShape: "opened:boolean, destination:string, url:string",
    }),
});

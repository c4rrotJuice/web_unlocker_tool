import { MESSAGE_NAMES } from "../constants/message_names.ts";

export const MESSAGE_TOPICS = Object.freeze({
  UI: "ui",
  AUTH: "auth",
  BOOTSTRAP: "bootstrap",
  CAPTURE: "capture",
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
  [MESSAGE_NAMES.CAPTURE_CREATE_CITATION]: Object.freeze({
    topic: MESSAGE_TOPICS.CAPTURE,
    payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string}",
    resultShape: "citation:canonical backend response",
  }),
  [MESSAGE_NAMES.CAPTURE_CREATE_QUOTE]: Object.freeze({
    topic: MESSAGE_TOPICS.CAPTURE,
    payloadShape: "surface:string, capture:{selectionText:string, pageTitle:string, pageUrl:string, pageDomain?:string}",
    resultShape: "quote:canonical backend response",
  }),
  [MESSAGE_NAMES.CAPTURE_CREATE_NOTE]: Object.freeze({
    topic: MESSAGE_TOPICS.CAPTURE,
    payloadShape: "surface:string, noteText?:string, capture?:{selectionText?:string, pageTitle?:string, pageUrl?:string, pageDomain?:string}",
    resultShape: "note:canonical backend response",
  }),
  [MESSAGE_NAMES.WORK_IN_EDITOR_REQUEST]: Object.freeze({
    topic: MESSAGE_TOPICS.EDITOR,
    payloadShape: "surface:string, sourceId:string",
    resultShape: "phase:string",
  }),
});

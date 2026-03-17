import { MESSAGE_TYPES } from "../shared/messages.js";
import { createIdempotencyKey } from "../shared/models.js";
import { sendRuntimeMessage } from "./runtime_bridge.js";
import { ensureFeedbackRuntime } from "../shared/feedback/feedback_bus_singleton.js";
import { FEEDBACK_EVENTS, STATUS_SCOPES } from "../shared/feedback/feedback_tokens.js";

export function createCapturePill({ overlay, readContext, openComposer }) {
  const feedback = ensureFeedbackRuntime({ mountTarget: document.body });
  let pill = null;

  function position(rect) {
    if (!pill || !rect) return;
    pill.style.top = `${Math.max(12, rect.bottom + 8)}px`;
    pill.style.left = `${Math.max(12, rect.left)}px`;
  }

  async function captureCitation() {
    const context = readContext();
    await sendRuntimeMessage(MESSAGE_TYPES.CAPTURE_CITATION, {
      url: context.metadata.canonical_url || context.metadata.url,
      metadata: context.metadata,
      excerpt: context.selected_text,
      quote: context.selected_text,
      locator: {},
      idempotency_key: createIdempotencyKey("citation"),
    });
  }

  async function captureQuote() {
    const context = readContext();
    const citationLocalId = `citation_${Date.now()}`;
    await sendRuntimeMessage(MESSAGE_TYPES.CAPTURE_CITATION, {
      local_id: citationLocalId,
      url: context.metadata.canonical_url || context.metadata.url,
      metadata: context.metadata,
      excerpt: context.selected_text,
      quote: context.selected_text,
      locator: {},
      idempotency_key: createIdempotencyKey("citation"),
    });
    await sendRuntimeMessage(MESSAGE_TYPES.CAPTURE_QUOTE, {
      citation_local_id: citationLocalId,
      excerpt: context.selected_text,
      locator: {},
      idempotency_key: createIdempotencyKey("quote"),
    });
  }

  async function copyAssist() {
    const context = readContext();
    try {
      await navigator.clipboard.writeText(context.selected_text || "");
      await sendRuntimeMessage(MESSAGE_TYPES.COPY_ASSIST, {
        text: context.selected_text,
        url: context.metadata.canonical_url || context.metadata.url,
      });
      feedback.emitDomainEvent(FEEDBACK_EVENTS.CLIPBOARD_COPY_SUCCEEDED, {
        dedupeKey: "extension-copy-pill",
      });
    } catch (error) {
      feedback.emitDomainEvent(FEEDBACK_EVENTS.CLIPBOARD_COPY_FAILED, {
        dedupeKey: "extension-copy-pill",
        message: error?.message || "Clipboard access was not available.",
      });
    }
  }

  async function workInEditor() {
    const context = readContext();
    feedback.emitDomainEvent(FEEDBACK_EVENTS.HANDOFF_STARTED, {
      scope: STATUS_SCOPES.SHELL_HANDOFF,
      label: "Opening editor…",
    });
    const response = await sendRuntimeMessage(MESSAGE_TYPES.WORK_IN_EDITOR, {
      url: context.metadata.canonical_url || context.metadata.url,
      title: context.metadata.title || "",
      selected_text: context.selected_text,
      metadata: context.metadata,
      locator: {},
      idempotency_key: createIdempotencyKey("editor"),
    });
    if (response?.ok) {
      feedback.emitDomainEvent(FEEDBACK_EVENTS.HANDOFF_COMPLETED, { scope: STATUS_SCOPES.SHELL_HANDOFF });
      return;
    }
    feedback.emitDomainEvent(FEEDBACK_EVENTS.HANDOFF_FAILED, {
      scope: STATUS_SCOPES.SHELL_HANDOFF,
      offline: !!response?.offline,
      message: response?.error || (response?.offline ? "Saved locally for later." : "Unable to open the editor."),
    });
  }

  function ensure() {
    if (pill) return pill;
    pill = document.createElement("div");
    pill.className = "writior-pill";
    pill.innerHTML = `
      <button type="button" data-action="citation">Citation</button>
      <button type="button" data-action="quote">Quote</button>
      <button type="button" data-action="note">Note</button>
      <button type="button" data-action="copy">Copy</button>
      <button type="button" data-action="editor">Editor</button>
    `;
    pill.querySelector('[data-action="citation"]').addEventListener("click", () => void captureCitation());
    pill.querySelector('[data-action="quote"]').addEventListener("click", () => void captureQuote());
    pill.querySelector('[data-action="note"]').addEventListener("click", openComposer);
    pill.querySelector('[data-action="copy"]').addEventListener("click", () => void copyAssist());
    pill.querySelector('[data-action="editor"]').addEventListener("click", () => void workInEditor());
    overlay.root.appendChild(pill);
    return pill;
  }

  return {
    render(context) {
      if (!context.selected_text || !context.rect) {
        pill?.remove();
        pill = null;
        return;
      }
      ensure();
      position(context.rect);
    },
    destroy() {
      pill?.remove();
      pill = null;
    },
  };
}

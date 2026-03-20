import { MESSAGE_TYPES } from "../shared/messages.js";
import { createIdempotencyKey } from "../shared/models.js";
import { sendRuntimeMessage } from "./runtime_bridge.js";
import { copyTextWithFallback } from "./clipboard.js";

function toAuthor(metadata = {}) {
  const raw = String(metadata.author || "").trim();
  if (raw) return raw;
  return metadata.hostname || "Unknown source";
}

function toYear(metadata = {}) {
  const value = String(metadata.published_at || "").trim();
  if (!value) return "n.d.";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "n.d.";
  return String(parsed.getUTCFullYear());
}

function formatCitation(style, metadata, quoteText) {
  const title = metadata.title || "Untitled page";
  const url = metadata.canonical_url || metadata.url || "";
  const author = toAuthor(metadata);
  const year = toYear(metadata);
  const styleName = String(style || "mla").toLowerCase();
  if (styleName === "apa") return `${author}. (${year}). ${title}. ${url}`;
  if (styleName === "chicago") return `${author}. "${title}." ${url}.`;
  if (styleName === "harvard") return `${author} (${year}) ${title}. Available at: ${url}.`;
  return `${author}. "${title}." ${url}.`;
}

export function createCitationPreview({ overlay, readContext, onSaveCitation, onWorkInEditor }) {
  let modal = null;
  let selectedStyle = "mla";

  function close() {
    modal?.remove();
    modal = null;
  }

  function updatePreview() {
    if (!modal) return;
    const context = readContext();
    const preview = modal.querySelector('[data-role="preview"]');
    if (!preview) return;
    preview.textContent = formatCitation(selectedStyle, context.metadata, context.selected_text);
  }

  async function copyCurrentPreview() {
    const context = readContext();
    const text = formatCitation(selectedStyle, context.metadata, context.selected_text);
    const copied = await copyTextWithFallback(text);
    if (!copied.ok) {
      return;
    }
    await sendRuntimeMessage(MESSAGE_TYPES.COPY_ASSIST, {
      text: text,
      url: context.metadata.canonical_url || context.metadata.url,
    });
  }

  async function saveCitation() {
    const context = readContext();
    const text = formatCitation(selectedStyle, context.metadata, context.selected_text);
    await onSaveCitation({
      style: selectedStyle,
      full_citation: text,
      inline_citation: text,
      idempotency_key: createIdempotencyKey("citation"),
    });
  }

  async function workInEditor() {
    const context = readContext();
    const text = formatCitation(selectedStyle, context.metadata, context.selected_text);
    await onWorkInEditor({
      citation_format: selectedStyle,
      citation_text: text,
      idempotency_key: createIdempotencyKey("editor"),
    });
  }

  function open() {
    if (modal) return;
    const context = readContext();
    modal = document.createElement("section");
    modal.className = "writior-cite-preview";
    modal.style.top = `${Math.max(16, (context.rect?.bottom || 72) + 10)}px`;
    modal.style.left = `${Math.max(16, context.rect?.left || 16)}px`;
    modal.innerHTML = `
      <header>
        <h2>Citation preview</h2>
        <button type="button" data-action="close">Close</button>
      </header>
      <div class="writior-segmented">
        <button type="button" data-style="mla" class="is-active">MLA</button>
        <button type="button" data-style="apa">APA</button>
        <button type="button" data-style="chicago">Chicago</button>
        <button type="button" data-style="harvard">Harvard</button>
      </div>
      <pre data-role="preview"></pre>
      <footer class="writior-actions">
        <button type="button" data-action="copy">Copy</button>
        <button type="button" data-action="save">Save citation</button>
        <button type="button" data-action="editor" class="primary">Work in editor</button>
      </footer>
    `;
    modal.querySelector('[data-action="close"]')?.addEventListener("click", close);
    modal.querySelector('[data-action="copy"]')?.addEventListener("click", () => void copyCurrentPreview());
    modal.querySelector('[data-action="save"]')?.addEventListener("click", () => void saveCitation());
    modal.querySelector('[data-action="editor"]')?.addEventListener("click", () => void workInEditor());
    modal.querySelectorAll("[data-style]").forEach((el) => {
      el.addEventListener("click", () => {
        selectedStyle = el.getAttribute("data-style") || "mla";
        modal?.querySelectorAll("[data-style]").forEach((entry) => {
          entry.classList.toggle("is-active", entry === el);
        });
        updatePreview();
      });
    });
    overlay.root.appendChild(modal);
    updatePreview();
  }

  return { open, close };
}

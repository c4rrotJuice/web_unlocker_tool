import { MESSAGE_TYPES } from "../shared/messages.js";
import { createLocalId } from "../shared/models.js";
import { sendRuntimeMessage } from "./runtime_bridge.js";

export function createNoteComposer({ overlay, readContext }) {
  let container = null;

  function close() {
    container?.remove();
    container = null;
  }

  async function save(titleInput, bodyInput) {
    const context = readContext();
    const note = {
      id: createLocalId("note"),
      title: titleInput.value.trim() || "Captured note",
      note_body: bodyInput.value.trim(),
      highlight_text: context.selected_text || null,
      source_url: context.metadata.url,
      source_title: context.metadata.title,
      source_author: context.metadata.author || null,
      source_published_at: context.metadata.published_at || null,
      sources: [{
        url: context.metadata.canonical_url || context.metadata.url,
        title: context.metadata.title,
        hostname: context.metadata.hostname,
        source_author: context.metadata.author || null,
        source_published_at: context.metadata.published_at || null,
      }],
    };
    await sendRuntimeMessage(MESSAGE_TYPES.CAPTURE_NOTE, { note });
    close();
  }

  function open() {
    if (container) return;
    const context = readContext();
    container = document.createElement("section");
    container.className = "writior-note";
    container.style.top = `${Math.max(16, (context.rect?.bottom || 90) + 12)}px`;
    container.style.left = `${Math.max(16, context.rect?.left || 16)}px`;
    container.innerHTML = `
      <h2>Capture note</h2>
      <input type="text" placeholder="Title" />
      <textarea placeholder="Write a quick synthesis note"></textarea>
      <div class="writior-actions">
        <button type="button" data-action="cancel">Cancel</button>
        <button type="button" class="primary" data-action="save">Save</button>
      </div>
    `;
    const titleInput = container.querySelector("input");
    const bodyInput = container.querySelector("textarea");
    const cancelButton = container.querySelector('[data-action="cancel"]');
    const saveButton = container.querySelector('[data-action="save"]');
    cancelButton.addEventListener("click", close);
    saveButton.addEventListener("click", () => void save(titleInput, bodyInput));
    overlay.root.appendChild(container);
    bodyInput.focus();
  }

  return { open, close };
}


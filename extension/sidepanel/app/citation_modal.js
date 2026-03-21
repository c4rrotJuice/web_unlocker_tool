import { MESSAGE_NAMES } from "../../shared/constants/message_names.js";
import { sendRuntimeMessage } from "../../shared/utils/runtime_message.js";
import { CITATION_FORMATS, CITATION_STYLES, normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.js";
import { createCitationStyleTabs } from "../components/citation_style_tabs.js";
import { createCitationFormatTabs } from "../components/citation_format_tabs.js";
import { createCitationPreviewCard } from "../components/citation_preview_card.js";

const FORMAT_TO_FIELD = {
  inline: "inline_citation",
  footnote: "footnote",
  bibliography: "full_citation",
};

function getCitationText(snapshot) {
  const citation = snapshot?.citation || null;
  const renderBundle = snapshot?.render_bundle || null;
  const style = normalizeCitationStyle(snapshot?.selected_style || citation?.style || "apa");
  const format = normalizeCitationFormat(snapshot?.selected_format || citation?.format || "bibliography");

  const styleBundle = renderBundle?.renders?.[style] || null;
  if (styleBundle && typeof styleBundle[format] === "string" && styleBundle[format]) {
    return styleBundle[format];
  }
  if (citation && typeof citation === "object") {
    const directField = FORMAT_TO_FIELD[format];
    if (directField && typeof citation[directField] === "string" && citation[directField]) {
      return citation[directField];
    }
    if (format === "bibliography" && typeof citation.full_text === "string" && citation.full_text) {
      return citation.full_text;
    }
  }
  return "";
}

function hasPreviewFor(snapshot, style, format) {
  const renderBundle = snapshot?.render_bundle || null;
  if (renderBundle?.renders?.[style] && typeof renderBundle.renders[style][format] === "string") {
    return true;
  }
  const citation = snapshot?.citation || null;
  return Boolean(citation && citation.style === style && getCitationText({ ...snapshot, selected_style: style, selected_format: format }));
}

function isLockedStyle(snapshot, style) {
  return Array.isArray(snapshot?.locked_styles) && snapshot.locked_styles.includes(style);
}

function buildRoot(documentRef) {
  const root = documentRef.createElement("section");
  root.setAttribute("data-citation-modal", "true");
  root.style.display = "grid";
  root.style.gap = "16px";
  root.style.padding = "20px";
  root.style.borderRadius = "24px";
  root.style.background = "linear-gradient(180deg, rgba(15,23,42,0.96), rgba(15,23,42,0.9))";
  root.style.color = "#e2e8f0";
  root.style.border = "1px solid rgba(148,163,184,0.16)";
  return root;
}

export function renderCitationModal(root, snapshot, {
  documentRef = globalThis.document,
  chromeApi = globalThis.chrome,
  navigatorRef = globalThis.navigator,
  onRequestRender,
  onSave,
  onDismiss,
} = {}) {
  if (!root) {
    return { mounted: false };
  }

  const state = {
    snapshot,
    loading: Boolean(snapshot?.loading),
    error: snapshot?.error || null,
    selectedStyle: normalizeCitationStyle(snapshot?.selected_style || "apa"),
    selectedFormat: normalizeCitationFormat(snapshot?.selected_format || "bibliography"),
  };

  const wrapper = buildRoot(documentRef);
  wrapper.setAttribute("tabindex", "0");
  wrapper.setAttribute("aria-label", "Citation modal");
  const title = documentRef.createElement("div");
  title.textContent = "Citation";
  title.style.fontSize = "13px";
  title.style.textTransform = "uppercase";
  title.style.letterSpacing = "0.08em";
  title.style.color = "#94a3b8";

  const headline = documentRef.createElement("h2");
  headline.textContent = snapshot?.citation?.metadata?.title || snapshot?.citation?.source?.title || "Citation preview";
  headline.style.margin = "0";
  headline.style.fontSize = "24px";
  headline.style.lineHeight = "1.1";
  headline.style.maxWidth = "100%";
  headline.style.overflowWrap = "anywhere";

  const lockedStyles = CITATION_STYLES.filter((style) => isLockedStyle(snapshot, style));
  const styleTabs = createCitationStyleTabs({
    documentRef,
    selectedStyle: state.selectedStyle,
    lockedStyles,
    onSelect: async (style) => {
      state.selectedStyle = style;
      state.loading = true;
      state.error = null;
      render();
      if (!snapshot?.citation?.id) {
        state.error = { code: "invalid_payload", message: "Missing citation id." };
        state.loading = false;
        render();
        return;
      }
      if (hasPreviewFor(state.snapshot, style, state.selectedFormat)) {
        state.loading = false;
        await onSave?.({ style, format: state.selectedFormat, citation: snapshot.citation });
        render();
        return;
      }
      const response = await onRequestRender?.({ citation_id: snapshot.citation.id, style });
      if (response?.ok) {
        state.snapshot = {
          ...state.snapshot,
          selected_style: style,
          render_bundle: response.data || state.snapshot.render_bundle || null,
        };
        state.loading = false;
        state.error = null;
        await onSave?.({ style, format: state.selectedFormat, citation: snapshot.citation });
      } else {
        state.loading = false;
        state.error = response?.error || { code: "citation_error", message: "Citation preview failed." };
      }
      render();
    },
  });

  const formatTabs = createCitationFormatTabs({
    documentRef,
    selectedFormat: state.selectedFormat,
    onSelect: async (format) => {
      state.selectedFormat = format;
      state.snapshot = {
        ...state.snapshot,
        selected_format: format,
      };
      if (!hasPreviewFor(state.snapshot, state.selectedStyle, format) && state.snapshot?.citation?.id) {
        state.loading = true;
        render();
        const response = await onRequestRender?.({ citation_id: state.snapshot.citation.id, style: state.selectedStyle });
        if (response?.ok) {
          state.snapshot = {
            ...state.snapshot,
            render_bundle: response.data || state.snapshot.render_bundle || null,
          };
          state.error = null;
        } else {
          state.error = response?.error || { code: "citation_error", message: "Citation preview failed." };
        }
        state.loading = false;
      }
      render();
    },
  });

  const previewCard = createCitationPreviewCard({
    documentRef,
    title: "Backend-derived preview",
    text: getCitationText(snapshot),
    loading: state.loading,
    error: state.error,
  });

  const actions = documentRef.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.flexWrap = "wrap";

  const closeButton = documentRef.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.style.padding = "10px 14px";
  closeButton.style.borderRadius = "999px";
  closeButton.style.border = "1px solid rgba(148, 163, 184, 0.28)";
  closeButton.style.background = "rgba(15, 23, 42, 0.7)";
  closeButton.style.color = "#f8fafc";
  closeButton.setAttribute("aria-keyshortcuts", "Escape");
  closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    onDismiss?.();
  });

  const copyButton = documentRef.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy";
  copyButton.style.padding = "10px 14px";
  copyButton.style.borderRadius = "999px";
  copyButton.style.border = "1px solid rgba(148, 163, 184, 0.28)";
  copyButton.style.background = "rgba(59, 130, 246, 0.2)";
  copyButton.style.color = "#f8fafc";
  copyButton.setAttribute("aria-keyshortcuts", "Ctrl+Enter");
  copyButton.addEventListener("click", async (event) => {
    event.preventDefault();
    const text = getCitationText(state.snapshot);
    if (!text) {
      state.error = { code: "invalid_payload", message: "No citation text is available." };
      render();
      return;
    }
    const clipboard = navigatorRef?.clipboard;
    try {
      if (clipboard?.writeText) {
        await clipboard.writeText(text);
      }
      await onSave?.({ style: state.selectedStyle, format: state.selectedFormat, citation: state.snapshot.citation, copy: true });
      copyButton.textContent = "Copied";
      setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1000);
    } catch (error) {
      state.error = { code: "copy_failed", message: error?.message || "Copy failed." };
      render();
    }
  });

  const saveButton = documentRef.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  saveButton.style.padding = "10px 14px";
  saveButton.style.borderRadius = "999px";
  saveButton.style.border = "1px solid rgba(148, 163, 184, 0.28)";
  saveButton.style.background = "rgba(15, 23, 42, 0.7)";
  saveButton.style.color = "#f8fafc";
  saveButton.setAttribute("aria-keyshortcuts", "Ctrl+S");
  saveButton.addEventListener("click", async (event) => {
    event.preventDefault();
    await onSave?.({ style: state.selectedStyle, format: state.selectedFormat, citation: state.snapshot.citation });
  });

  wrapper.addEventListener("keydown", (event) => {
    const key = String(event?.key || "").toLowerCase();
    if (key === "escape") {
      event.preventDefault();
      onDismiss?.();
      return;
    }
    if ((event?.ctrlKey || event?.metaKey) && key === "enter") {
      event.preventDefault();
      copyButton.click();
      return;
    }
    if ((event?.ctrlKey || event?.metaKey) && key === "s") {
      event.preventDefault();
      saveButton.click();
    }
  });

  function render() {
    wrapper.innerHTML = "";
    wrapper.appendChild(title);
    wrapper.appendChild(headline);
    wrapper.appendChild(styleTabs.root);
    wrapper.appendChild(formatTabs.root);
    previewCard.render(getCitationText(state.snapshot), state.loading, state.error);
    wrapper.appendChild(previewCard.root);
    if (state.error) {
      const error = documentRef.createElement("div");
      error.textContent = state.error.message || "Citation preview failed.";
      error.style.color = "#fca5a5";
      wrapper.appendChild(error);
    }
    actions.innerHTML = "";
    actions.appendChild(copyButton);
    actions.appendChild(saveButton);
    actions.appendChild(closeButton);
    wrapper.appendChild(actions);
    root.innerHTML = "";
    root.appendChild(wrapper);
    styleTabs.setSelected(state.selectedStyle);
    formatTabs.setSelected(state.selectedFormat);
  }

  render();

  return {
    mounted: true,
    root,
    render: (nextSnapshot) => {
      if (nextSnapshot) {
        state.snapshot = nextSnapshot;
        state.loading = Boolean(nextSnapshot.loading);
        state.error = nextSnapshot.error || null;
        state.selectedStyle = normalizeCitationStyle(nextSnapshot.selected_style || state.selectedStyle);
        state.selectedFormat = normalizeCitationFormat(nextSnapshot.selected_format || state.selectedFormat);
      }
      render();
      return { mounted: true };
    },
    getState: () => ({
      selectedStyle: state.selectedStyle,
      selectedFormat: state.selectedFormat,
      text: getCitationText(state.snapshot),
      lockedStyles,
      error: state.error,
      loading: state.loading,
      citationId: state.snapshot?.citation?.id || "",
    }),
    destroy: () => {
      root.innerHTML = "";
    },
  };
}

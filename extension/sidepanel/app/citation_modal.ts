import { getCitationPreviewText, normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.ts";
import { createCitationFormatTabs } from "../components/citation_format_tabs.ts";
import { createCitationPreviewCard } from "../components/citation_preview_card.ts";
import { createCitationStyleTabs } from "../components/citation_style_tabs.ts";

function setButtonDisabled(button: any, disabled: boolean) {
  button.disabled = disabled;
  if (disabled) {
    button.setAttribute("aria-disabled", "true");
  } else if (typeof button.removeAttribute === "function") {
    button.removeAttribute("aria-disabled");
  }
}

export function renderCitationModal(root, snapshot: any = {}, options: any = {}) {
  const {
    documentRef = globalThis.document,
    navigatorRef = globalThis.navigator,
    onRequestRender,
    onSave,
    onDismiss,
  } = options;
  if (!root) {
    return { mounted: false };
  }

  const state = {
    citation: snapshot?.citation || null,
    renderBundle: snapshot?.render_bundle || null,
    selectedStyle: normalizeCitationStyle(snapshot?.selected_style || snapshot?.citation?.style || "apa"),
    selectedFormat: normalizeCitationFormat(snapshot?.selected_format || snapshot?.citation?.format || "bibliography"),
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

  const styleTabs = createCitationStyleTabs({
    documentRef,
    selectedStyle: state.selectedStyle,
    lockedStyles: state.lockedStyles,
    onSelect: async (style) => {
      if (style === state.selectedStyle) {
        return;
      }
      state.selectedStyle = normalizeCitationStyle(style);
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
      } else {
        state.loading = false;
        state.error = result?.error || { code: "citation_error", message: "Citation preview failed." };
      }
      render();
    },
  });

  const formatTabs = createCitationFormatTabs({
    documentRef,
    selectedFormat: state.selectedFormat,
    onSelect: async (format) => {
      state.selectedFormat = normalizeCitationFormat(format);
      state.error = null;
      render();
    },
  });

  const previewCard = createCitationPreviewCard({ documentRef });

  function getCurrentText() {
    return getCitationPreviewText({
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

  copyButton.addEventListener("click", async (event: any) => {
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
    } catch (error: any) {
      state.error = { code: "copy_failed", message: error?.message || "Copy failed." };
      render();
      return;
    }
    await saveSelection(true);
  });

  saveButton.addEventListener("click", async (event: any) => {
    event.preventDefault?.();
    await saveSelection(false);
  });

  closeButton.addEventListener("click", (event: any) => {
    event.preventDefault?.();
    onDismiss?.();
  });

  wrapper.addEventListener("keydown", (event: any) => {
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
    } else if (state.saveStatus === "copied") {
      statusLine.textContent = "Citation copied.";
      statusLine.style.color = "#86efac";
    } else if (state.saveStatus === "saved") {
      statusLine.textContent = "Citation saved.";
      statusLine.style.color = "#86efac";
    } else if (state.saveStatus === "copying") {
      statusLine.textContent = "Saving copy action...";
      statusLine.style.color = "#93c5fd";
    } else if (state.saveStatus === "saving") {
      statusLine.textContent = "Saving citation...";
      statusLine.style.color = "#93c5fd";
    } else {
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
    } else {
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

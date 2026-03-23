// GENERATED FILE. DO NOT EDIT. Source of truth: adjacent .ts module.
import { getCitationPreviewText, normalizeCitationFormat, normalizeCitationStyle } from "../../shared/types/citation.js";
import { createCitationFormatTabs } from "../components/citation_format_tabs.js";
import { createCitationPreviewCard } from "../components/citation_preview_card.js";
import { createCitationStyleTabs } from "../components/citation_style_tabs.js";
import { createTierBadge } from "../components/tier_badge.js";
function setButtonDisabled(button, disabled) {
    button.disabled = disabled;
    if (disabled) {
        button.setAttribute("aria-disabled", "true");
    }
    else if (typeof button.removeAttribute === "function") {
        button.removeAttribute("aria-disabled");
    }
}
function normalizeText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}
function summarizeAuthors(source = {}) {
    const authors = Array.isArray(source?.authors) ? source.authors : [];
    const names = authors.map((author) => normalizeText(author?.fullName)).filter(Boolean);
    if (!names.length) {
        return "";
    }
    if (names.length <= 2) {
        return names.join(", ");
    }
    return `${names[0]}, ${names[1]} +${names.length - 2}`;
}
function summarizeIssuedDate(source = {}) {
    const issued = source?.issued_date || source?.issued || {};
    return normalizeText(issued?.raw || issued?.year);
}
function summarizeHostname(source = {}) {
    const direct = normalizeText(source?.hostname);
    if (direct) {
        return direct;
    }
    try {
        return normalizeText(new URL(source?.canonical_url || source?.page_url || "").hostname.replace(/^www\./, ""));
    }
    catch {
        return "";
    }
}
function qualityMessages(source = {}) {
    const quality = source?.quality || {};
    const messages = [];
    if (quality.author_status === "missing") {
        messages.push("Author missing");
    }
    else if (quality.author_status === "organization_fallback") {
        messages.push("Organization fallback");
    }
    if (quality.date_status === "missing") {
        messages.push("Publication date missing");
    }
    if (quality.limited_metadata) {
        messages.push("Limited metadata");
    }
    return messages;
}
function sourceFactRows(source = {}) {
    const identifiers = source?.identifiers || {};
    const rows = [];
    const authors = summarizeAuthors(source);
    const issued = summarizeIssuedDate(source);
    const sourceType = normalizeText(source?.source_type).replace(/_/g, " ");
    const container = normalizeText(source?.container_title);
    const publisher = normalizeText(source?.publisher);
    const doi = normalizeText(identifiers?.doi);
    const hostname = summarizeHostname(source);
    const canonicalUrl = normalizeText(source?.canonical_url || source?.page_url);
    if (authors) {
        rows.push({ label: "Authors", value: authors });
    }
    rows.push({ label: "Source", value: [sourceType, issued].filter(Boolean).join(" • ") || "Web reference" });
    if (container || publisher) {
        rows.push({ label: "Published In", value: [container, publisher].filter(Boolean).join(" • ") });
    }
    if (doi) {
        rows.push({ label: "DOI", value: doi });
    }
    if (canonicalUrl || hostname) {
        rows.push({ label: "Link", value: canonicalUrl || hostname });
    }
    return rows;
}
export function renderCitationModal(root, snapshot = {}, options = {}) {
    const { documentRef = globalThis.document, navigatorRef = globalThis.navigator, onRequestPreview, onRequestRender, onSave, onDismiss, } = options;
    if (!root) {
        return { mounted: false };
    }
    const state = {
        citation: snapshot?.citation || null,
        renderBundle: snapshot?.render_bundle || null,
        draftPayload: snapshot?.draft_payload || null,
        selectedStyle: normalizeCitationStyle(snapshot?.selected_style || snapshot?.citation?.style || "apa"),
        selectedFormat: normalizeCitationFormat(snapshot?.selected_format || snapshot?.citation?.format || "bibliography"),
        lockedStyles: Array.isArray(snapshot?.locked_styles) ? snapshot.locked_styles.slice() : [],
        tier: String(snapshot?.tier || "guest").trim().toLowerCase() || "guest",
        loading: Boolean(snapshot?.loading),
        error: snapshot?.error || null,
        saveStatus: "idle",
    };
    const wrapper = documentRef.createElement("section");
    const title = documentRef.createElement("div");
    const header = documentRef.createElement("div");
    const headline = documentRef.createElement("h2");
    const sourceMeta = documentRef.createElement("p");
    const sourceFacts = documentRef.createElement("div");
    const qualityMeta = documentRef.createElement("p");
    const lockMeta = documentRef.createElement("p");
    const actions = documentRef.createElement("div");
    const copyButton = documentRef.createElement("button");
    const saveButton = documentRef.createElement("button");
    const closeButton = documentRef.createElement("button");
    const statusLine = documentRef.createElement("p");
    const tierBadge = createTierBadge({ documentRef, tier: state.tier });
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
    header.style.display = "flex";
    header.style.justifyContent = "space-between";
    header.style.alignItems = "center";
    header.style.gap = "12px";
    headline.style.margin = "0";
    headline.style.fontSize = "22px";
    headline.style.lineHeight = "1.15";
    headline.style.overflowWrap = "anywhere";
    sourceMeta.style.margin = "0";
    sourceMeta.style.fontSize = "12px";
    sourceMeta.style.lineHeight = "1.5";
    sourceMeta.style.color = "#94a3b8";
    sourceFacts.setAttribute("data-citation-source-facts", "true");
    sourceFacts.style.display = "grid";
    sourceFacts.style.gap = "6px";
    qualityMeta.setAttribute("data-citation-quality", "true");
    qualityMeta.style.margin = "0";
    qualityMeta.style.fontSize = "12px";
    qualityMeta.style.lineHeight = "1.5";
    qualityMeta.style.color = "#cbd5e1";
    lockMeta.style.margin = "0";
    lockMeta.style.fontSize = "12px";
    lockMeta.style.lineHeight = "1.5";
    lockMeta.style.color = "#cbd5e1";
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
        lockLabel: "Locked",
        onSelect: async (style) => {
            if (style === state.selectedStyle) {
                return;
            }
            state.selectedStyle = normalizeCitationStyle(style);
            state.loading = true;
            state.error = null;
            render();
            const result = state.citation?.id
                ? await onRequestRender?.({
                    citationId: state.citation.id,
                    style: state.selectedStyle,
                })
                : await onRequestPreview?.({
                    ...(state.draftPayload || {}),
                    style: state.selectedStyle,
                });
            if (result?.ok) {
                if (!state.citation?.id) {
                    state.citation = result.data?.citation || state.citation;
                    state.renderBundle = result.data?.render_bundle || null;
                }
                else {
                    state.renderBundle = result.data || null;
                }
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
        if (copy) {
            return { ok: true, data: { copied: true } };
        }
        if (state.citation?.id) {
            state.saveStatus = "saved";
            state.error = null;
            render();
            return { ok: true, data: state.citation };
        }
        if (!state.draftPayload) {
            state.error = { code: "invalid_payload", message: "Citation preview is unavailable." };
            render();
            return { ok: false, error: state.error };
        }
        state.saveStatus = "saving";
        render();
        const result = await onSave?.({
            ...state.draftPayload,
            style: state.selectedStyle,
            format: state.selectedFormat,
        });
        if (result?.ok) {
            state.citation = result.data || state.citation;
            state.renderBundle = result?.data?.renders ? { renders: result.data.renders } : state.renderBundle;
            state.saveStatus = "saved";
            state.error = null;
            render();
            return result;
        }
        state.saveStatus = "idle";
        state.error = result?.error || { code: "save_failed", message: "Save failed." };
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
        state.saveStatus = "copied";
        state.error = null;
        render();
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
        const source = state.citation?.source || {};
        tierBadge.setTier(state.tier);
        headline.textContent = state.citation?.metadata?.title || source?.title || "Citation preview";
        sourceMeta.textContent = [
            summarizeAuthors(source) || state.citation?.metadata?.author || source?.publisher || "",
            summarizeHostname(source),
        ].filter(Boolean).join(" • ");
        sourceFacts.innerHTML = "";
        sourceFactRows(source).forEach((row) => {
            const item = documentRef.createElement("div");
            const label = documentRef.createElement("span");
            const value = documentRef.createElement("span");
            item.style.display = "grid";
            item.style.gridTemplateColumns = "92px 1fr";
            item.style.gap = "8px";
            item.style.fontSize = "12px";
            item.style.lineHeight = "1.45";
            label.textContent = row.label;
            label.style.color = "#94a3b8";
            value.textContent = row.value;
            value.style.color = "#e2e8f0";
            value.style.overflowWrap = "anywhere";
            item.appendChild(label);
            item.appendChild(value);
            sourceFacts.appendChild(item);
        });
        qualityMeta.textContent = qualityMessages(source).join(" • ");
        lockMeta.textContent = state.lockedStyles.length
            ? "Some citation styles are locked for this account."
            : "";
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
        actions.appendChild(copyButton);
        actions.appendChild(saveButton);
        actions.appendChild(closeButton);
        wrapper.innerHTML = "";
        header.appendChild(title);
        header.appendChild(tierBadge.root);
        wrapper.appendChild(header);
        wrapper.appendChild(headline);
        wrapper.appendChild(sourceMeta);
        if (sourceFacts.children.length) {
            wrapper.appendChild(sourceFacts);
        }
        if (qualityMeta.textContent) {
            wrapper.appendChild(qualityMeta);
        }
        wrapper.appendChild(lockMeta);
        wrapper.appendChild(styleTabs.root);
        wrapper.appendChild(formatTabs.root);
        wrapper.appendChild(previewCard.root);
        wrapper.appendChild(statusLine);
        wrapper.appendChild(actions);
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
                citation: state.citation,
            };
        },
    };
}

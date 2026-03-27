import test from "node:test";
import assert from "node:assert/strict";

import { createCaptureHandler } from "../extension/background/handlers/capture_handler.js";
import { createCitationHandler } from "../extension/background/handlers/citation_handler.js";

function createRichCapture() {
  return {
    selectionText: "Selected sentence",
    pageTitle: "Structured Source Title",
    pageUrl: "https://example.com/articles/structured",
    pageDomain: "example.com",
    canonicalUrl: "https://example.com/articles/structured",
    description: "A detailed description",
    language: "en",
    siteName: "Example Journal",
    titleCandidates: [{ value: "Structured Source Title", confidence: 0.95, source: "meta:name:citation_title" }],
    authorCandidates: [{ value: "Ada Lovelace", confidence: 0.92, source: "meta:name:author" }],
    dateCandidates: [{ value: "2024-02-03", confidence: 0.9, source: "meta:property:article:published_time" }],
    publisherCandidates: [{ value: "Example Press", confidence: 0.8, source: "meta:property:og:site_name" }],
    containerCandidates: [{ value: "Journal of Analytical Engines", confidence: 0.88, source: "meta:name:citation_journal_title" }],
    sourceTypeCandidates: [{ value: "scholarlyarticle", confidence: 0.85, source: "jsonld:scholarlyarticle" }],
    identifiers: { doi: "10.1000/example-doi", issn: "1234-5678" },
    locator: { paragraph: 4, section: "Methods" },
    extractionEvidence: {
      meta_tags: {
        authors: [{ value: "Ada Lovelace", source: "meta:name:author", key: "author" }],
      },
      json_ld: [{ source: "jsonld:scholarlyarticle", types: ["scholarlyarticle"] }],
    },
    rawMetadata: {
      title: "Structured Source Title",
      site_name: "Example Journal",
      custom_flag: "preserved",
    },
  };
}

test("background preview and save preserve identical rich extraction payloads", async () => {
  const calls = [];
  const citationHandler = createCitationHandler({
    citationApi: {
      async previewCitation(payload) {
        calls.push({ kind: "preview", payload });
        return {
          ok: true,
          status: "ok",
          data: {
            citation: {
              id: null,
              source_id: null,
              source: { title: "Structured Source Title" },
              locator: {},
              annotation: null,
              excerpt: "Selected sentence",
              quote_text: "Selected sentence",
              renders: {
                mla: {
                  inline: "(Lovelace)",
                  bibliography: "Lovelace. Structured Source Title.",
                  footnote: "Lovelace, Structured Source Title.",
                  quote_attribution: "\"Selected sentence\" (Lovelace)",
                },
              },
            },
            render_bundle: {
              renders: {
                mla: {
                  inline: "(Lovelace)",
                  bibliography: "Lovelace. Structured Source Title.",
                  footnote: "Lovelace, Structured Source Title.",
                  quote_attribution: "\"Selected sentence\" (Lovelace)",
                },
              },
              cache_hit: false,
            },
            selected_style: "mla",
          },
        };
      },
      async saveCitation(payload) {
        calls.push({ kind: "save", payload });
        return {
          ok: true,
          status: "ok",
          data: {
            id: "citation-1",
            source_id: "source-1",
            source: { id: "source-1", title: "Structured Source Title" },
            locator: {},
            annotation: null,
            excerpt: "Selected sentence",
            quote_text: "Selected sentence",
            renders: {
              mla: {
                inline: "(Lovelace)",
                bibliography: "Lovelace. Structured Source Title.",
                footnote: "Lovelace, Structured Source Title.",
                quote_attribution: "\"Selected sentence\" (Lovelace)",
              },
            },
            relationship_counts: {},
          },
        };
      },
    },
    citationStateStore: {
      async saveSelection({ style, format }) {
        return { selectedStyle: style, selectedFormat: format };
      },
    },
  });

  const richCapture = createRichCapture();
  const previewResult = await citationHandler.preview({
    requestId: "preview-1",
    payload: { capture: richCapture, style: "mla", excerpt: "Selected sentence", locator: { paragraph: 4, section: "Methods" }, annotation: "Pinned", quote: "Selected sentence" },
  });
  const saveResult = await citationHandler.save({
    requestId: "save-1",
    payload: { capture: richCapture, style: "mla", format: "bibliography", excerpt: "Selected sentence", locator: { paragraph: 4, section: "Methods" }, annotation: "Pinned", quote: "Selected sentence" },
  });

  assert.equal(previewResult.ok, true);
  assert.equal(saveResult.ok, true);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0].payload.extraction_payload, calls[1].payload.extraction_payload);
  assert.deepEqual(calls[0].payload.extraction_payload.author_candidates, [
    { value: "Ada Lovelace", confidence: 0.92, source: "meta:name:author" },
  ]);
  assert.deepEqual(calls[0].payload.extraction_payload.container_candidates, [
    { value: "Journal of Analytical Engines", confidence: 0.88, source: "meta:name:citation_journal_title" },
  ]);
  assert.deepEqual(calls[0].payload.extraction_payload.identifiers, {
    doi: "10.1000/example-doi",
    issn: "1234-5678",
  });
  assert.deepEqual(calls[0].payload.extraction_payload.locator, { paragraph: 4, section: "Methods" });
  assert.deepEqual(calls[0].payload.locator, { paragraph: 4, section: "Methods" });
  assert.equal(calls[0].payload.annotation, "Pinned");
  assert.equal(calls[0].payload.quote, "Selected sentence");
  assert.equal(calls[0].payload.extraction_payload.canonical_url, "https://example.com/articles/structured");
  assert.equal(calls[0].payload.extraction_payload.raw_metadata.custom_flag, "preserved");
});

test("extension capture create flow forwards the same rich extraction evidence family", async () => {
  const calls = [];
  const captureHandler = createCaptureHandler({
    captureApi: {
      async createCitation(payload) {
        calls.push(payload);
        return {
          ok: true,
          status: "ok",
          data: { id: "citation-2" },
        };
      },
      async createQuote() {
        throw new Error("unexpected createQuote");
      },
      async createNote() {
        throw new Error("unexpected createNote");
      },
    },
  });

  const result = await captureHandler.createCitation({
    requestId: "capture-1",
    payload: { capture: createRichCapture(), excerpt: "Selected sentence", locator: { paragraph: 4, section: "Methods" }, annotation: "Pinned", quote: "Selected sentence" },
  });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].extraction_payload.author_candidates, [
    { value: "Ada Lovelace", confidence: 0.92, source: "meta:name:author" },
  ]);
  assert.deepEqual(calls[0].extraction_payload.container_candidates, [
    { value: "Journal of Analytical Engines", confidence: 0.88, source: "meta:name:citation_journal_title" },
  ]);
  assert.deepEqual(calls[0].extraction_payload.identifiers, {
    doi: "10.1000/example-doi",
    issn: "1234-5678",
  });
  assert.deepEqual(calls[0].extraction_payload.locator, { paragraph: 4, section: "Methods" });
  assert.deepEqual(calls[0].locator, { paragraph: 4, section: "Methods" });
  assert.equal(calls[0].annotation, "Pinned");
  assert.equal(calls[0].quote, "Selected sentence");
  assert.equal(calls[0].extraction_payload.raw_metadata.site_name, "Example Journal");
  assert.equal(calls[0].extraction_payload.extraction_evidence.meta_tags.authors[0].value, "Ada Lovelace");
});

test("extension quote flow preserves locator and annotation when creating the quote", async () => {
  const createCitationCalls = [];
  const createQuoteCalls = [];
  const captureHandler = createCaptureHandler({
    captureApi: {
      async createCitation(payload) {
        createCitationCalls.push(payload);
        return {
          ok: true,
          status: "ok",
          data: { id: "citation-3" },
        };
      },
      async createQuote(payload) {
        createQuoteCalls.push(payload);
        return {
          ok: true,
          status: "ok",
          data: { id: "quote-1" },
        };
      },
      async createNote() {
        throw new Error("unexpected createNote");
      },
    },
  });

  const result = await captureHandler.createQuote({
    requestId: "quote-1",
    payload: {
      capture: createRichCapture(),
      locator: { paragraph: 4, section: "Methods" },
      annotation: "Pinned",
      quote: "Selected sentence",
      excerpt: "Selected sentence",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(createCitationCalls.length, 1);
  assert.equal(createQuoteCalls.length, 1);
  assert.deepEqual(createCitationCalls[0].locator, { paragraph: 4, section: "Methods" });
  assert.deepEqual(createCitationCalls[0].extraction_payload.locator, { paragraph: 4, section: "Methods" });
  assert.deepEqual(createQuoteCalls[0].locator, { paragraph: 4, section: "Methods" });
  assert.equal(createQuoteCalls[0].annotation, "Pinned");
});

import test from "node:test";
import assert from "node:assert/strict";

import { extractPageMetadata } from "../extension/content/selection/page_metadata.js";
import { buildSelectionContextPayload } from "../extension/content/selection/context.js";
import { buildCaptureExtractionPayload } from "../extension/shared/types/capture.js";

class FakeElement {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName || "").toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.childNodes = this.children;
    this.parentNode = null;
    this.attributes = new Map();
    this.textContent = "";
    this.lang = "";
    this.className = "";
  }

  setAttribute(name, value) {
    const normalized = String(value);
    this.attributes.set(name, normalized);
    if (name === "lang") {
      this.lang = normalized;
    }
    if (name === "class") {
      this.className = normalized;
    }
  }

  getAttribute(name) {
    if (name === "lang") {
      return this.lang || null;
    }
    if (name === "class") {
      return this.className || null;
    }
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }
}

class FakeDocument {
  constructor() {
    this.documentElement = new FakeElement("html", this);
    this.head = new FakeElement("head", this);
    this.body = new FakeElement("body", this);
    this.documentElement.append(this.head, this.body);
    this.title = "";
  }

  createElement(tagName) {
    return new FakeElement(tagName, this);
  }
}

function appendMeta(documentRef, attributes) {
  const meta = documentRef.createElement("meta");
  for (const [key, value] of Object.entries(attributes)) {
    meta.setAttribute(key, value);
  }
  documentRef.head.appendChild(meta);
  return meta;
}

function appendLink(documentRef, attributes) {
  const link = documentRef.createElement("link");
  for (const [key, value] of Object.entries(attributes)) {
    link.setAttribute(key, value);
  }
  documentRef.head.appendChild(link);
  return link;
}

function appendScript(documentRef, type, textContent) {
  const script = documentRef.createElement("script");
  script.setAttribute("type", type);
  script.textContent = textContent;
  documentRef.head.appendChild(script);
  return script;
}

function appendTime(documentRef, datetime, textContent) {
  const time = documentRef.createElement("time");
  if (datetime) {
    time.setAttribute("datetime", datetime);
  }
  time.textContent = textContent;
  documentRef.body.appendChild(time);
  return time;
}

function createWindow(url) {
  return {
    location: {
      href: url,
    },
  };
}

test("extractPageMetadata collects meta-tag citation evidence", () => {
  const documentRef = new FakeDocument();
  documentRef.title = "Ignored Document Title";
  documentRef.documentElement.setAttribute("lang", "en");
  appendLink(documentRef, { rel: "canonical", href: "https://example.com/paper" });
  appendMeta(documentRef, { name: "author", content: "Ada Lovelace" });
  appendMeta(documentRef, { property: "article:published_time", content: "2024-02-03" });
  appendMeta(documentRef, { name: "citation_journal_title", content: "Journal of Analytical Engines" });
  appendMeta(documentRef, { name: "citation_title", content: "Computing Machinery Notes" });
  appendMeta(documentRef, { name: "citation_doi", content: "10.1000/example-doi" });
  appendMeta(documentRef, { property: "og:site_name", content: "Royal Society Press" });
  appendMeta(documentRef, { name: "description", content: "An annotated abstract." });

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/paper?ref=feed"),
  });

  assert.equal(metadata.canonical_url, "https://example.com/paper");
  assert.equal(metadata.title, "Computing Machinery Notes");
  assert.equal(metadata.description, "An annotated abstract.");
  assert.equal(metadata.language, "en");
  assert.deepEqual(metadata.author_candidates.map((entry) => entry.value), ["Ada Lovelace"]);
  assert.deepEqual(metadata.date_candidates.map((entry) => entry.value), ["2024-02-03"]);
  assert.deepEqual(metadata.container_candidates.map((entry) => entry.value), ["Journal of Analytical Engines"]);
  assert.equal(metadata.identifiers.doi, "10.1000/example-doi");
  assert.equal(metadata.site_name, "Royal Society Press");
});

test("extractPageMetadata collects JSON-LD scholarly evidence and bounded visible time evidence", () => {
  const documentRef = new FakeDocument();
  appendScript(documentRef, "application/ld+json", JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: "Structured Evidence in Practice",
    author: [{ "@type": "Person", givenName: "Grace", familyName: "Hopper" }],
    datePublished: "2024-05-06",
    publisher: { "@type": "Organization", name: "ACM Press" },
    isPartOf: { "@type": "Periodical", name: "Journal of Compiler Studies" },
    doi: "10.2000/jsonld-doi",
    inLanguage: "en-US",
  }));
  appendTime(documentRef, "2024-05-07", "May 7, 2024");

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://research.example.org/article"),
  });

  assert.equal(metadata.title, "Structured Evidence in Practice");
  assert.equal(metadata.identifiers.doi, "10.2000/jsonld-doi");
  assert.ok(metadata.author_candidates.some((entry) => entry.value === "Grace Hopper" && entry.source === "jsonld:scholarlyarticle"));
  assert.ok(metadata.date_candidates.some((entry) => entry.value === "2024-05-06"));
  assert.ok(metadata.date_candidates.some((entry) => entry.value === "2024-05-07" && entry.source === "dom:time"));
  assert.ok(metadata.container_candidates.some((entry) => entry.value === "Journal of Compiler Studies"));
  assert.ok(metadata.source_type_candidates.some((entry) => entry.value === "scholarlyarticle"));
});

test("extractPageMetadata degrades safely on malformed JSON-LD", () => {
  const documentRef = new FakeDocument();
  documentRef.title = "Fallback Title";
  appendScript(documentRef, "application/ld+json", "{ bad json");

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/plain"),
  });

  assert.equal(metadata.title, "Fallback Title");
  assert.equal(metadata.author_candidates.length, 0);
  assert.deepEqual(metadata.extraction_evidence.json_ld_errors, [
    { source: "jsonld:0", reason: "parse_failed" },
  ]);
});

test("extractPageMetadata falls back to visible byline/date and canonical meta when head metadata is sparse", () => {
  const documentRef = new FakeDocument();
  documentRef.title = "Visible Signals Title";
  appendMeta(documentRef, { property: "og:url", content: "https://example.com/visible-signals" });

  const byline = documentRef.createElement("div");
  byline.setAttribute("class", "article-byline");
  byline.textContent = "By Jane Doe";
  documentRef.body.appendChild(byline);

  const published = documentRef.createElement("span");
  published.setAttribute("itemprop", "datePublished");
  published.textContent = "2024-06-07";
  documentRef.body.appendChild(published);

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/visible-signals?utm=feed"),
  });

  assert.equal(metadata.canonical_url, "https://example.com/visible-signals");
  assert.ok(metadata.author_candidates.some((entry) => entry.value === "Jane Doe" && entry.source === "dom:byline"));
  assert.ok(metadata.date_candidates.some((entry) => entry.value === "2024-06-07" && entry.source === "dom:date"));
  assert.deepEqual(metadata.extraction_evidence.visible_bylines, [
    { value: "Jane Doe", source: "dom:byline" },
  ]);
  assert.deepEqual(metadata.extraction_evidence.visible_dates, [
    { datetime: null, text: "2024-06-07", source: "dom:date" },
  ]);
});

test("extractPageMetadata preserves conflicting author signals and prefers canonical fallback from og:url", () => {
  const documentRef = new FakeDocument();
  documentRef.title = "Conflicting Signals";
  appendMeta(documentRef, { name: "author", content: "Meta Author" });
  appendMeta(documentRef, { property: "article:author", content: "Article Author" });
  appendMeta(documentRef, { property: "og:url", content: "https://example.com/conflict" });

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/conflict?campaign=feed"),
  });

  assert.equal(metadata.canonical_url, "https://example.com/conflict");
  assert.deepEqual(metadata.author_candidates.map((entry) => entry.value), [
    "Meta Author",
    "Article Author",
  ]);
});

test("extractPageMetadata composes split JSON-LD author names and captures publisher/site signals", () => {
  const documentRef = new FakeDocument();
  appendMeta(documentRef, { property: "og:site_name", content: "Example News" });
  appendScript(documentRef, "application/ld+json", JSON.stringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: "JSON-LD Split Author",
    author: [
      { "@type": "Person", givenName: "Grace", familyName: "Hopper" },
      { "@type": "Person", name: "Rear Admiral Hopper" },
    ],
    datePublished: "2024-04-05",
    publisher: { "@type": "Organization", name: "Example Newsroom" },
    url: "https://example.com/jsonld-author",
  }));

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/jsonld-author"),
  });

  assert.equal(metadata.canonical_url, "https://example.com/jsonld-author");
  assert.ok(metadata.author_candidates.some((entry) => entry.value === "Grace Hopper"));
  assert.ok(metadata.author_candidates.some((entry) => entry.value === "Rear Admiral Hopper"));
  assert.ok(metadata.publisher_candidates.some((entry) => entry.value === "Example News"));
  assert.ok(metadata.publisher_candidates.some((entry) => entry.value === "Example Newsroom"));
  assert.ok(metadata.source_type_candidates.some((entry) => entry.value === "newsarticle"));
});

test("extractPageMetadata rejects junk visible byline/date candidates", () => {
  const documentRef = new FakeDocument();
  documentRef.title = "Junk Candidate Page";

  const junkByline = documentRef.createElement("div");
  junkByline.setAttribute("class", "author");
  junkByline.textContent = "Share";
  documentRef.body.appendChild(junkByline);

  const junkDate = documentRef.createElement("span");
  junkDate.setAttribute("class", "published");
  junkDate.textContent = "Updated";
  documentRef.body.appendChild(junkDate);

  const realByline = documentRef.createElement("div");
  realByline.setAttribute("data-testid", "article-author");
  realByline.textContent = "By Janet Morris";
  documentRef.body.appendChild(realByline);

  const realDate = documentRef.createElement("span");
  realDate.setAttribute("data-testid", "publish-date");
  realDate.textContent = "2024-01-09";
  documentRef.body.appendChild(realDate);

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/junk-filter"),
  });

  assert.deepEqual(metadata.author_candidates.map((entry) => entry.value), ["Janet Morris"]);
  assert.deepEqual(metadata.date_candidates.map((entry) => entry.value), ["2024-01-09"]);
  assert.deepEqual(metadata.extraction_evidence.visible_bylines, [
    { value: "Janet Morris", source: "dom:byline" },
  ]);
  assert.deepEqual(metadata.extraction_evidence.visible_dates, [
    { datetime: null, text: "2024-01-09", source: "dom:date" },
  ]);
});

test("extractPageMetadata captures DOI from generic identifier metadata", () => {
  const documentRef = new FakeDocument();
  appendMeta(documentRef, { name: "dc.identifier", content: "https://doi.org/10.5555/example-doi" });

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/doi-page"),
  });

  assert.equal(metadata.identifiers.doi, "10.5555/example-doi");
});

test("extractPageMetadata captures publisher and container metadata deterministically", () => {
  const documentRef = new FakeDocument();
  documentRef.title = "Publisher Test";
  appendMeta(documentRef, { property: "og:site_name", content: "Example Journal" });
  appendMeta(documentRef, { name: "citation_journal_title", content: "Proceedings of Deterministic Capture" });
  appendMeta(documentRef, { property: "og:type", content: "article" });
  appendMeta(documentRef, { name: "date", content: "2024-07-08" });

  const metadata = extractPageMetadata({
    documentRef,
    windowRef: createWindow("https://example.com/publisher-test"),
  });

  assert.equal(metadata.site_name, "Example Journal");
  assert.deepEqual(metadata.container_candidates.map((entry) => entry.value), ["Proceedings of Deterministic Capture"]);
  assert.ok(metadata.source_type_candidates.some((entry) => entry.value === "article"));
  assert.deepEqual(metadata.date_candidates.map((entry) => entry.value), ["2024-07-08"]);
});

test("buildSelectionContextPayload preserves citation evidence", () => {
  const payload = buildSelectionContextPayload({
    selection: {
      normalized_text: "Selected sentence",
      text: "Selected sentence",
      locator: { paragraph: 7, section: "Discussion" },
    },
    page: {
      title: "Evidence Title",
      description: "Evidence description",
      url: "https://example.com/source",
      host: "example.com",
      canonical_url: "https://example.com/source",
      language: "en",
      site_name: "Example Journal",
      author_candidates: [{ value: "Alice Doe", confidence: 0.9, source: "meta:name:author" }],
      date_candidates: [{ value: "2024-02-03", confidence: 0.9, source: "meta:name:citation_date" }],
      publisher_candidates: [{ value: "Example Press", confidence: 0.8, source: "meta:property:og:site_name" }],
      container_candidates: [{ value: "Journal of Examples", confidence: 0.88, source: "meta:name:citation_journal_title" }],
      source_type_candidates: [{ value: "scholarlyarticle", confidence: 0.85, source: "jsonld:scholarlyarticle" }],
      identifiers: { doi: "10.1000/context-doi" },
      extraction_evidence: {
        meta_tags: {
          authors: [{ value: "Alice Doe", source: "meta:name:author", key: "author" }],
        },
      },
      raw_metadata: {
        title: "Evidence Title",
        site_name: "Example Journal",
      },
    },
  });

  assert.equal(payload.capture.canonicalUrl, "https://example.com/source");
  assert.deepEqual(payload.capture.locator, { paragraph: 7, section: "Discussion" });
  assert.equal(payload.capture.description, "Evidence description");
  assert.equal(payload.capture.language, "en");
  assert.equal(payload.capture.siteName, "Example Journal");
  assert.deepEqual(payload.capture.authorCandidates, [
    { value: "Alice Doe", confidence: 0.9, source: "meta:name:author" },
  ]);
  assert.deepEqual(payload.capture.identifiers, { doi: "10.1000/context-doi" });
  assert.deepEqual(payload.capture.extractionEvidence.meta_tags.authors, [
    { value: "Alice Doe", source: "meta:name:author", key: "author" },
  ]);
});

test("buildCaptureExtractionPayload populates candidate arrays, identifiers, and minimal-page fallback", () => {
  const richPayload = buildCaptureExtractionPayload({
    selectionText: "Quoted sentence",
    pageTitle: "Rich Source Title",
    pageUrl: "https://example.com/rich",
    pageDomain: "example.com",
    canonicalUrl: "https://example.com/rich",
    description: "A rich source",
    language: "en",
    siteName: "Example Press",
    authorCandidates: [{ value: "Jane Smith", confidence: 0.92, source: "meta:name:author" }],
    dateCandidates: [{ value: "2024-02-04", confidence: 0.9, source: "meta:name:citation_date" }],
    containerCandidates: [{ value: "Journal of Rich Sources", confidence: 0.88, source: "meta:name:citation_journal_title" }],
    sourceTypeCandidates: [{ value: "scholarlyarticle", confidence: 0.85, source: "jsonld:scholarlyarticle" }],
    identifiers: { doi: "10.1000/rich-doi" },
    rawMetadata: { custom_flag: "kept" },
    extractionEvidence: { meta_tags: { dates: [{ value: "2024-02-04", source: "meta:name:citation_date" }] } },
    locator: { paragraph: 2, section: "Results" },
  });

  assert.equal(richPayload.canonical_url, "https://example.com/rich");
  assert.deepEqual(richPayload.author_candidates, [
    { value: "Jane Smith", confidence: 0.92, source: "meta:name:author" },
  ]);
  assert.deepEqual(richPayload.date_candidates, [
    { value: "2024-02-04", confidence: 0.9, source: "meta:name:citation_date" },
  ]);
  assert.deepEqual(richPayload.container_candidates, [
    { value: "Journal of Rich Sources", confidence: 0.88, source: "meta:name:citation_journal_title" },
  ]);
  assert.deepEqual(richPayload.identifiers, { doi: "10.1000/rich-doi" });
  assert.deepEqual(richPayload.locator, { paragraph: 2, section: "Results" });
  assert.equal(richPayload.raw_metadata.custom_flag, "kept");
  assert.equal(richPayload.raw_metadata.author, "Jane Smith");
  assert.equal(richPayload.extraction_evidence.capture_source, "extension_selection");

  const minimalPayload = buildCaptureExtractionPayload({
    selectionText: "Minimal quote",
    pageTitle: "Minimal Title",
    pageUrl: "https://minimal.example/path",
    pageDomain: "minimal.example",
  });

  assert.equal(minimalPayload.page_url, "https://minimal.example/path");
  assert.deepEqual(minimalPayload.title_candidates, [
    { value: "Minimal Title", confidence: 0.9, source: "document.title" },
  ]);
  assert.deepEqual(minimalPayload.author_candidates, []);
  assert.deepEqual(minimalPayload.date_candidates, []);
  assert.deepEqual(minimalPayload.container_candidates, []);
  assert.deepEqual(minimalPayload.publisher_candidates, [
    { value: "minimal.example", confidence: 0.4, source: "page.domain" },
  ]);
  assert.deepEqual(minimalPayload.source_type_candidates, [
    { value: "webpage", confidence: 0.8, source: "extension.capture" },
  ]);
});

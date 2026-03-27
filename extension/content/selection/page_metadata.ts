const JSON_LD_MAX_SCRIPTS = 8;
const JSON_LD_MAX_TEXT_LENGTH = 50000;
const JSON_LD_MAX_NODES = 24;
const TIME_ELEMENT_LIMIT = 8;
const VISIBLE_METADATA_LIMIT = 12;

const SUPPORTED_SCHEMA_TYPES = new Set([
  "scholarlyarticle",
  "newsarticle",
  "article",
  "report",
  "webpage",
  "book",
  "dataset",
  "creativework",
]);

const META_AUTHOR_KEYS = new Set([
  "author",
  "article:author",
  "parsely-author",
  "citation_author",
  "citation_authors",
  "dc.creator",
  "dcterms.creator",
  "dc.contributor",
  "dcterms.contributor",
]);

const META_DATE_KEYS = new Set([
  "article:published_time",
  "article:modified_time",
  "date",
  "pubdate",
  "citation_publication_date",
  "citation_online_date",
  "citation_date",
  "dc.date",
  "dcterms.date",
  "dcterms.issued",
  "dcterms.created",
  "dcterms.modified",
  "prism.publicationdate",
  "prism.creationdate",
  "prism.modificationdate",
]);

const META_CONTAINER_KEYS = new Set([
  "citation_journal_title",
  "citation_conference_title",
  "dc.relation.ispartof",
  "dcterms.ispartof",
  "prism.publicationname",
]);

const META_PUBLISHER_KEYS = new Set([
  "og:site_name",
  "article:publisher",
  "publisher",
  "dc.publisher",
  "dcterms.publisher",
  "application-name",
]);

const META_DESCRIPTION_KEYS = new Set([
  "description",
  "og:description",
  "dc.description",
  "dcterms.description",
]);

const META_LANGUAGE_KEYS = new Set([
  "content-language",
  "dc.language",
  "dcterms.language",
]);

const META_TITLE_KEYS = new Set([
  "title",
  "article:title",
  "og:title",
  "citation_title",
  "dc.title",
  "dcterms.title",
]);

const META_CANONICAL_URL_KEYS = new Set([
  "og:url",
  "twitter:url",
  "citation_public_url",
  "citation_full_html_url",
  "citation_fulltext_html_url",
]);

const IDENTIFIER_META_KEYS = {
  doi: new Set(["citation_doi", "prism.doi"]),
  issn: new Set(["citation_issn", "prism.issn"]),
  isbn: new Set(["citation_isbn"]),
  pdf_url: new Set(["citation_pdf_url"]),
};

function normalizeText(value: any) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function isPlainObject(value: any) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toArray<T = any>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value;
  }
  return value == null ? [] : [value];
}

function walkElements(root: any, visit: (node: any) => boolean | void) {
  if (!root || typeof visit !== "function") {
    return;
  }
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      continue;
    }
    if (visit(node) === false) {
      return;
    }
    const children = node.children || node.childNodes || [];
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push(children[index]);
    }
  }
}

function readAttribute(node: any, name: string) {
  if (!node) {
    return "";
  }
  const value = typeof node.getAttribute === "function" ? node.getAttribute(name) : node[name];
  return normalizeText(value);
}

function normalizeUrlCandidate(value: any) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  return normalized;
}

function pushCandidate(bucket: any[], seen: Set<string>, value: any, confidence: number, source: string) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return;
  }
  const key = `${normalizedValue.toLowerCase()}|${source}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  bucket.push({ value: normalizedValue, confidence, source });
}

function pushEvidence(bucket: any[], value: any, source: string, extra: any = {}) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return;
  }
  bucket.push({
    value: normalizedValue,
    source,
    ...extra,
  });
}

function createIdentifierCollector() {
  return {
    identifiers: {},
    evidence: {
      doi: [],
      issn: [],
      isbn: [],
      pdf_url: [],
    },
  };
}

function pushIdentifier(collector: any, key: string, value: any, source: string) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    return;
  }
  if (!collector.identifiers[key]) {
    collector.identifiers[key] = normalizedValue;
  }
  pushEvidence(collector.evidence[key], normalizedValue, source);
}

function collectHeadElements(documentRef: any, tagName: string) {
  const matches = [];
  walkElements(documentRef?.head || documentRef?.documentElement || null, (node) => {
    if (String(node?.tagName || "").toUpperCase() === tagName) {
      matches.push(node);
    }
  });
  return matches;
}

function collectMetaEntries(documentRef: any) {
  return collectHeadElements(documentRef, "META").map((node) => {
    const name = readAttribute(node, "name").toLowerCase();
    const property = readAttribute(node, "property").toLowerCase();
    const key = name || property;
    const content = readAttribute(node, "content");
    return {
      key,
      content,
      source: name ? `meta:name:${name}` : `meta:property:${property}`,
    };
  }).filter((entry) => entry.key && entry.content);
}

function readCanonicalUrl(documentRef: any) {
  for (const node of collectHeadElements(documentRef, "LINK")) {
    const rel = readAttribute(node, "rel").toLowerCase();
    if (rel === "canonical") {
      return normalizeUrlCandidate(readAttribute(node, "href"));
    }
  }
  return "";
}

function splitAuthorContent(value: string) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return [];
  }
  if (!/[;,]/.test(normalized) || /\band\b/i.test(normalized)) {
    return [normalized];
  }
  return normalized
    .split(/[;,]/g)
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function addMetaCandidates(metaEntries: any[], candidates: any) {
  const titleSeen = new Set<string>();
  const authorSeen = new Set<string>();
  const dateSeen = new Set<string>();
  const publisherSeen = new Set<string>();
  const containerSeen = new Set<string>();

  for (const entry of metaEntries) {
    const key = entry.key.toLowerCase();
    if (META_TITLE_KEYS.has(key)) {
      pushCandidate(candidates.title_candidates, titleSeen, entry.content, 0.95, entry.source);
      pushEvidence(candidates.raw.meta_tags.title, entry.content, entry.source, { key });
    }
    if (META_AUTHOR_KEYS.has(key)) {
      for (const authorValue of splitAuthorContent(entry.content)) {
        pushCandidate(candidates.author_candidates, authorSeen, authorValue, 0.92, entry.source);
      }
      pushEvidence(candidates.raw.meta_tags.authors, entry.content, entry.source, { key });
    }
    if (META_DATE_KEYS.has(key)) {
      pushCandidate(candidates.date_candidates, dateSeen, entry.content, 0.9, entry.source);
      pushEvidence(candidates.raw.meta_tags.dates, entry.content, entry.source, { key });
    }
    if (META_CONTAINER_KEYS.has(key)) {
      pushCandidate(candidates.container_candidates, containerSeen, entry.content, 0.88, entry.source);
      pushEvidence(candidates.raw.meta_tags.containers, entry.content, entry.source, { key });
    }
    if (META_PUBLISHER_KEYS.has(key)) {
      pushCandidate(candidates.publisher_candidates, publisherSeen, entry.content, 0.8, entry.source);
      pushEvidence(candidates.raw.meta_tags.publishers, entry.content, entry.source, { key });
    }
    if (META_DESCRIPTION_KEYS.has(key)) {
      pushEvidence(candidates.raw.meta_tags.description, entry.content, entry.source, { key });
    }
    if (META_LANGUAGE_KEYS.has(key)) {
      pushEvidence(candidates.raw.meta_tags.language, entry.content, entry.source, { key });
    }
    for (const [identifierKey, metaKeys] of Object.entries(IDENTIFIER_META_KEYS)) {
      if (metaKeys.has(key)) {
        pushIdentifier(candidates.identifiers, identifierKey, entry.content, entry.source);
      }
    }
    if (META_CANONICAL_URL_KEYS.has(key)) {
      candidates.raw.canonical_urls.push({ value: entry.content, source: entry.source });
    }
  }
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function getSchemaTypes(node: any) {
  return toArray(node?.["@type"] || node?.type)
    .map((value) => normalizeText(value).toLowerCase())
    .filter(Boolean);
}

function parseAuthorValue(value: any, output: string[] = []) {
  for (const entry of toArray(value)) {
    if (typeof entry === "string") {
      const normalized = normalizeText(entry);
      if (normalized) {
        output.push(normalized);
      }
      continue;
    }
    if (isPlainObject(entry)) {
      const givenName = normalizeText(entry.givenName);
      const familyName = normalizeText(entry.familyName);
      const combinedName = normalizeText(`${givenName} ${familyName}`);
      const name = normalizeText(entry.name || entry.alternateName || combinedName || familyName || givenName);
      if (name) {
        output.push(name);
      }
    }
  }
  return output;
}

function isLikelyVisibleAuthorNode(node: any) {
  const rel = readAttribute(node, "rel").toLowerCase();
  const itemProp = readAttribute(node, "itemprop").toLowerCase();
  const dataTestId = readAttribute(node, "data-testid").toLowerCase();
  const className = normalizeText(node?.className || "").toLowerCase();
  const id = readAttribute(node, "id").toLowerCase();
  return rel === "author"
    || itemProp === "author"
    || itemProp === "creator"
    || dataTestId.includes("author")
    || dataTestId.includes("byline")
    || /\bauthor\b/.test(className)
    || /\bbyline\b/.test(className)
    || /\bauthor\b/.test(id)
    || /\bbyline\b/.test(id);
}

function isLikelyVisibleDateNode(node: any) {
  const itemProp = readAttribute(node, "itemprop").toLowerCase();
  const dataTestId = readAttribute(node, "data-testid").toLowerCase();
  const className = normalizeText(node?.className || "").toLowerCase();
  const id = readAttribute(node, "id").toLowerCase();
  return itemProp === "datepublished"
    || itemProp === "datecreated"
    || itemProp === "dateissued"
    || dataTestId.includes("date")
    || dataTestId.includes("published")
    || /\bpublished\b/.test(className)
    || /\bdate\b/.test(className)
    || /\bpublished\b/.test(id)
    || /\bdate\b/.test(id);
}

function normalizeVisibleAuthorText(value: any) {
  const normalized = normalizeText(value).replace(/^\s*by\s+/i, "");
  if (!normalized) {
    return "";
  }
  const lower = normalized.toLowerCase();
  if (["by", "share", "updated", "published", "author", "authors"].includes(lower)) {
    return "";
  }
  return normalized;
}

function normalizeVisibleDateText(value: any) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  const lower = normalized.toLowerCase();
  if (["updated", "published", "date", "share"].includes(lower)) {
    return "";
  }
  return normalized;
}

function parseIdentifierFromJsonLd(node: any, collector: any, source: string) {
  const directDoi = normalizeText(node?.doi);
  if (directDoi) {
    pushIdentifier(collector, "doi", directDoi, source);
  }
  const directIssn = normalizeText(node?.issn);
  if (directIssn) {
    pushIdentifier(collector, "issn", directIssn, source);
  }
  const directIsbn = normalizeText(node?.isbn);
  if (directIsbn) {
    pushIdentifier(collector, "isbn", directIsbn, source);
  }
  for (const entry of toArray(node?.identifier)) {
    if (typeof entry === "string") {
      const normalized = normalizeText(entry);
      if (/10\.\S+\/\S+/i.test(normalized)) {
        pushIdentifier(collector, "doi", normalized, source);
      }
      continue;
    }
    if (!isPlainObject(entry)) {
      continue;
    }
    const propertyId = normalizeText(entry.propertyID || entry.name).toLowerCase();
    const value = normalizeText(entry.value || entry.identifier);
    if (!propertyId || !value) {
      continue;
    }
    if (propertyId.includes("doi")) {
      pushIdentifier(collector, "doi", value, source);
    } else if (propertyId.includes("issn")) {
      pushIdentifier(collector, "issn", value, source);
    } else if (propertyId.includes("isbn")) {
      pushIdentifier(collector, "isbn", value, source);
    }
  }
}

function collectRelevantJsonLdNodes(value: any, output: any[], state: any) {
  if (state.count >= JSON_LD_MAX_NODES || value == null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRelevantJsonLdNodes(entry, output, state);
      if (state.count >= JSON_LD_MAX_NODES) {
        return;
      }
    }
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  state.count += 1;
  const types = getSchemaTypes(value);
  if (types.some((type) => SUPPORTED_SCHEMA_TYPES.has(type))) {
    output.push(value);
  }
  if (isPlainObject(value["@graph"])) {
    collectRelevantJsonLdNodes(value["@graph"], output, state);
  }
  if (Array.isArray(value["@graph"])) {
    collectRelevantJsonLdNodes(value["@graph"], output, state);
  }
}

function addJsonLdCandidates(documentRef: any, candidates: any) {
  const scripts = collectHeadElements(documentRef, "SCRIPT")
    .filter((node) => readAttribute(node, "type").toLowerCase() === "application/ld+json")
    .slice(0, JSON_LD_MAX_SCRIPTS);

  const titleSeen = new Set<string>(candidates.title_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  const authorSeen = new Set<string>(candidates.author_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  const dateSeen = new Set<string>(candidates.date_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  const publisherSeen = new Set<string>(candidates.publisher_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  const containerSeen = new Set<string>(candidates.container_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  const sourceTypeSeen = new Set<string>(candidates.source_type_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));

  scripts.forEach((scriptNode, index) => {
    const rawText = String(scriptNode?.textContent || "").trim();
    if (!rawText || rawText.length > JSON_LD_MAX_TEXT_LENGTH) {
      return;
    }
    const parsed = parseJson(rawText);
    if (!parsed) {
      candidates.raw.json_ld_errors.push({ source: `jsonld:${index}`, reason: "parse_failed" });
      return;
    }
    const relevantNodes = [];
    collectRelevantJsonLdNodes(parsed, relevantNodes, { count: 0 });
    for (const node of relevantNodes) {
      const types = getSchemaTypes(node);
      const source = `jsonld:${types[0] || index}`;
      const title = normalizeText(node.headline || node.name || node.title);
      const authors = parseAuthorValue(node.author || node.creator);
      const dateValues = [
        node.datePublished,
        node.dateCreated,
        node.dateModified,
        node.uploadDate,
        node.date,
      ];
      const publisher = normalizeText(node.publisher?.name || node.provider?.name || node.sourceOrganization?.name);
      const container = normalizeText(
        node.isPartOf?.name
        || node.publication?.name
        || node.periodical?.name
        || node.journalTitle
        || node.containerTitle,
      );
      const url = normalizeUrlCandidate(node.url || node.mainEntityOfPage?.["@id"] || node.mainEntityOfPage?.url);
      const description = normalizeText(node.description);
      const language = normalizeText(node.inLanguage);

      if (title) {
        pushCandidate(candidates.title_candidates, titleSeen, title, 0.93, source);
      }
      for (const author of authors) {
        pushCandidate(candidates.author_candidates, authorSeen, author, 0.9, source);
      }
      for (const dateValue of dateValues) {
        pushCandidate(candidates.date_candidates, dateSeen, dateValue, 0.88, source);
      }
      if (publisher) {
        pushCandidate(candidates.publisher_candidates, publisherSeen, publisher, 0.82, source);
      }
      if (container) {
        pushCandidate(candidates.container_candidates, containerSeen, container, 0.84, source);
      }
      for (const type of types) {
        pushCandidate(candidates.source_type_candidates, sourceTypeSeen, type, 0.85, source);
      }
      parseIdentifierFromJsonLd(node, candidates.identifiers, source);
      candidates.raw.json_ld.push({
        source,
        types,
        title: title || null,
        authors,
        dates: dateValues.map((value) => normalizeText(value)).filter(Boolean),
        publisher: publisher || null,
        container: container || null,
        url: url || null,
        description: description || null,
        language: language || null,
      });
      if (url) {
        candidates.raw.canonical_urls.push({ value: url, source });
      }
      if (description) {
        pushEvidence(candidates.raw.meta_tags.description, description, source);
      }
      if (language) {
        pushEvidence(candidates.raw.meta_tags.language, language, source);
      }
    }
  });
}

function addVisibleTimeCandidates(documentRef: any, candidates: any) {
  const dateSeen = new Set<string>(candidates.date_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  let count = 0;
  walkElements(documentRef?.body || null, (node) => {
    if (count >= TIME_ELEMENT_LIMIT) {
      return false;
    }
    if (String(node?.tagName || "").toUpperCase() !== "TIME") {
      return;
    }
    const datetime = readAttribute(node, "datetime");
    const text = normalizeText(node?.textContent || "");
    if (!datetime && !text) {
      return;
    }
    count += 1;
    const source = "dom:time";
    if (datetime) {
      pushCandidate(candidates.date_candidates, dateSeen, datetime, 0.68, source);
    } else if (text) {
      pushCandidate(candidates.date_candidates, dateSeen, text, 0.55, source);
    }
    candidates.raw.visible_times.push({
      datetime: datetime || null,
      text: text || null,
      source,
    });
  });
}

function addVisibleBylineCandidates(documentRef: any, candidates: any) {
  const authorSeen = new Set<string>(candidates.author_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  const dateSeen = new Set<string>(candidates.date_candidates.map((candidate: any) => `${candidate.value.toLowerCase()}|${candidate.source}`));
  let authorCount = 0;
  let dateCount = 0;

  walkElements(documentRef?.body || null, (node) => {
    if (authorCount >= VISIBLE_METADATA_LIMIT && dateCount >= VISIBLE_METADATA_LIMIT) {
      return false;
    }
    if (!node || typeof node.tagName !== "string") {
      return;
    }

    if (authorCount < VISIBLE_METADATA_LIMIT && isLikelyVisibleAuthorNode(node)) {
      const text = normalizeVisibleAuthorText(node.textContent || "");
      if (text) {
        authorCount += 1;
        for (const authorValue of splitAuthorContent(text)) {
          pushCandidate(candidates.author_candidates, authorSeen, normalizeVisibleAuthorText(authorValue), 0.58, "dom:byline");
        }
        pushEvidence(candidates.raw.visible_bylines, text, "dom:byline");
      }
    }

    if (dateCount < VISIBLE_METADATA_LIMIT && isLikelyVisibleDateNode(node)) {
      const datetime = normalizeVisibleDateText(readAttribute(node, "datetime"));
      const text = normalizeVisibleDateText(node.textContent || "");
      if (datetime || text) {
        dateCount += 1;
        if (datetime) {
          pushCandidate(candidates.date_candidates, dateSeen, datetime, 0.62, "dom:date");
        } else if (text) {
          pushCandidate(candidates.date_candidates, dateSeen, text, 0.52, "dom:date");
        }
        candidates.raw.visible_dates.push({
          datetime: datetime || null,
          text: text || null,
          source: "dom:date",
        });
      }
    }
  });
}

function firstValue(candidates: any[]) {
  return candidates.length ? candidates[0].value : "";
}

export function extractPageMetadata({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
} = {}) {
  const url = String(windowRef?.location?.href || "");
  const initialCanonicalUrl = readCanonicalUrl(documentRef);
  const metaEntries = collectMetaEntries(documentRef);
  const candidates = {
    title_candidates: [],
    author_candidates: [],
    date_candidates: [],
    publisher_candidates: [],
    container_candidates: [],
    source_type_candidates: [],
    identifiers: createIdentifierCollector(),
    raw: {
      meta_tags: {
        title: [],
        authors: [],
        dates: [],
        containers: [],
        publishers: [],
        description: [],
        language: [],
      },
      json_ld: [],
      json_ld_errors: [],
      visible_times: [],
      visible_bylines: [],
      visible_dates: [],
      canonical_urls: initialCanonicalUrl ? [{ value: initialCanonicalUrl, source: "link:canonical" }] : [],
    },
  };

  addMetaCandidates(metaEntries, candidates);
  addJsonLdCandidates(documentRef, candidates);
  addVisibleTimeCandidates(documentRef, candidates);
  addVisibleBylineCandidates(documentRef, candidates);

  const documentTitle = normalizeText(documentRef?.title || "");
  if (documentTitle && !candidates.title_candidates.length) {
    candidates.title_candidates.push({ value: documentTitle, confidence: 0.9, source: "document.title" });
  }
  if (!candidates.source_type_candidates.length) {
    candidates.source_type_candidates.push({ value: "webpage", confidence: 0.6, source: "extension.capture" });
  }

  const description = firstValue(candidates.raw.meta_tags.description) || "";
  const site_name = firstValue(candidates.publisher_candidates);
  const language = normalizeText(documentRef?.documentElement?.lang || firstValue(candidates.raw.meta_tags.language));
  const title = firstValue(candidates.title_candidates) || documentTitle;
  const author = firstValue(candidates.author_candidates);
  const canonical_url = initialCanonicalUrl || normalizeUrlCandidate(candidates.raw.canonical_urls[0]?.value);

  let origin = "";
  let host = "";
  try {
    const parsed = url ? new URL(url) : null;
    origin = parsed?.origin || "";
    host = parsed?.host || "";
  } catch {}

  return {
    url,
    origin,
    host,
    title,
    description,
    author,
    site_name,
    canonical_url,
    language,
    title_candidates: candidates.title_candidates,
    author_candidates: candidates.author_candidates,
    date_candidates: candidates.date_candidates,
    publisher_candidates: candidates.publisher_candidates,
    container_candidates: candidates.container_candidates,
    source_type_candidates: candidates.source_type_candidates,
    identifiers: candidates.identifiers.identifiers,
    extraction_evidence: {
      meta_tags: candidates.raw.meta_tags,
      json_ld: candidates.raw.json_ld,
      json_ld_errors: candidates.raw.json_ld_errors,
      visible_times: candidates.raw.visible_times,
      visible_bylines: candidates.raw.visible_bylines,
      visible_dates: candidates.raw.visible_dates,
      canonical_urls: candidates.raw.canonical_urls,
    },
    raw_metadata: {
      title: title || null,
      description: description || null,
      author: author || null,
      authors: candidates.author_candidates.map((candidate: any) => candidate.value),
      site_name: site_name || null,
      publisher: site_name || null,
      canonical_url: canonical_url || null,
      page_url: url || null,
      language: language || null,
      datePublished: firstValue(candidates.date_candidates) || null,
      container_title: firstValue(candidates.container_candidates) || null,
      identifiers: { ...candidates.identifiers.identifiers },
      json_ld: candidates.raw.json_ld,
    },
  };
}

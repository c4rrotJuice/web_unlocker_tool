# Citation Engine Diagnostic Report

## Scope reviewed
- Browser extension citation generation in `extension/content/unlock_content.js`.
- Web-app citation generation in `app/static/unlock.js`.

## Previous implementation findings

### Metadata extraction coverage
- Previous extraction relied on a small set of metadata signals (`og:*`, basic `meta[name=author]`, first JSON-LD object, simple microdata headline/author/date, DOM byline hints).
- Highwire `citation_*` signals, Dublin Core depth, and structured confidence-based field selection were not consistently modeled.
- Canonical URL handling and URL hygiene existed, but confidence-driven source selection did not.

### Formatting and style rendering
- Styles (MLA/APA/Chicago/Harvard) were rendered from hardcoded templates without strong source-type differentiation.
- Journal-specific metadata (volume/issue/DOI) was not consistently prioritized.
- Date handling mostly converted to generic `Date` and fell back to year strings.

### Author parsing and normalization
- Basic parsing handled plain names and limited organizational keywords.
- Robust parsing for `Last, First`, multiple separators, and organizational fallback in missing-author cases was limited.

### Classification and fallback weaknesses
- No explicit source classifier with confidence output.
- Weak distinction among newspaper/blog/journal/preprint/government sources.
- Site vs publisher overlap did not have explicit normalization policy.

### Quote citation consistency
- Paragraph lookup existed but style-specific quoting behavior was limited.
- Quote locators did not flow from a dedicated normalized layer/classification output.

## Refactor summary implemented

### Layered pipeline added
`WEBPAGE -> METADATA SCRAPER -> PRIORITY/CONFIDENCE -> NORMALIZATION -> SOURCE CLASSIFIER -> STYLE FORMATTER`

### New extraction priorities and confidence map
- Added explicit confidence constants:
  - highwire 0.95
  - schema/jsonld 0.90
  - dublin 0.85
  - opengraph 0.75
  - standard 0.70
  - dom 0.60
  - url 0.30
- Added extraction for Highwire (`citation_title`, `citation_author`, `citation_publication_date`, `citation_journal_title`, `citation_volume`, `citation_issue`, `citation_doi`) plus schema/JSON-LD/DC/OG/DOM fallbacks.

### Normalization layer upgrades
- Normalized authors into structured objects with first/last/initials/organization flags.
- Added `title_case` and `sentence_case` outputs and subtitle merge behavior.
- Added normalized date structures and style-target date strings.
- Added canonical URL + tracking parameter cleanup.

### Source classification
- Added source classifier output with confidence, using schema type, DOI/journal metadata, domain heuristics.
- Added domain intelligence table for key domains.
- Added lightweight site translators for arXiv, Nature, NYTimes.

### Style rendering improvements
- Centralized style rendering for MLA/APA/Chicago/Harvard using normalized metadata.
- DOI-preferred output for journal articles with DOI.
- Missing metadata fallbacks now prefer organization/publisher/site.
- Paragraph quote locators retained and rendered per style.

## Remaining opportunities
- Add cross-page fixture-based golden tests comparing generated citations vs manually verified references.
- Expand domain translator coverage (major publishers/newspapers/repositories).
- Introduce locale-aware date parsing for non-US date strings and stricter title capitalization stopword rules.

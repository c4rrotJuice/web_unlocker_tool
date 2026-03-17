# Research Graph Contract

## Canonical Models

### Project
- Backed by `projects`
- User-owned taxonomy container
- Canonical fields:
  - `id`
  - `name`
  - `color`
  - `description`
  - `icon`
  - `archived`
  - `created_at`
  - `updated_at`

### Tag
- Backed by `tags`
- User-owned reusable label
- Canonical fields:
  - `id`
  - `name`
  - `normalized_name`

### Source
- Backed by `sources`
- Shared canonical metadata record
- Deduplicated by deterministic fingerprint
- Canonical summary fields:
  - `id`
  - `title`
  - `source_type`
  - `authors`
  - `container_title`
  - `publisher`
  - `issued_date`
  - `identifiers`
  - `canonical_url`
  - `page_url`
  - `hostname`
  - `language_code`
  - `created_at`
  - `updated_at`
  - `relationship_counts`
- Canonical detail extends summary with:
  - `fingerprint`
  - `metadata`
  - `normalization_version`
  - `source_version`

### Citation
- Backed by `citation_instances`
- User-owned citation record grounded in a canonical source
- `excerpt` and `quote_text` are compatibility-era citation context fields only
- Future quote phases must introduce quote-owned evidence records rather than expanding citation-instance scope
- Canonical fields:
  - `id`
  - `source_id`
  - `source`
  - `locator`
  - `annotation`
  - `excerpt`
  - `quote_text`
  - `renders`
  - `created_at`
  - `updated_at`
  - `relationship_counts`
- `quote_text` is transitional compatibility context only, not the future quote-system source of truth

### CitationTemplate
- Backed by `citation_templates`
- User-owned custom template record
- Canonical fields:
  - `id`
  - `name`
  - `template_body`
  - `is_default`
  - `created_at`
  - `updated_at`

## Serializer Shapes

### Project
```json
{
  "id": "uuid",
  "name": "Project name",
  "color": "#000000",
  "description": "Optional description",
  "icon": "optional-icon",
  "archived": false,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### Tag
```json
{
  "id": "uuid",
  "name": "Evidence",
  "normalized_name": "evidence"
}
```

### SourceSummary
```json
{
  "id": "uuid",
  "title": "Source title",
  "source_type": "webpage",
  "authors": [],
  "container_title": null,
  "publisher": null,
  "issued_date": {},
  "identifiers": {},
  "canonical_url": "https://example.com",
  "page_url": "https://example.com",
  "hostname": "example.com",
  "language_code": "en",
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "relationship_counts": {
    "citation_count": 0
  }
}
```

### SourceDetail
```json
{
  "id": "uuid",
  "title": "Source title",
  "source_type": "webpage",
  "authors": [],
  "container_title": null,
  "publisher": null,
  "issued_date": {},
  "identifiers": {},
  "canonical_url": "https://example.com",
  "page_url": "https://example.com",
  "hostname": "example.com",
  "language_code": "en",
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "relationship_counts": {
    "citation_count": 0
  },
  "fingerprint": "url:https://example.com",
  "metadata": {},
  "normalization_version": 1,
  "source_version": "version-hash"
}
```

### Citation
```json
{
  "id": "uuid",
  "source_id": "uuid",
  "source": {},
  "locator": {},
  "annotation": null,
  "excerpt": "Optional excerpt",
  "quote_text": "Transitional compatibility field",
  "renders": {
    "mla": {
      "inline": "(Doe)",
      "bibliography": "Doe. Title.",
      "footnote": "...",
      "quote_attribution": "..."
    }
  },
  "created_at": "timestamp",
  "updated_at": "timestamp",
  "relationship_counts": {
    "quote_count": 0
  }
}
```

### CitationTemplate
```json
{
  "id": "uuid",
  "name": "Custom template",
  "template_body": "{author}. {title}",
  "is_default": false,
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

## Ownership Rules

### Shared vs user-owned
- `sources` are shared canonical metadata records
- `projects` are user-owned
- `tags` are user-owned
- `citation_instances` are user-owned
- `citation_templates` are user-owned

### Access semantics
- `sources` are shared canonical metadata records and are not user-owned content rows
- Source reads do not imply ownership
- Source visibility is explicit and must remain enforced in canonical services rather than inferred ad hoc in routes
- Project, tag, citation instance, and citation template access always requires matching `user_id`
- No route should infer ownership rules independently; ownership is enforced in module services/repos

### Forbidden legacy coupling
- No flat legacy citations table
- No `citation_instances.document_id`
- No extension-only citation shadow entity
- No route-local citation/source payload semantics

## Endpoint Contract

### Top-level wrapper policy
- Top-level route wrappers may preserve existing caller-critical path behavior where necessary
- Regardless of wrapper behavior, every returned entity or item payload must match the canonical serializer shape defined in this contract

### Projects
- `GET /api/projects`
  - Returns canonical `Project[]`
- `POST /api/projects`
  - Creates canonical project
  - Returns canonical `Project`
- `GET /api/projects/{project_id}`
  - Returns canonical `Project`
- `PATCH /api/projects/{project_id}`
  - Updates canonical project
  - Returns canonical `Project`
- `POST /api/projects/{project_id}/archive`
  - Archives project
  - Returns canonical `Project`
- `POST /api/projects/{project_id}/restore`
  - Restores project
  - Returns canonical `Project`
- `DELETE /api/projects/{project_id}`
  - Deletes owned project
  - Returns `{ "ok": true, "id": "uuid" }`

### Tags
- `GET /api/tags`
  - Returns canonical `Tag[]`
- `POST /api/tags`
  - Creates canonical tag
  - Returns canonical `Tag`
- `PATCH /api/tags/{tag_id}`
  - Updates canonical tag
  - Returns canonical `Tag`
- `DELETE /api/tags/{tag_id}`
  - Deletes owned tag
  - Returns `{ "ok": true, "id": "uuid" }`
- `POST /api/tags/resolve`
  - Resolves ids and/or names into canonical reusable tags
  - Returns canonical `Tag[]`

### Sources
- `GET /api/sources`
  - Returns canonical `SourceSummary[]`
- `POST /api/sources/resolve`
  - Resolve-or-create canonical source from metadata
  - Returns canonical `SourceDetail`
- `GET /api/sources/{source_id}`
  - Returns canonical `SourceDetail`

### Citations
- `GET /api/citations`
  - Returns canonical `Citation[]`
- `POST /api/citations`
  - Creates owned citation instance against canonical source
  - Returns canonical `Citation`
- `GET /api/citations/{citation_id}`
  - Returns canonical `Citation`
- `PATCH /api/citations/{citation_id}`
  - Updates citation-scoped context only
  - Returns canonical `Citation`
- `DELETE /api/citations/{citation_id}`
  - Deletes owned citation
  - Returns `{ "ok": true, "id": "uuid" }`
- `POST /api/citations/render`
  - Accepts canonical citation-scoped inputs only
  - May refresh or select cached renders through canonical citation services
  - Returns canonical `Citation`
  - Must not be a render-only escape hatch
- `POST /api/citations/by-ids`
  - Returns canonical `Citation[]`
- `GET /api/citations/by_ids`
  - Compatibility adapter path
  - Returns canonical `Citation[]`
  - Must return the exact same canonical `Citation` item shape as canonical paths
  - Must not introduce alternate hydration, access, or serializer semantics

### Citation Templates
- `GET /api/citation-templates`
  - Pro/dev only
  - Returns canonical `CitationTemplate[]`
- `POST /api/citation-templates`
  - Pro/dev only
  - Returns canonical `CitationTemplate`
- `PUT /api/citation-templates/{template_id}`
  - Pro/dev only
  - Returns canonical `CitationTemplate`
- `DELETE /api/citation-templates/{template_id}`
  - Pro/dev only
  - Returns `{ "ok": true, "id": "uuid" }`

## Entity Relationships

### Core graph
- `sources.id -> citation_instances.source_id`
- `citation_instances.id -> citation_renders.citation_instance_id`
- `sources.id -> citation_renders.source_id`
- `citation_instances.id -> quotes.citation_id`
- `citation_instances.id -> document_citations.citation_id`

### Taxonomy links
- `projects.id` is referenced by later note/document phases
- `tags.id` is referenced by `note_tag_links` and `document_tags`

### Product pipeline
- `Sources -> Citations -> Quotes -> Notes -> Documents`

### Phase 3 guarantees
- Citation hydration always includes canonical source summary plus cached renders
- Document linkage lives in relation tables, never on citation instance rows
- Relationship counts are included only when cheap and canonical
- `relationship_counts` is optional by field
- Counts may be omitted when expensive, unstable, or not yet supported by canonical relation tables
- Omitted counts must not be replaced with speculative values

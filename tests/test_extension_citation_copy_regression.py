from pathlib import Path


def test_content_copy_assist_stays_local_but_reports_usage_in_background():
    source = Path("extension/content/capture_pill.js").read_text(encoding="utf-8")
    router_source = Path("extension/background/router.js").read_text(encoding="utf-8")

    assert "navigator.clipboard.writeText" in source
    assert "MESSAGE_TYPES.COPY_ASSIST" in source
    assert 'await queueManager.enqueue("usage_event"' in router_source
    assert 'event_type: "copy_assist"' in router_source


def test_metadata_extraction_is_best_effort_and_not_blocking_capture():
    source = Path("extension/content/metadata_extractor.js").read_text(encoding="utf-8")
    pill_source = Path("extension/content/capture_pill.js").read_text(encoding="utf-8")

    assert 'script[type="application/ld+json"]' in source
    assert 'meta[name="author"]' in source
    assert "canonical_url" in source
    assert "context.metadata.author || null" in pill_source or "context.metadata" in pill_source

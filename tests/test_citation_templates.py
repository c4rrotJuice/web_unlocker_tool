from app.services.citation_templates import render_template, validate_template


def test_validate_template_accepts_allowed_tokens():
    ok, error = validate_template("{author}. {title}. {year}. {url}")
    assert ok is True
    assert error is None


def test_validate_template_rejects_unknown_tokens():
    ok, error = validate_template("{author} {evil}")
    assert ok is False
    assert "Unsupported tokens" in (error or "")


def test_render_template_replaces_tokens_safely():
    rendered = render_template(
        "{author} ({year}). {title}. {url}",
        {"author": "Doe", "year": 2026, "title": "Paper", "url": "https://example.com", "__proto__": "x"},
    )
    assert rendered == "Doe (2026). Paper. https://example.com"

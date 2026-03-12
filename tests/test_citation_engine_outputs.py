from app.services.citation_engine import generate_citation_outputs, normalize_metadata


def test_normalize_metadata_dedupes_institutional_author_and_publisher():
    meta = normalize_metadata(
        {
            "author": "WHO",
            "publisher": "World Health Organization",
            "siteName": "World Health Organization",
            "title": "Fact sheet",
            "datePublished": "n.d.",
            "paragraph": "6",
        },
        url="https://www.who.int/news-room/fact-sheets/detail/example",
        excerpt="sample",
    )

    assert meta["author"] == "World Health Organization"
    assert len(meta["authors"]) == 1
    assert meta["paragraph"] == 6


def test_generate_citation_outputs_separates_inline_and_full():
    outputs = generate_citation_outputs(
        "apa",
        {
            "author": "World Health Organization",
            "title": "Public health update",
            "siteName": "World Health Organization",
            "url": "https://www.who.int/example",
            "datePublished": "2024-03-10",
            "paragraph": 6,
        },
    )

    assert outputs["inline_citation"] == "(World Health Organization, 2024, para. 6)"
    assert "World Health Organization. (2024)." in outputs["full_citation"]

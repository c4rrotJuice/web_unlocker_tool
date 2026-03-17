from pathlib import Path


def test_metrics_endpoint_is_not_mounted_in_canonical_app():
    main_source = Path("app/main.py").read_text(encoding="utf-8")
    assert '"/metrics"' not in main_source


def test_obsolete_metrics_doc_is_marked_historical():
    doc_source = Path("docs/ops/metrics-dashboard-alerts.md").read_text(encoding="utf-8")
    assert "Historical document" in doc_source

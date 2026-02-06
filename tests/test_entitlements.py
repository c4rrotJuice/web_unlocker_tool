from app.services.entitlements import (
    can_use_bookmarks,
    can_use_cloudscraper,
    can_use_history_search,
    normalize_account_type,
    should_show_ads,
)


def test_normalize_account_type_maps_legacy_values():
    assert normalize_account_type("freemium") == "free"
    assert normalize_account_type("premium") == "standard"
    assert normalize_account_type("standard") == "standard"
    assert normalize_account_type("pro") == "pro"


def test_can_use_cloudscraper_for_paid_tiers():
    assert can_use_cloudscraper("standard") is True
    assert can_use_cloudscraper("pro") is True
    assert can_use_cloudscraper("free") is False


def test_bookmarks_allowed_for_standard_and_pro():
    assert can_use_bookmarks("free") is False
    assert can_use_bookmarks("standard") is True
    assert can_use_bookmarks("pro") is True


def test_history_search_is_available_for_paid_tiers():
    assert can_use_history_search("free") is False
    assert can_use_history_search("standard") is True
    assert can_use_history_search("pro") is True


def test_ads_show_only_for_free():
    assert should_show_ads("free") is True
    assert should_show_ads("standard") is False
    assert should_show_ads("pro") is False

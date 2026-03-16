import pytest

from app.core.entitlements import build_capability_state, derive_capability_state, require_capability
from app.core.errors import CapabilityForbiddenError


def test_capability_payload_keeps_stable_keys_for_free():
    payload = derive_capability_state(user_id="user-1", tier="free", status="active", paid_until=None)

    assert payload.tier == "free"
    assert payload.status == "active"
    assert set(payload.capabilities.keys()) == {
        "unlocks",
        "documents",
        "exports",
        "citation_styles",
        "zip_export",
        "bookmarks",
        "reports",
        "custom_templates",
        "history_search",
        "delete_documents",
        "ads",
    }
    assert payload.capabilities["zip_export"] is False
    assert payload.capabilities["bookmarks"] is False
    assert payload.capabilities["reports"] is False


def test_capability_payload_derives_standard_and_pro_states():
    standard = derive_capability_state(user_id="user-1", tier="standard", status="active", paid_until="2099-01-01T00:00:00Z")
    pro = derive_capability_state(user_id="user-1", tier="pro", status="active", paid_until="2099-01-01T00:00:00Z")

    assert standard.capabilities["bookmarks"] is True
    assert standard.capabilities["zip_export"] is False
    assert pro.capabilities["zip_export"] is True
    assert pro.capabilities["delete_documents"] is True
    assert "custom" in pro.capabilities["citation_styles"]


def test_capability_payload_handles_grace_period_and_expired():
    grace = derive_capability_state(user_id="user-1", tier="standard", status="grace_period", paid_until="2099-01-01T00:00:00Z")
    expired = derive_capability_state(user_id="user-1", tier="standard", status="expired", paid_until="2000-01-01T00:00:00Z")

    assert grace.capabilities["bookmarks"] is True
    assert grace.capabilities["ads"] is False
    assert expired.capabilities["bookmarks"] is False
    assert expired.capabilities["documents"]["freeze"] is True


def test_capability_payload_shape_is_stable():
    tiers = ["free", "standard", "pro"]
    statuses = ["active", "grace_period", "expired", "canceled"]

    expected_keys = {
        "authenticated",
        "user_id",
        "tier",
        "status",
        "paid_until",
        "capabilities",
    }
    capability_keys = {
        "unlocks",
        "documents",
        "exports",
        "citation_styles",
        "zip_export",
        "bookmarks",
        "reports",
    }

    for tier in tiers:
        for status in statuses:
            cap = build_capability_state(tier=tier, status=status)
            assert expected_keys.issubset(set(cap.keys()))
            assert capability_keys.issubset(set(cap["capabilities"].keys()))


def test_capability_check_denies_missing_capability():
    with pytest.raises(CapabilityForbiddenError):
        require_capability("reports", capability_state={"reports": False})

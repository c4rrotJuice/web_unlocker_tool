#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PROFILES_DIR = ROOT / "profiles"
APP_FEEDBACK_DIR = ROOT.parent / "app" / "static" / "js" / "shared" / "feedback"
EXTENSION_FEEDBACK_DIR = ROOT / "shared" / "feedback"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate extension config.js and manifest.json from a profile"
    )
    parser.add_argument(
        "--profile",
        choices=["staging", "prod"],
        default=None,
        help="Build profile name. Defaults to EXTENSION_BUILD_PROFILE or 'prod'.",
    )
    return parser.parse_args()


def load_profile(profile_name: str) -> dict:
    profile_path = PROFILES_DIR / f"{profile_name}.json"
    if not profile_path.exists():
        raise RuntimeError(f"Unknown profile '{profile_name}'")

    with profile_path.open("r", encoding="utf-8") as f:
        profile = json.load(f)

    required = ["extension_name", "backend_base_url", "supabase_url", "supabase_anon_key"]
    missing = [key for key in required if not str(profile.get(key, "")).strip()]
    if missing:
        raise RuntimeError(
            f"Profile '{profile_name}' is missing required keys: {', '.join(missing)}"
        )
    return profile


def extract_origin(url: str) -> str:
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        raise RuntimeError(f"Invalid URL in profile: {url}")
    return f"{parsed.scheme}://{parsed.netloc}"


def render_template(template_path: Path, values: dict[str, str]) -> str:
    rendered = template_path.read_text(encoding="utf-8")
    for key, value in values.items():
        rendered = rendered.replace(key, value)
    return rendered


def sync_feedback_mirror() -> None:
    EXTENSION_FEEDBACK_DIR.mkdir(parents=True, exist_ok=True)
    for path in sorted(APP_FEEDBACK_DIR.glob("*.js")):
        (EXTENSION_FEEDBACK_DIR / path.name).write_text(path.read_text(encoding="utf-8"), encoding="utf-8")


def main() -> None:
    args = parse_args()
    profile_name = args.profile or os.getenv("EXTENSION_BUILD_PROFILE", "prod")
    profile_name = profile_name.strip().lower()

    if profile_name not in {"staging", "prod"}:
        raise RuntimeError(
            "EXTENSION_BUILD_PROFILE must be one of: staging, prod"
        )

    profile = load_profile(profile_name)

    replacements = {
        "__BACKEND_BASE_URL__": profile["backend_base_url"],
        "__SUPABASE_URL__": profile["supabase_url"],
        "__SUPABASE_ANON_KEY__": profile["supabase_anon_key"],
        "__EXTENSION_ENV__": profile_name,
        "__EXTENSION_NAME__": profile["extension_name"],
        "__BACKEND_ORIGIN__": extract_origin(profile["backend_base_url"]),
        "__SUPABASE_ORIGIN__": extract_origin(profile["supabase_url"]),
    }

    config = render_template(ROOT / "config.template.js", replacements)
    manifest = render_template(ROOT / "manifest.template.json", replacements)
    sync_feedback_mirror()

    (ROOT / "config.js").write_text(config, encoding="utf-8")
    (ROOT / "manifest.json").write_text(manifest + "\n", encoding="utf-8")
    subprocess.run(["node", str(ROOT / "scripts" / "build_content_bundle.mjs")], check=True)

    print(
        f"✅ Generated extension/config.js, extension/manifest.json, and bundled content runtime for '{profile_name}'"
    )


if __name__ == "__main__":
    main()

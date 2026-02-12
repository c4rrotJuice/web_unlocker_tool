import os
from dataclasses import dataclass

ALLOWED_ENVS = {"dev", "staging", "prod"}


@dataclass(frozen=True)
class EnvironmentRequirements:
    required_vars: tuple[str, ...]


ENV_REQUIREMENTS: dict[str, EnvironmentRequirements] = {
    "dev": EnvironmentRequirements(
        required_vars=(
            "SUPABASE_URL",
            "SUPABASE_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
        )
    ),
    "staging": EnvironmentRequirements(
        required_vars=(
            "SUPABASE_URL",
            "SUPABASE_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "WEB_UNLOCKER_SUPABASE_URL",
            "WEB_UNLOCKER_SUPABASE_ANON_KEY",
            "CORS_ORIGINS",
        )
    ),
    "prod": EnvironmentRequirements(
        required_vars=(
            "SUPABASE_URL",
            "SUPABASE_KEY",
            "SUPABASE_SERVICE_ROLE_KEY",
            "WEB_UNLOCKER_SUPABASE_URL",
            "WEB_UNLOCKER_SUPABASE_ANON_KEY",
            "CORS_ORIGINS",
            "PADDLE_WEBHOOK_SECRET",
        )
    ),
}


def resolve_environment() -> str:
    env = (os.getenv("ENV") or "dev").strip().lower()
    if env not in ALLOWED_ENVS:
        allowed_values = ", ".join(sorted(ALLOWED_ENVS))
        raise RuntimeError(
            f"❌ Invalid ENV '{env}'. Expected one of: {allowed_values}."
        )
    return env


def validate_environment() -> str:
    env = resolve_environment()
    required = ENV_REQUIREMENTS[env].required_vars
    missing = [name for name in required if not (os.getenv(name) or "").strip()]
    if missing:
        missing_list = ", ".join(missing)
        raise RuntimeError(
            f"❌ Missing required environment variables for ENV='{env}': {missing_list}"
        )
    return env

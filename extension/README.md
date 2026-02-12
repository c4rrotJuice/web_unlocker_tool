# Web Unlocker Extension

## Configuration & build profiles

This extension now supports profile-based builds. A single switch (`EXTENSION_BUILD_PROFILE`) chooses the environment profile and generates both `extension/config.js` and `extension/manifest.json`.

### Profiles

Profile files live in `extension/profiles/`:
- `prod.json`
- `staging.json`

Each profile defines:
- `extension_name`
- `backend_base_url`
- `supabase_url`
- `supabase_anon_key`

### Build commands

From the repository root:

```bash
# Default is prod when EXTENSION_BUILD_PROFILE is not set
python extension/scripts/build_profile.py

# Or choose explicitly
python extension/scripts/build_profile.py --profile staging
python extension/scripts/build_profile.py --profile prod

# Equivalent single-switch method via env var
EXTENSION_BUILD_PROFILE=staging python extension/scripts/build_profile.py
```

The script validates required profile keys and fails fast if a profile is missing required values.

> Note: Do **not** use the Supabase service role key in the extension.

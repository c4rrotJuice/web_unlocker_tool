# Known Limitations

- The canonical app no longer exposes the old web unlock product endpoints. Historical docs may still mention them, but they are not part of the supported runtime.
- Local development still depends on external Supabase and billing configuration unless tests or repositories are mocked.
- Some legacy service utilities remain in the repository for non-runtime support code and should not be treated as active product paths unless they are mounted or imported by canonical modules.

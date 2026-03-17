# Phase 6 — Highlight Quick Action Pill: Behavior and Flow

## Scope
This phase preserves the existing in-page quick action pill behavior shown on text selection, with actions:
- Copy
- Cite
- Note

The pill remains independent from side panel visibility and can be used without opening the side panel.

## User interaction flow

1. User highlights text on the page.
2. Content script reads selection text and computes anchor rect.
3. Quick action pill is rendered near the selection with actions `[Copy | Cite | Note]`.
4. User selects an action:
   - **Copy**: copies selected text to clipboard and dismisses pill.
   - **Cite**: opens citation popup with rendered citation formats and copy/save flows.
   - **Note**: opens note modal seeded with highlighted text and source metadata.

## Action behavior details

### Copy
- Uses clipboard API with fallback copy strategy.
- Shows success/error toast.
- Removes quick action pill after action.

### Cite
- Builds citation popup using local metadata extraction and server-render fallback.
- Supports format copy actions and citation persistence flow.
- Quick action pill is removed before popup opens.

### Note
- Opens modal with highlighted text preview and fields for note body, tags, and project.
- Saves note via background message `NOTE_SAVE`.
- Shows save result toast and closes modal.

## Stability updates in this phase
- Clearing action state when a quick action is consumed to avoid stale highlight UI.
- Preventing quick action re-trigger while interacting inside note modal content.
- Clearing highlight UI when citation popup or note modal closes.

## Message flow reference
- Quick action actions remain local-first UI interactions.
- Persistence events:
  - `SAVE_CITATION` (citation capture)
  - `NOTE_SAVE` (note capture)
# Historical document — describes transitional rebuild state.
# Do not use as operational or implementation guidance.

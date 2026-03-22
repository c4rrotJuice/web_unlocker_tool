# Phase 14 — Content Unlock Autonomous Checklist

Manual validation matrix for the autonomous page utility unlock engine in the content layer.

| Scenario | Setup | Expected result |
| --- | --- | --- |
| Blocked selection page | Page applies `user-select:none` or blocks `selectstart` | Text selection works on passive reading content |
| Blocked context menu page | Page cancels `contextmenu` on content | Native browser context menu appears on passive content |
| Blocked copy shortcut page | Page cancels `copy` or `Ctrl/Cmd+C` on selected text | Selected text copies normally |
| Blocked paste in inputs | Page cancels `paste` or `Ctrl/Cmd+V` in native controls | Native paste works in `input` and `textarea` |
| Contenteditable page | Page blocks copy or context menu inside a simple `contenteditable` region | Copy and context menu work without forcing paste behavior |
| SPA page | Navigate between mounted article routes without full reload | Style tag remains single, guards remain single, newly mounted content unlocks |
| Inputs/textareas | Test copy, cut, paste, right-click in native controls | Native editing behavior still works |
| Rich editor page | Test Monaco/CodeMirror/ProseMirror/contenteditable | No obvious caret, paste, or shortcut regression |
| Overlay-blocked article | Transparent fixed overlay intercepts content clicks/right-clicks | Overlay gets `pointer-events:none`; next interaction reaches content |
| Inline blocker page | Page uses `oncopy`, `oncontextmenu`, `onselectstart`, inline `user-select:none` | Handlers are neutralized and selection/copy/context menu are restored |

Notes:
- The autonomous engine still does not force-click through overlays.
- Editor-like apps remain conservative, especially around paste and app-owned shortcuts.

# UX + Perf audit (sprint 9 baseline)

Captured from two agent reviews. Use this as the ship-readiness backlog.

## Status after sprint 13

Done in sprint 13:
- **Themes.** Tailwind palette converted to CSS variables in `rgb(var(--c-X) / <alpha-value>)` form. Five themes shipped: midnight (default), ocean, forest, sunset, light. Each is defined under `[data-theme="…"]` in `src/renderer/index.css`. `settings.theme` is applied to `<html>` via an effect in `App.tsx`. Picker is a swatch grid at the top of Settings. The scrollbar, focus ring, and playing-pulse animation also pick up the theme accent.
- **TrimEditor canvas theming.** The waveform canvas now reads `--c-*` CSS vars via `getComputedStyle` at draw time and repaints when `settings.theme` changes. Replaced hardcoded hex (`#171a21`, `#7c5cff`, `#9479ff`, `#ffffff`) with `themeColor()` calls. The outside-selection dim uses `bg` at 60% alpha so it reads correctly on light themes too.
- **App metadata.** `app.setAboutPanelOptions` configured (name, version, copyright, credits, icon). Tray menu gained an "About Soundboard" item. Tray tooltip shows version. Header in the renderer shows a small `v{version}` chip that opens the About panel on click. `package.json` `build` block gained a `copyright` field (used by electron-builder for binary metadata).
- **README rewrite.** Restructured end-user-first: tagline → install → using it → troubleshooting → features → development at the bottom. Troubleshooting covers the common Discord/CABLE/SmartScreen/auto-PTT pitfalls. Dev section is condensed.

## Status after sprint 12

Done in sprint 12 — perf pass:
- **Perf #1** Re-render storm — verified, no action. Zustand's selector returns a boolean, so only the cards whose play-state actually flipped re-render. CSS pulse keyframe runs only on `.sb-playing` cards.
- **Perf #2** Hotkey dispatch O(N) → O(1). `ipc.ts` now builds a `Map<hash, Action[]>` for press/release at rebind time; one listener per kind looks up by `(kind:keycode/button:mods)` hash. Multiple sounds can still share a hotkey (Array values). Stop-all + clip-save are entries in the same map.
- **Perf #4** ClipBuffer pauses while window hidden. New `settings.clipBuffer.captureWhenHidden` (default off). Renderer subscribes to `document.visibilitychange` and re-runs the start/stop effect. Toggle exposed in Settings panel.
- **Perf #5** AudioEngine blob URL cache — removed entirely. Sounds now stream via `sb-file://` (existing protocol handler in `main/index.ts`, supports Range). No more per-sound Blob in memory.
- **Perf #6** TrimEditor playback restart debounced to ~80 ms during handle drag; the AudioBufferSource is no longer recreated every mousemove tick.
- **Perf #7** Foreground polling + auto-PTT focus-check now gated. Foreground poll (500 ms) only runs when the active profile has `focusFilter` or `autoPtt`. Auto-PTT's 250 ms focus check only runs when the active profile has *both* `autoPtt` and `focusFilter`. Both turn back on automatically on profile/settings change.
- **Perf #8** Clip-expire 5-minute interval now skips the IPC when `clips.length === 0`.
- **Perf #9** Tailwind `content` was already tight (`./src/renderer/index.html`, `./src/renderer/**/*.{ts,tsx}`). Verified.

Done in sprint 11: **UX #2** Button component (`primary`/`secondary` × `sm`/`md`) introduced and applied to ~40 of the canonical call sites; bespoke buttons left raw. **UX #3** Compact-cards toggle in Settings — `settings.compactCards` hides Volume/Pitch/Mode on grid cards; each card gains a `▾ More` per-instance expand. **UX #8** Undo on sound removal — backend `restoreSound` + IPC; the remove flow now pushes a 6-second toast with an `Undo` action. **UX #16** Custom profile dropdown — replaces the native `<select>` with a popover showing per-profile sound count + focus-filter chip, keyboard nav (↑↓/Enter/Esc).

Done in sprint 10: muted contrast bumped, view-mode SVG icons, useModalKeys hook (Esc), empty-state CTAs, dynamic Stop-all with toast, hide × on cards until hover, beefier playing-state (pulse + indeterminate sweep), Export/Import moved into Profile Settings, color-swatch hover affordance, TrimEditor keyboard nudge (← →, Shift, Alt), clip status migrated to ToastStack with actions, modal entry animation, focus rings (sprint 9), ConfirmDialog (sprint 9), Callout component (sprint 9).

Deferred: full modal exit animations (would need react-transition-group). Note on UX #2: the Button sweep is incomplete by design — modal "Close" buttons (`px-2 py-1 text-sm`) and bespoke patterns (`flex-1 font-mono`, conditional toggle pills, tone-specific dialog confirms) still use raw `<button>` because they don't match the canonical size grid. Worth a second pass if more variants are added (e.g. a third "sm-comfy" size, a `danger` variant).

## UX findings (ranked)

1. **Header is overcrowded** — too many same-styled pill buttons; nothing reads as primary. Move Export/Import into a profile "…" menu; demote Stop all to icon-only that activates when sounds play.
2. **Inconsistent button sizes** — 4 different `px/py` combos used at random across components. Extract a `<Button size>` wrapper.
3. **Cards too dense** — every control on every card, all the time. Hide Volume/Pitch/Mode behind a `▾` expand or show on hover.
4. **No keyboard support on modals** — no global Esc handler, no autofocus, no focus trap. Add a `useModalKeys` hook.
5. **Empty states are bare** — "No profile selected", empty Clips, "no search results" all lack a primary action button.
6. **`confirm()` / `alert()` used for destructive UX** — native dialogs break the dark theme. Replace with a `ConfirmDialog` modal in our style; errors go to `ToastStack`.
7. **Playing state too subtle** — only a border tint. Add a progress bar on the playing card + flip primary button label to `■ Stop`.
8. **Remove `×` icon easily mis-clicked** — hide unless card is hovered; add an undo toast after delete.
9. **Color swatch barely discoverable** — make it slightly larger with a chevron/palette hint on hover.
10. **TrimEditor canvas is fixed-width** — use ResizeObserver to recompute peaks; add `←/→` to nudge handles.
11. **No `:focus-visible` rings on buttons** — keyboard users have no indicator.
12. **Muted text contrast borderline** — `#8b91a3` on `surface2` is ~5.1:1. Bump to `#a4aab8`.
13. **Inline warnings each reinvent the callout shape** — make a `<Callout tone="warn|danger|info">` component.
14. **View-mode toggle (▦/☰) uses unreliable Unicode glyphs and inactive `text-muted` looks disabled** — swap to inline SVGs (or lucide icons) and use `text-text`.
15. **Clip-saved toast lives in the wrong corner** — duplicates `ToastStack`. Migrate to the global stack with action buttons.
16. **Native `<select>` for profile dropdown** — can't show sound count / focus filter. Replace with a custom dropdown.
17. **No transitions on modal open/close + no card reorder smoothness** — add fade/scale on modals, `transition-transform` on cards.
18. **FirstRunWizard has no test-tone step** — superseded by sprint 9 wizard.
19. **Tab order is unmanaged** — wrap header in `role="toolbar"`; modals should autofocus primary action.
20. **Stop-all gives no feedback** — toast "Stopped N sounds"; gray out when nothing plays.

## Perf findings (ranked)

1. **`playingSoundIds: Set<string>` causes all card components to re-render on every play/stop** — Zustand notifies every subscriber on Set replacement. Switch selector to `(s) => s.playingSoundIds.has(soundId)` (already is, but the Set reference change forces re-evaluation) and either use a `Map<id, boolean>` or split into per-id atoms. Also the pulse `box-shadow` keyframe is on the compositor every frame.
2. **Hotkey dispatch is O(N) — every keystroke fans out across every bound sound's listener** — replace with `Map<hash, binding>` lookup.
3. **yt-dlp.exe (~18MB) shipped in installer** — most users never URL-import. Lazy-download to userData on first use; saves 10–15% of total install.
4. **ClipBuffer keeps running while window is hidden to tray** — pause on visibilitychange / tray-hide to save ~10–15MB RAM + 1–3% CPU.
5. **AudioEngine blob URL cache grows unbounded** — switch to streaming via the existing `sb-file://` protocol, or LRU-cap at ~20 entries.
6. **TrimEditor restarts the source node on every handle drag tick** — debounce restart to 50–100ms; or update `loopStart`/`loopEnd` in place.
7. **Foreground polling + auto-PTT polling both running unconditionally** — skip when no profile uses focus filter or autoPtt.
8. **clip-expire interval runs even with 0 clips** — skip when empty.
9. **Tailwind `content` may not be tight** — verify `tailwind.config.js` only scans the renderer.

## Things confirmed fine (do NOT touch)
- `protocol.handle('sb-file', …)` streams with range requests
- IPC handler registration is one-shot
- `clearBindings()` cleanup is correct
- Main process doesn't hold AudioBuffers
- electron-store writes are tiny
- `externalizeDepsPlugin()` keeps main/preload lean
- `extraResources` doesn't include dev deps

# Roadmap

Items deliberately not implemented yet, with the reason each was deferred. Ordered by value.

## 1. Workspace persistence

Everything vanishes on a reload except the theme. This is the biggest real gap.

- New `src/state/workspace.ts`: one versioned key (`netpol.workspace.v1`) holding `{ policies, activeId, ui: { theme, lang } }`.
- Debounced autosave (~400 ms) plus a `beforeunload` flush so an in-progress edit is never lost.
- Restore on mount; seed one default policy for a first visit.
- Versioned key so a schema change can migrate or discard cleanly rather than crash.
- **Export all / import all** (JSON and a YAML bundle) in the YAML panel — the practical substitute for sync.
- Deletes the ad-hoc `pages[]` + `stateRef` plumbing in `App.tsx`, which today snapshots state by hand before every tab switch. That hand-rolled snapshotting is the "edits lost when switching pages" hazard.
- While in there, write `localStorage['netpol-lang']`: `detectLocale` already reads it, nothing writes it, so the browser language silently wins next session.

## 2. Accessibility

Icon-only buttons now carry `aria-label` in addition to `title` (`title` is *not* an
accessible name for a `<button>`, so most screen readers announce nothing). Both dialogs —
the rule dialog and the pod selector modal — declare `role="dialog"` + `aria-modal="true"`
and close on Escape and on a backdrop click. What is still missing:

- Focus trap and focus return in both dialogs: focus is left where the dialog was opened
  from, Tab can wander out of the panel, and closing does not send focus back to the
  trigger. Escape is keyboard-only for closing.
- `role="tablist"` / `aria-selected` on the policy page bar and the YAML format tabs. The
  page tabs are not keyboard-reachable at all — they are `<div onClick>`.
- Keyboard equivalents for the canvas: the group add buttons and the rule rows are
  clickable but not focusable, and the rule dialog's type grid is mouse-only.
- `aria-live="polite"` on the validation panel so new warnings are announced.
- The page tab label is `contentEditable` with no `role="textbox"` and no way to leave it
  other than Enter.

## 3. Draggable cards

Cards sit in three fixed columns. The live editor drags them freely.

- Requires `react-diagram`, whose `accessPoint` handles replace the current SVG arrow layer.
- Needs position state in the model — nothing about `x`/`y` exists today, so there is no half-finished state to reconcile.
- Deliberate call to keep the fixed layout for now: the current three-column arrangement already communicates direction, and the arrow layer is 137 lines instead of a new dependency plus a second rendering model.

## 4. Multiple `specs`

Cilium's `specs[]` is deny-by-default per spec, and this is the mechanism for "allow DNS, deny everything else".

- The model, both generators and the parser already handle it.
- Only spec 1 is editable. Adding a spec, switching between them, and marking one `endpointSelector` as the default are all UI work.

## 5. L7 rules

HTTP, DNS, TLS and context rules are parsed and preserved verbatim through a round-trip, but not editable. Authoring them means a rule block inside a port entry — substantial UI for a use case most policies never hit.

## 6. Services

`toServices` with `k8sService` and `k8sServiceSelector` is in the model and the generator. There is no picker for it yet, so it only arrives via YAML import.

## 7. Deployment artifacts

Dropped when the upstream CI/CD was removed, since they referenced it:

- `Dockerfile`, `docker-compose.yml`, `nginx.conf` — restore if a container image is wanted. `vite build` already emits a static `dist/`.
- `.github/` workflows and the badges that pointed at them.
- `GitVersion.yml` — `__APP_VERSION__` is therefore always `dev` unless `APP_VERSION` is set at build time.

## 8. `namespaceExpressions` in the UI

Cilium's `io.kubernetes.pod.namespace` `matchExpressions` are imported and regenerated
verbatim — a policy that narrows a namespace with `In` or `NotIn` round-trips faithfully —
but there is no UI for them.

Deliberately skipped: `ExpressionEditor` accepts bare keys, so a value entered there would
come back unprefixed and the generated YAML would silently stop matching what it matched.
Editing them needs the prefix pinned, which means a special-cased field or a two-part
"namespace + operator" control rather than the generic expression row.

## 9. Screenshots and docs polish

`docs/image.png` is the upstream screenshot. New screenshots of the dual-format tabs and the Chinese locale would replace it.

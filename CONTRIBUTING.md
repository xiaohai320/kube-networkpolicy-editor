# Contributing

Thanks for your interest in contributing.

## Development Setup

```bash
npm install
npm run dev        # → http://localhost:5173
```

Hot module replacement is on. No Docker file ships with this fork — `vite build` emits a static `dist/`.

## Before Opening a PR

All three must be green:

```bash
npm test           # vitest — generators, parser, round-trip, reducer, i18n, canvas, smoke
npm run typecheck  # tsc -b --noEmit, strict mode
npm run build      # tsc -b && vite build
```

The `tsc` gate is the strictest: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`.

## Code Style

- Functional React components with hooks; `useReducer` + Context for state, no external state library.
- Tailwind v4 theme tokens only — no hardcoded colors. Use `text-text-primary`, `bg-card-bg`, `border-card-border`, etc.
- `src/lib/**` stays free of user-facing strings. Validators and summaries return `Msg` (`{ key, params? }`); the UI renders them.
- TanStack Table columns are built through `buildColumns(t)` + `useMemo(..., [t])`. Do **not** build them per render — cells use `useState`, and re-registering hooks loses focus on every keystroke. `t` is stable per language, so columns only rebuild on a locale switch.

## i18n Rules

- Message keys are flat and hyphen-delimited (`'summary-open-internet'`), not nested. `keySeparator` and `nsSeparator` are both `false`, so a `.` in a key would be looked up literally.
- Add a key to **both** `src/i18n/en.ts` and `src/i18n/zh.ts`. `zh` is typed against `en`, so a missing or renamed key is a compile error — the build will tell you which.
- `{{label}}` and `{{message}}` placeholders hold *translated* text. To compose one message inside another, pass a nested `Msg` as the param value: `tr()` resolves nested params before interpolating. Never concatenate two translated strings yourself.
- YAML identifiers stay English in both locales — `matchName`, `matchPattern`, `host`, `remote-node`, `Kubernetes Network Policy`. They are identifiers, not prose; translating them makes the UI disagree with the YAML it is editing.

## Adding a New Rule Type

1. Add the variant to `EndpointKind` and `ENDPOINT_DEFAULTS` in `src/types/policy.ts`.
2. Update `isK8sUnrepresentable` in the same file if the type cannot be expressed as a K8s `NetworkPolicy`.
3. Add a picker entry in `src/components/canvas/RulePickers.tsx`.
4. Add the editor fields in `src/components/canvas/RuleGroupCard.tsx`.
5. Extend `endpointSummary` in `src/lib/summarize.ts`.
6. Extend both generators (`yaml-gen-k8s.ts`, `yaml-gen-cilium.ts`) and both parsers in `yaml-parser.ts`.
7. Add validation in `src/lib/validators.ts` — return a `Msg`, never a sentence.
8. Add golden tests to `test/yaml-gen.test.ts`, `test/yaml-parser.test.ts` and, ideally, `test/roundtrip.test.ts`. Round-trip parity — `parse(generate(p))` equals `p` modulo ids — is the real contract.
9. Add any new message keys to both dictionaries (see i18n Rules).

## Adding Theme Tokens

1. Add the CSS custom property in `src/index.css` under `@theme`.
2. Define values in both `:root` (dark) and `[data-theme="light"]`.
3. Use the token class in components.

## Project Layout

| Directory | Purpose |
|-----------|---------|
| `src/types/` | `Policy`, `PolicySpec`, the `Endpoint` union, defaults |
| `src/state/` | Reducer, action creators, context provider |
| `src/lib/` | Pure functions — generators, parser, validators, ratings, summaries |
| `src/i18n/` | Dictionaries, init, `useTranslation`, locale toggle |
| `src/components/canvas/` | Visual editor (columns, cards, arrows) |
| `src/components/editors/` | TanStack Table inline editors |
| `src/components/yaml/` | YAML panel, display, rating |
| `src/components/ui/` | Shared UI primitives |
| `test/` | Vitest suites; DOM tests opt in per file with `// @vitest-environment happy-dom` |

## Commit Messages

Concise and descriptive:

```
feat: add FQDN rule support for Cilium policies
fix: correct namespace label mapping in the Cilium parser
docs: update the README with the dual-format flow
```

## Reporting Issues

Please include:

- Steps to reproduce, expected vs actual behavior.
- Browser and OS.
- A YAML sample for parser/generator bugs — the round-trip tests make these very easy to reproduce.

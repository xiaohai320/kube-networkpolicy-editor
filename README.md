# Network Policy Editor

A browser-based visual editor for Kubernetes `NetworkPolicy` and Cilium `CiliumNetworkPolicy`. Build and visualize policies on a canvas, then export either format as YAML — or paste YAML in and edit it visually.

Runs standalone in the browser, or deploy it into your cluster to read and edit the policies that are already there (see [Cluster mode](#cluster-mode)).

Inspired by [editor.networkpolicy.io](https://editor.networkpolicy.io/). Built as a fork of [kpod](https://github.com/Blackout-Industries/kpod) — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

## Quick Start

```bash
npm install
npm run dev        # → http://localhost:5173
```

```bash
npm run build      # tsc -b (strict) + vite build → dist/
npm run preview
npm test           # vitest
npm run typecheck  # tsc -b --noEmit
```

Requires Node 18.18+, per `package.json` `engines`. Vite 6 itself accepts 18, 20 and 22+.

## Cluster mode

Deployed in-cluster, the editor lists the cluster's NetworkPolicies and
CiliumNetworkPolicies in a side panel, loads one into a page on click, and
writes edited policies back with server-side apply (conflicts surface as 409
with a refresh prompt — nothing is overwritten silently).

```bash
kubectl create namespace netpol-editor
kubectl apply -f deploy/
```

The in-cluster deployment uses the pod's ServiceAccount; RBAC is defined in
`deploy/clusterrole.yaml` (list/get/patch on both policy kinds cluster-wide —
or use the namespaced variant in `deploy/namespaced.md`).

Local development connects to any cluster from the dev server: open the
cluster panel (cloud icon, top-left), paste your API server URL and a bearer
token — they live in sessionStorage only, never on disk. The dev server
forwards `/k8s/*` requests so CORS never applies.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 + TypeScript (strict) |
| Build | Vite 6 |
| Styling | Tailwind CSS v4 |
| Tables | TanStack Table v8 |
| Icons | Lucide React |
| YAML | js-yaml 4 |
| i18n | i18next + react-i18next |
| State | useReducer + Context |
| Tests | Vitest + happy-dom + Testing Library |

## Project Structure

```
src/
├── types/policy.ts        # Policy / PolicySpec / Endpoint union + defaults
├── state/                 # Reducer, action creators, context provider
├── lib/
│   ├── yaml-gen-k8s.ts        # Kubernetes NetworkPolicy generator
│   ├── yaml-gen-cilium.ts     # CiliumNetworkPolicy generator
│   ├── yaml-parser.ts         # Import parser, auto-detects K8s vs Cilium
│   ├── label-utils.ts         # Label formatting, prefix handling, fingerprints
│   ├── summarize.ts           # One-line peer summaries, returned as i18n keys
│   ├── validators.ts          # Field validators + policy-level warnings
│   └── policy-rating.ts       # Security strength scoring
├── i18n/
│   ├── en.ts / zh.ts          # Dictionaries; zh is type-checked against en
│   ├── index.ts               # init, useTranslation, nested-message renderer
│   └── LocaleToggle.tsx
├── components/
│   ├── canvas/                  # Visual editor (columns, cards, arrows)
│   ├── editors/                 # TanStack Table editors (labels, ports, CIDRs)
│   ├── yaml/                    # YAML panel (tabs, display, rating)
│   └── ui/                      # Shared UI (divider, theme toggle, tabs)
└── hooks/useTheme.ts            # Dark/light theme persistence

test/                          # Vitest: generators, parser, round-trip, i18n, smoke
```

## Supported Policy Features

### Kubernetes NetworkPolicy
- `podSelector` with `matchLabels` and `matchExpressions`
- `namespaceSelector`, including the empty `{}` (cluster-wide) form
- `ipBlock.cidr` with `except`
- Ports (TCP, UDP, SCTP, ranges, named ports)
- `policyTypes` (Ingress, Egress)

### Cilium CiliumNetworkPolicy
- `fromEndpoints` / `toEndpoints` with `matchLabels` and `matchExpressions`
- Entities — `all`, `world`, `cluster`, `host`, `remote-node`, `kube-dns`
- FQDN rules — `toFQDNs` with `matchName` and `matchPattern`
- CIDR rules — `fromCIDR`/`toCIDR` and `fromCIDRSet`/`toCIDRSet` with `except`
- `ingress: [{}]` / `egress: [{}]` deny-all markers
- Namespace conventions — `k8s:` label prefix, `io.kubernetes.pod.namespace`

Cilium-only constructs used in a K8s-format policy are flagged in the validation panel and dropped rather than silently mis-emitted.

## Known Limitations

- **No persistence yet.** The theme survives a reload; the policies themselves do not. Workspace autosave is the next item on [docs/ROADMAP.md](docs/ROADMAP.md).
- **Fixed layout.** Cards sit in three fixed columns. Card positions are not saved and are not draggable — that upgrade would add `react-diagram`.
- **Single spec in the UI.** Cilium's `specs[]` exists in the model and in the generators; only spec 1 is editable.
- **No L7 authoring.** HTTP/DNS/TLS/context rules are parsed and preserved but not editable.

## License

[MIT](LICENSE). This project derives from [kpod](https://github.com/Blackout-Industries/kpod), MIT-licensed — attribution is retained in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).

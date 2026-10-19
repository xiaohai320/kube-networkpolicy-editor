# Spec: Namespace Topology Dashboard (拓扑看板)

Status: done (implemented 2026-10-19, commit 55f9cc3, deployed)

## Problem Statement

The editor works on one policy at a time. An operator looking at a namespace today cannot answer the basic questions the policies collectively determine: which pods can talk to which, what is isolated, and which policy is responsible for an allow. With the cluster currently holding zero policies, the "all pods fully open" state is itself an unanswerable question without a view that reads everything at once.

## Solution

A read-only topology dashboard: pick a namespace, and the board renders a React Flow graph derived entirely from the existing NetworkPolicies, CiliumNetworkPolicies, and Cilium ClusterwideNetworkPolicies plus the namespace's actual pods. Green edges are allowed paths (the editor's existing visual language); nodes are aggregated workloads; special endpoints (world, host, kube-apiserver, CIDRs, other namespaces) sit at the edges of the graph. Clicking a node or edge reveals the policies responsible, and any policy can be loaded into the editor for editing.

## User Stories

1. As an operator, I want to pick a namespace from a dropdown (all namespaces, those with policies first), so that I can inspect the network posture I care about.
2. As an operator, I want pods grouped into aggregated nodes by owner workload + policy-selector scope, so the graph stays readable at any replica count.
3. As an operator, I want each node to show instance count and aggregate readiness (green = all Running, orange = some not), so I can see scale and health at a glance.
4. As an operator, I want a node carrying a default-deny badge (red) when every ingress (or egress) path into (out of) it is denied, so I can spot isolation without reading YAML.
5. As an operator, I want a green edge between two nodes when at least one policy allows traffic on that path, so the graph answers "who can talk to whom".
6. As an operator, I want pairs "mentioned by a policy but denied" to show NO edge, so denial is legible by absence rather than a red-line flood.
7. As an operator, I want outside endpoints (world, host, kube-apiserver, each CIDR, each other referenced namespace) rendered as distinct special nodes with icons, so egress/ingress reach is visible.
8. As an operator, I want other-namespace nodes to be clickable to jump to that namespace's dashboard, so I can navigate across namespaces without the dropdown.
9. As an operator, I want to click a pod node and see a side drawer listing every policy affecting it (NP / CNP / CCNP grouped), so I can find the responsible policy.
10. As an operator, I want each drawer entry to offer "load into editor", so I can fix the policy I just found.
11. As an operator, I want to click an edge and see which policy rules allow that path, so I can audit why a connection is possible.
12. As an operator, I want a namespace with zero policies to render its pods as grey nodes with an explanatory empty state ("no policies — everything is unrestricted"), so I recognize the exposure immediately.
13. As an operator, I want a manual refresh button (no auto-polling), so I know exactly when I'm looking at a snapshot.
14. As an operator, I want the layout computed automatically (dagre) and nodes NOT draggable, so the graph is always legible and consistent.
15. As a cluster admin, I want the new read access to be pods get/list and ciliumclusterwidenetworkpolicies get/list only, so the dashboard adds no write surface.

## Implementation Decisions

- Entry point: full-screen overlay opened from the top bar (a new button beside the cluster-panel Cloud button); dropdown for namespace on the left, canvas on the right.
- Aggregation: pods in the selected namespace are grouped by (owner workload, matching policy-selector sets). Node label is the workload name + ×N instance count badge.
- Edge semantics: an edge exists iff at least one policy (NP/CNP/CCNP) admits traffic between the two endpoints in at least one direction. Ingress and egress merge into one edge per node pair when both directions admit. Policies that mention a pair without admitting produce no edge. Denial is shown via the default-deny badge on nodes, never red edges.
- Special endpoints per type: world, host, kube-apiserver, CIDR block, other namespace. Other-namespace nodes are clickable (jump switches the dropdown and re-renders).
- CCNP semantics: clusterwide policies apply to every endpoint in the namespace when computing paths; no need to render the CCNP "scope" specially.
- Data: on open and on namespace switch, fetch pods + namespaced NPs + CNPs + CCNPs via the existing `/k8s` passthrough proxy (no backend logic changes, ADR-0001). Manual refresh button re-fetches.
- RBAC (deploy/clusterrole.yaml): add `pods: get,list` (core) and `ciliumclusterwidenetworkpolicies: get,list` (cilium.io). Nothing else.
- Modules: `src/components/topology/` — `TopologyDashboard.tsx` (overlay + namespace selection + drawer), `topology-engine.ts` (pure functions: pods + policies → graph), `TopologyCanvas.tsx` (React Flow render), `dagre-layout.ts`. Engine is fully pure and unit-tested; canvas reuses the flow/ node-card visual style.
- Editor jump: reuse the existing load-from-cluster flow (creates a new editor page tab).
- npm install (dagre) via the Nexus mirror.

## Testing Decisions

- The engine is the only real logic: unit-test selector matching, aggregation, allowed-path derivation, CCNP inclusion, empty-namespace behavior, and special-endpoint grouping as pure functions — no DOM.
- UI: mount-smoke the dashboard via the existing RF polyfill pattern (test/rf-polyfill.ts); assert node/edge counts from the engine output and key interactions (drawer opens, namespace jump) at the component level.
- Prior art: test/canvas.test.tsx asserts graph DATA from pure functions rather than RF's rendered paths; follow the same split.

## Out of Scope

- Editing anything inside the dashboard (all edits happen in the editor).
- Live traffic data / Hubble integration.
- Auto-refresh or websockets.
- Rendering pods of OTHER namespaces individually (they aggregate to one node per namespace).
- NetworkPolicy status fields, CNP node-status/watching agent states.

## Further Notes

- The cluster currently has zero policies; the empty state is the first impression and is deliberately a first-class design element (story 12).
- Cluster facts verified live: Cilium is installed (ciliumendpoints present), CCNP CRD present, SA already lists NPs/CNPs cluster-wide but cannot list pods.
- Glossary updated: Topology Dashboard, Aggregated Node, Allowed Path, Special Endpoint (CONTEXT.md).

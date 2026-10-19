# Follow-ups: namespace topology dashboard

State: none open. All code-review findings fixed in commit 55f9cc3.

## Old Cilium deny-marker encoding (compat note, 2026-10-19)

Before commit 3e3e41f the editor's Cilium deny badge emitted `ingress: [{}]`.
Real Cilium reads an empty rule object as the allowAll wildcard — those
policies ALLOWED everything on the cluster despite the editor showing deny.
No live policy carries that encoding (verified 2026-10-19: zero CNPs in the
cluster), so no migration is needed; the new parser imports such a policy as
allow-all, which matches what the cluster was actually doing.

Deferred candidates (not bugs, out of spec scope):
- Auto-refresh (polling or watch) — spec explicitly out of scope.
- Per-pod cross-namespace nodes — spec chose namespace-aggregated nodes.
- Contentful CCNP namespaceSelector re-check in the drawer trusts the
  board's graph decision (ns labels live in the engine call, not the
  drawer); revisit if the drawer ever loads ns labels itself.

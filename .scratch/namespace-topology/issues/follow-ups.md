# Follow-ups: namespace topology dashboard

State: none open. All code-review findings fixed in commit 55f9cc3.

Deferred candidates (not bugs, out of spec scope):
- Auto-refresh (polling or watch) — spec explicitly out of scope.
- Per-pod cross-namespace nodes — spec chose namespace-aggregated nodes.
- Contentful CCNP namespaceSelector re-check in the drawer trusts the
  board's graph decision (ns labels live in the engine call, not the
  drawer); revisit if the drawer ever loads ns labels itself.

# ADR-0003: Admin settings persist in a ConfigMap/Secret, not the Deployment env

Date: 2026-10-14
Status: accepted

## Context

The deployed editor lets its admin manage the OIDC allowlist and the built-in
password from the UI. The container's filesystem is read-only, so those
changes must outlive the process somewhere in the cluster.

The first implementation PATCHed the editor Deployment's own `env` array
(strategic merge, RBAC-limited to that one resource). It worked, but env vars
are **pod-template** state: every save created a new ReplicaSet and rolled the
pod. Sessions live in process memory, so every admin save logged every user
out — the admin could not add a user without kicking everyone, including
during the very login flow that prompted the change.

## Decision

Admin settings persist to two namespaced objects, created on first save and
merge-patched after:

- ConfigMap `netpol-editor-settings` — `allowedUsers` (comma-separated)
- Secret `netpol-editor-settings` (Opaque) — `adminPassword` (base64)

Env vars remain the bootstrap values only. At startup (first auth-relevant
request) the objects are read if present and **win over env**; a save never
touches the pod template, so no restart and no session loss.

RBAC: the editor ServiceAccount gets `get/create/patch` on exactly these two
resourceNames; the old `deployments` patch rule is removed.

## Consequences

- Changing the allowlist or password no longer restarts the pod; sessions
  survive admin saves.
- The password sits in a Secret instead of plain env — a modest reading
  improvement, not a security boundary (the SA can read it by design).
- Persistence failures degrade to the existing `warning` field; memory-first
  semantics stay.
- First save does a GET → create round-trip (strategic-merge PATCH does not
  create objects).

# Delete cluster policies — spec

Status: ready-for-agent

## Problem Statement

一个只读的集群清单没法管理策略。用户发现集群里积累了不再需要的网络策略（手工试验的残留、迁移后的旧版本），只能切到 `kubectl` 手工删除——离开编辑器、切上下文、重新拼命令行，而删除恰恰是编辑器已经"看见"了资源（清单里就有 kind/namespace/name）却做不了的事。对批量清理的场景，`kubectl delete np -l ...` 这类命令对不熟悉 label 选择器的用户也不友好。

## Solution

从集群清单侧栏直接删除：单条策略在行内发起，二次确认后删除；多条策略复选多选后批量删除。删除走既有的后端代理（纯透传，无需新端点），语义完全来自 kube-apiserver。危险操作的三重防线：确认弹窗逐行列出、Fleet/Helm 受管策略给重建警告、批量执行尽力而为并把结果（成功计数 + 失败明细）回显给用户。删除不影响正在编辑的页签——页签是本地模型，与集群操作独立。

## User Stories

1. As a policy editor user, I want a delete button on each cluster inventory row, so that I can remove an unwanted policy without leaving the editor.
2. As a policy editor user, I want a confirmation dialog that shows the kind, namespace, and name of the policy, so that I never delete the wrong resource by a mis-click.
3. As a policy editor user, I want Fleet/Helm-managed policies flagged in the confirm dialog ("may be recreated"), so that I am not surprised when a deleted policy reappears.
4. As a policy editor user, I want the dialog to tell me when the policy is open in N editor tabs ("tabs are kept"), so that I understand the tab is a local model that survives the delete.
5. As a policy editor user, I want a checkbox per inventory row to select multiple policies, so that I can clean up several leftovers in one pass.
6. As a policy editor user, I want an action bar with a "Delete (N)" button to appear only when N ≥ 1 rows are selected, so that the selection UI stays out of the way otherwise.
7. As a policy editor user, I want the bulk confirm dialog to list every selected policy row by row, so that the dialog is the last line of defense against a mis-selection.
8. As a policy editor user, I want managed policies marked per-row in the bulk dialog with a single explanatory note at the bottom, so that I can uncheck them before committing.
9. As a policy editor user, I want bulk delete to be best-effort (a failure does not stop the remaining deletes), so that one RBAC gap in one namespace doesn't block cleaning up the rest.
10. As a policy editor user, I want 404 during bulk delete treated as already-deleted (success), so that retries and races don't pollute the result.
11. As a policy editor user, I want a result panel after bulk delete showing the success count and each failure with the apiserver's message, so that I know exactly what happened and what to retry.
12. As a policy editor user, I want the inventory refreshed after I close the result panel, so that the list reflects what actually remains in the cluster.
13. As a policy editor user, I want deleting a policy that is open in a tab to leave the tab untouched, so that my local model survives; a subsequent "apply" from that tab then creates the policy again, which matches the origin semantics.
14. As a dev-mode user, I want delete to use the same dev headers as list/load, so that dev and in-cluster mode behave identically.
15. As a cluster admin, I want the service account to hold the `delete` verb on network policies (both kinds), so that the editor can perform the deletes it exposes.
16. As a policy editor user, I want multi-spec K8s policies to remain individually visible and individually deletable in the inventory, so that "what I see is what I delete" holds even for the name-1/name-2 generated resources.
17. As a policy editor user, I want all delete UI (dialog, action bar, result panel) themed with the editor's existing tokens, so that light and dark modes both look right.

## Implementation Decisions

- **Delete is client-side through the existing proxy.** The backend stays byte-for-byte passthrough (ADR-0001); DELETE requests forward like everything else. No new endpoint, no server logic.
- **New cluster-api function**: `deleteClusterPolicies(refs: ClusterPolicyRef[]): Promise<DeleteReport>` — sequential best-effort DELETE per ref. 404 counts as success (already gone); any other failure (403, 405, 5xx) is captured into the report without stopping the loop. Returns `{ deleted: number; failed: Array<{ ref: ClusterPolicyRef; message: string }> }`.
- **Managed-policy detection**: a policy is "managed" when it carries `fleet.cattle.io/*` or `helm.sh/*` labels or annotations. The inventory already fetches minimal items; extend the list call to surface the metadata needed for detection so the panel can render the flag without an extra fetch.
- **Confirm dialog (single)**: kind/ns/name line; managed warning when detected; "open in N tabs" note when the policy matches an open editor page (matched by namespace+name+kind).
- **Bulk flow**: checkboxes on rows (selection state is filtered-view scoped); action bar with "Delete (N)" appears when selection is non-empty; dialog lists all selected rows with per-row managed flags and one bottom note; after confirm, run best-effort delete, then reuse the dialog shell as a result panel (success count + failed rows with upstream messages); closing it triggers a `refresh()`.
- **Selection clears** when the list reloads (refresh/load/reset filter) — stale indices must never carry over.
- **Tabs are untouched by delete.** The editor page is a local model; the origin/apply semantics already handle the recreate-on-apply case. The dialog merely informs.
- **RBAC**: add `delete` to the `networkpolicies` and `ciliumnetworkpolicies` verbs in both the ClusterRole and the namespaced install doc. This is the risk-bearing step — the SA can now remove policies cluster-wide (namespaced install: within the namespace).
- **i18n**: new keys for delete/confirm/managed-warning/open-in-tabs/bulk action bar/result panel; both en and zh.

## Testing Decisions

- Good tests assert external behavior: what request goes out, what the UI shows, what state results — never internal call ordering.
- **cluster-backend.test.ts seam (existing)**: the proxy test seam stubs global fetch and asserts the app forwards verbatim. Add a test that a DELETE request forwards method, path, and returns the upstream status — proving the passthrough needs no code change (it should pass without touching the app; it pins the contract).
- **cluster-api delete unit tests (new, same seam as label-picker.test.ts)**: stub fetch at the `/k8s/*` boundary; assert sequential DELETE per ref with the right paths; 404 → counted as deleted; 403 captured into `failed` without stopping; mixed report shape.
- **ClusterPanel UI tests (new, smoke-style rendering)**: render the panel with a stubbed list; select rows, assert the action bar appears with the count; open the bulk dialog, assert all rows are listed; run a mixed-success delete and assert the result panel shows count + failures; assert refresh happens on close. Login-gate seam identical to smoke.test.tsx (stub /auth/me, use findBy*).
- Prior art: cluster-backend.test.ts (app seam), label-picker.test.ts (cluster-api seam), smoke.test.tsx (rendered-app seam).

## Out of Scope

- Deleting anything other than NetworkPolicy / CiliumNetworkPolicy resources.
- Single-policy dry-run or preflight validation before delete.
- Auto-cascade delete of the `name-*` siblings of a multi-spec K8s policy (the inventory shows each as its own row; the user deletes what they see).
- Deletion history / undo / recycle bin.
- Batch operations other than delete (e.g. bulk apply).
- kubectl-style label-selector based mass delete from the panel.

## Further Notes

- Delete semantics come entirely from the apiserver: no server-side softening of errors, no retries by the proxy.
- The `delete` verb grant is the acceptance gate for the whole feature; if the cluster's RBAC is applied by Fleet, the ClusterRole change must ride the same pipeline as the editor's deployment.
- Sessions/auth are unaffected: `/k8s/*` DELETE passes the same session gate as GET/PATCH.

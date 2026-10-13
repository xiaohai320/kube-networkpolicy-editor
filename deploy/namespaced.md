# Namespaced deployment variant

Cluster-wide read access is not always acceptable. To confine the editor to a
single namespace, replace the ClusterRole/ClusterRoleBinding with the Role
below — the editor then lists and edits policies only in its own namespace.

Limitations (documented per spec):
- The cluster inventory side panel lists only the editor's own namespace.
- Applying to resources in other namespaces fails with a 403 from the
  apiserver, surfaced verbatim in the UI.

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: netpol-editor
  namespace: netpol-editor
rules:
  - apiGroups: ["networking.k8s.io"]
    resources: ["networkpolicies"]
    verbs: ["get", "list", "patch", "create"]
  - apiGroups: ["cilium.io"]
    resources: ["ciliumnetworkpolicies"]
    verbs: ["get", "list", "patch", "create"]
  # Template labels of workloads feed the label pickers ("from cluster").
  # Namespace-scoped resources: listable inside this Role's namespace only.
  - apiGroups: ["apps"]
    resources: ["deployments", "statefulsets", "daemonsets"]
    verbs: ["list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: netpol-editor
  namespace: netpol-editor
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: netpol-editor
subjects:
  - kind: ServiceAccount
    name: netpol-editor
    namespace: netpol-editor
```

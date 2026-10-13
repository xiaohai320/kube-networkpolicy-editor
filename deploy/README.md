# Deploy

```bash
kubectl apply -f deploy/ -n netpol-editor   # or: kubectl apply -f deploy/
```

The manifests create the `netpol-editor` namespace implicitly only via the
namespace field; create it first: `kubectl create namespace netpol-editor`.

Build and push the image first (see the root Dockerfile); edit the image
reference in `deployment.yaml`.

For a single-namespace install see [namespaced.md](namespaced.md).

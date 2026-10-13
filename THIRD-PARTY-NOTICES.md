# Third-Party Notices

## kpod — the fork this project is based on

This repository is a fork of [kpod](https://github.com/Blackout-Industries/kpod), a browser-based visual editor for Kubernetes and Cilium network policies.

The original code, layout, canvas design and synthwave theming were taken from that project and adapted. The MIT terms are preserved: this project's [LICENSE](LICENSE) is MIT, and the following notice must be retained in all copies or substantial portions of the software.

```text
MIT License

Copyright (c) 2026 Network Policy Editor Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

Original project: <https://github.com/Blackout-Industries/kpod>

### What was changed from upstream

- **Data model rewritten** — the flat `PolicyRule` was replaced by a two-level `Policy` → `PolicySpec` → `Endpoint` union so Cilium entities, `matchExpressions`, `matchName` and CIDR sets can be expressed at all.
- **Both YAML generators and the parser rewritten** around that model.
- **i18n added** — English and Simplified Chinese, selected from the toolbar.
- **Tests added** — Vitest suites for the generators, parser, round-trip parity, i18n and a React smoke render. Upstream shipped with none.
- **Removed** — `Dockerfile`, `docker-compose.yml`, `nginx.conf`, `GitVersion.yml`, `.github/` workflows and the badges that pointed at them.
- **Not changed** — the three-column canvas layout, the SVG arrow layer, and the `src/index.css` theme tokens.

### Reference material consulted

- [editor.networkpolicy.io](https://editor.networkpolicy.io/) — the target of the visual and behavioural design.
- The [Cilium documentation](https://docs.cilium.io/) for `CiliumNetworkPolicy` semantics.
- The [Kubernetes documentation](https://kubernetes.io/docs/concepts/services-networking/network-policies/) for `NetworkPolicy` semantics.

Neither editor.networkpolicy.io nor its implementation is vendored into this repository.

## Dependencies

Third-party packages are listed in `package.json` / `package-lock.json` and carry their own licenses; they are not copied into this source tree.

| Package | License |
|---------|---------|
| react, react-dom | MIT |
| i18next, react-i18next | MIT |
| js-yaml | MIT |
| @tanstack/react-table | MIT |
| lucide-react | ISC |
| tailwindcss | MIT |
| vite, @vitejs/plugin-react, @tailwindcss/vite | MIT |
| vitest, happy-dom, @testing-library/* | MIT |

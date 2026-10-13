# ADR-0001: 集群访问采用 in-cluster 后端代理（Hono），dev 模式浏览器直连

日期：2026-10-13
状态：已接受

## 背景

原项目是纯浏览器 SPA（"No backend"）。要读取并写回 K8s 集群中的 NetworkPolicy / CiliumNetworkPolicy，浏览器必须访问 kube-apiserver。直连有三个障碍：CORS（apiserver 默认不发 CORS 头）、凭证管理（token 落浏览器）、未来 watch/CRD 扩展。

## 决策

- **部署形态**：前后端打成单一镜像。后端用 Node + Hono（TypeScript，与前端同仓同语言，可直接 import `src/types/policy.ts`），职责限定为：serve 静态 `dist/` + 代理 K8s REST API。in-cluster 用 ServiceAccount 自动鉴权。
- **API 路径约定**：前端永远请求同源 `/k8s/*`。生产由 Hono 承接；本地 dev 由 Vite dev server 代理转发到用户在 UI 里填写的 API server 地址 + token（token 仍由 UI 提供，存 sessionStorage）。前端代码零分支。
- **本地 dev 鉴权**：UI 粘贴 token + API server 地址。token 存 sessionStorage（不落盘）；401 清凭证弹连接面板，403 保留凭证透传 apiserver 原始 RBAC 消息。
- **写回语义**：Server-Side Apply（`fieldManager=netpol-editor`），冲突返回 409 → 前端提示刷新重试，不做 force、不静默覆盖。

## 后果

- README 的 "No backend" 定位改变；后端刻意保持极薄（转发 + RBAC 错误透传），不引入业务逻辑。
- 部署交付物：`Dockerfile` + `deploy/`（SA、ClusterRole、ClusterRoleBinding、Deployment、Service、Ingress），另附 namespaced Role 变体文档（清单仅限本 ns）。
- dev 直连依赖 Vite 代理解决 CORS，不要求用户改集群配置。

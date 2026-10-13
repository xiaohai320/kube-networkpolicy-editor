Status: ready-for-agent
Feature: cluster-mode

# Spec: 集群模式 (Cluster Mode)

## Problem Statement

用户在浏览器里用这个编辑器只能编辑**粘贴进来**的策略 YAML。真实工作流里，策略已经存在于 K8s 集群中（NetworkPolicy 与 CiliumNetworkPolicy），用户必须先 `kubectl get -o yaml`、手工复制到编辑器、改完再 `kubectl apply` 回去。这个往返摩擦大、易出错（复制遗漏、覆盖别人的修改），且对复杂 Cilium 策略（如带 L7 HTTP 规则的）编辑器无法表达，导入即丢失编辑能力。

用户想要的：把编辑器部署到集群里，直接读取集群已有策略进行可视化编辑，编辑完安全地写回；同时复杂 Cilium 策略里最常见的 L7 HTTP 规则（method + path）能真正被编辑。

## Solution

1. **集群模式**：新增一个轻量 Hono 后端，部署为单一镜像（serve 前端静态资源 + 代理 K8s API）。前端统一请求同源 `/k8s/*`；本地 dev 由 Vite 代理转发到用户在 UI 粘贴的 API server 地址 + token。前端代码在两种形态下零分支。
2. **集群侧栏**：新增可开合侧栏，展示集群策略清单（kind / namespace / name），支持按命名空间过滤与搜索；点击载入为新编辑页签。
3. **应用到集群**：编辑器内一键 create/update 当前 Policy，使用 Server-Side Apply，冲突（409）提示刷新重试，绝不静默覆盖。
4. **HTTP L7 规则**：Cilium `toPorts[].rules.http[]` 建模为 `method` + `path` 两个可编辑字段，进 canvas 规则对话框；其余 L7 细节（headers/host/Kafka/DNS）及 icmps/authentication 仍走"不可表示规则"逐字保留通道。

按 ADR-0001（后端代理架构）与 ADR-0002（统一模型 + unsupported 保留通道）执行。术语见 CONTEXT.md。

## User Stories

1. 作为集群管理员，我想把编辑器部署进集群，以便团队所有人用浏览器直接编辑集群里的网络策略。
2. 作为集群管理员，我想用一套 manifests（SA/ClusterRole/Binding/Deployment/Service/Ingress）完成部署，以便安装不需要人工步骤。
3. 作为权限敏感的集群管理员，我想用 namespaced Role 变体部署，以便不给编辑器全集群读权限。
4. 作为开发环境的使用者，我想在 `npm run dev` 下粘贴 API server 地址与 token 就能连上集群，以便不用部署也能用集群功能。
5. 作为开发环境的使用者，我想让 token 只存 sessionStorage，以便刷新即失效、凭证不落盘。
6. 作为开发环境的使用者，我想在 token 过期（401）时被清掉凭证并弹回连接面板，以便立刻知道该重贴 token。
7. 作为权限不足的使用者，我想在 403 时看到 API server 的原始 RBAC 消息，以便知道去补什么权限而不是怪工具坏了。
8. 作为使用者，我想在侧栏看到全集群的策略清单（kind / namespace / name），以便找到我要编辑的策略。
9. 作为使用者，我想按命名空间过滤清单并搜索名字，以便在策略很多时快速定位。
10. 作为使用者，我想点开清单里的一项才拉取完整 spec，以便首次加载快、不浪费集群 API 流量。
11. 作为使用者，我想让点开的策略直接变成一个编辑页签，以便用现有的多策略工作流并行编辑多份集群策略。
12. 作为使用者，我想在"应用到集群"时对已存在的资源做 Server-Side Apply 更新，以便不会静默覆盖别人的字段。
13. 作为使用者，我想在写回冲突（409）时看到明确的"集群侧已变化，请刷新重试"提示，以便不丢集群侧的修改。
14. 作为使用者，我想对本地新建的策略直接按编辑器内的 name/namespace 创建到集群，以便不用经过"另存为"弹窗。
15. 作为使用者，我想让写回的 kind 跟随 YAML 面板当前格式页签，以便把 NetworkPolicy 转写为 CiliumNetworkPolicy（或反向）。
16. 作为使用者，我想在写回成功后看到页签的同步状态更新为"已同步"，以便知道编辑器与集群一致。
17. 作为使用者，我想在页签显示"来自集群 + 未同步"状态，以便知道当前编辑尚未落回集群。
18. 作为使用者，我想编辑 Cilium 策略里 HTTP 规则的 method 和 path，以便可视化地管理 API 级访问控制。
19. 作为使用者，我想在导入含 headers/host/Kafka/DNS/icmps/authentication 的策略时不丢字段，以便导出仍是完整的原策略。
20. 作为使用者，我想在规则对话框里为端口规则附加 HTTP 过滤，以便一条规则同时表达"开放 80 端口 + 只允许 GET /api"。
21. 作为使用者，我想看到 L7 规则被保留的注释提示（现状机制），以便知道哪些规则编辑器不能改。
22. 作为后端运维，我想让后端保持极薄（转发 + RBAC 错误透传），以便审计和升级都简单。
23. 作为后端运维，我想让凭证只在后端（in-cluster SA）或 sessionStorage（dev）出现，以便 token 不进入 localStorage 或日志。
24. 作为开发者，我想让前端对"本地 dev"与"集群部署"零分支，以便两种形态不会各写一套调用逻辑。
25. 作为开发者，我想让 round-trip 对含 HTTP L7 规则的策略无损，以便集群里读到的策略改完写回不变形。
26. 作为使用者，我想在侧栏区分 NetworkPolicy 与 CiliumNetworkPolicy，以便一眼知道每个策略的 kind。

## Implementation Decisions

- **后端（新增）**：Node + Hono，TypeScript，与前端同仓。职责仅两项：serve `dist/` 静态资源；`/k8s/*` 代理转发到 kube-apiserver。in-cluster 用 ServiceAccount token（`/var/run/secrets/kubernetes.io/serviceaccount/`）+ CA cert；本地 dev 后端不参与（Vite 代理直转）。后端不引入业务逻辑，错误（401/403/409）原样透传 status 与 body。
- **代理契约**：前端永远请求 `/k8s/<api-path>`。代理转发 method/path/query/body，附带上游凭证，返回 status + body 透传。写操作使用 Server-Side Apply：`Content-Type: application/apply-patch+yaml`，query `?fieldManager=netpol-editor&force=false`，409 原样返回。
- **Vite dev 代理**：`/k8s/*` 在 dev 下转发到 UI 粘贴的目标地址与 token（代理配置在 dev server 运行期读取用户输入）。生产无此层。
- **前端客户端（新增）**：一个薄的集群 API 客户端模块，封装 list（全集群，含 kind 区分 NP/CNP）、get（单个完整 spec）、apply（SSA）。仅此三操作，无删除。
- **前端状态（扩展）**：Policy 增加"来源"标记（本地/集群载入）与"同步状态"（未同步/已同步/冲突）。载入集群策略走现有 add-page 路径。
- **UI（扩展）**：可开合集群侧栏（清单、ns 过滤、搜索）；页签与 YAML 面板加"应用到集群"入口及同步状态指示；连接面板（dev：粘贴地址 + token，存 sessionStorage；401 清凭证弹回，403 透传 RBAC 消息）。
- **数据模型（扩展，遵循 ADR-0002）**：端口规则新增可选 L7 字段：HTTP 的 `method`（受限枚举）与 `path`（字符串，支持正则语义由 Cilium 侧解释）。含 headers/host/Kafka/DNS 的 toPorts 组整体走 unsupported 通道；icmps、authentication 同理。
- **生成器/解析器（扩展）**：Cilium 生成器把可建模的 `rules.http[]`（仅 method/path）写入 toPorts 组；解析器识别仅含 method/path 的 L7 组进模型，其余进 unsupported。K8s 格式不受影响。
- **部署（新增）**：`Dockerfile`（多阶段：build 前端 + 产物进运行镜像）；`deploy/` 下 SA、ClusterRole（list/get/update NP + CNP 全集群）、ClusterRoleBinding、Deployment、Service、Ingress；`deploy/namespaced.md` 文档化 Role 变体及其清单局限。
- **README**：更新部署说明，"No backend" 定位改为说明集群模式。

## Testing Decisions

- **只测外部行为**：生成器/解析器测 YAML 输入输出；后端测 HTTP 请求/响应；前端测 reducer 状态迁移与组件渲染交互。不测内部函数签名或私有 helper。
- **Seam 1（既有）**：`detectAndParse` + Cilium 生成器 round-trip 覆盖 HTTP L7：导入含 `rules.http`（method/path）→ 生成 → 断言无损；含 headers/host 的组进 unsupported 断言保留。先例：roundtrip.test.ts、yaml-parser.test.ts。
- **Seam 2（唯一新缝隙）**：Hono app 级测试——对 app 发 fetch，stub 上游 K8s API。断言：代理路径/query/SSA header 转发正确；401/403/409 透传；静态资源 serve。不测代理内部。
- **Seam 3（既有模式）**：reducer 测来源/同步状态/载入/冲突迁移（先例 reducer.test.ts）；侧栏与"应用到集群"按钮用 opt-in 组件测试（先例 rule-dialog.test.tsx）。
- 不新增更低缝隙（如单独测客户端 URL 拼装）——属 Seam 2 的转发行为。

## Out of Scope

- 删除集群资源（写回仅 create/update）。
- `kubectl proxy` 集成、kubeconfig 文件解析。
- DNS/Kafka L7 规则编辑（保留为 unsupported）。
- `icmps`、`authentication`、`fromRequires`/`toRequires`、CiliumClusterwideNetworkPolicy。
- watch 实时同步、策略 diff 视图、多用户冲突协调（超出 409 提示）。
- Helm chart、CI 发布流水线。
- localStorage 工作区持久化（Roadmap 第 1 项，独立推进）。

## Further Notes

- 术语与决策来源：2026-10-13 grilling 访谈（17 问），ADR-0001、ADR-0002。
- 前端零分支依赖 `/k8s/*` 路径约定：dev 由 Vite 代理、生产由 Hono 承接——这是本 spec 的核心架构不变量，任何实现不得偏离。
- namespaced 变体的局限要在文档中明示：清单只能列本命名空间。
- 现有 `pages[]` + `stateRef` 手工快照是"切页丢失编辑"隐患（见 docs/ROADMAP.md 第 1 项），集群侧栏载入页签复用该路径时注意不要加重此问题；彻底解决归工作区持久化 spec，不在本 spec 内。

# CONTEXT.md

领域术语表。此文件只有术语与定义，不含实现细节。术语键为英文（与代码、issue 文件名一致），说明为中文。

## 策略 (Policy)

内存中的一份策略，统一表示 Kubernetes `NetworkPolicy` 或 Cilium `CiliumNetworkPolicy`。一个 Policy 拥有 `name`、`namespace`、`format` 和若干 Spec（选择器组）。

- 不与任何单一 CRD 一一对应：它是可序列化为两种 `format` 的中间表示。
- **来源 (origin)**：一个 Policy 要么是本地创建的，要么是从集群载入的。来源决定"应用到集群"是 create 还是 update 候选。

## 格式 (Format)

序列化目标：`k8s`（Kubernetes NetworkPolicy）或 `cilium`（CiliumNetworkPolicy）。同一 Policy 可切换格式导出；写回集群时的 kind 跟随当前格式页签。两种格式都有字段无法表达的对象——见"不可表示规则"。

## 选择器组 (Spec / Selector Group)

策略作用到的一组 endpoint 及其规则集（ingress/egress）。Cilium 的 `specs[]` 多组与 K8s 的单一 `spec` 都归一为此概念；单组序列化为 `spec`，多组为 `specs[]`。

## 对端 (Endpoint)

一条规则里通信的另一端。按 `kind` 区分：`all`、`cidr`、`fqdn`、`entity`、`kube-dns`、`labels`、`service`。互斥变体，不允许字段堆叠。

## 列分组 (RuleGroup)

canvas 三列语义：`outside`（集群外）、`namespace`（本策略命名空间内）、`cluster`（集群内任意处）。列分组决定 `kind: 'all'` 的含义，因此 peer 同时携带 `group` 与 `kind`。

## 默认拒绝 (Default Deny)

方向的显式全拒绝。K8s 侧由 `policyTypes` 表达，Cilium 侧是 `ingress: [{}]` 空规则标记。存在任一规则本身已隐含该方向拒绝，默认拒绝标志只用于"拒绝一切、放行无物"。

## 不可表示规则 (Unsupported Rules)

编辑器数据模型无法表示的规则。导入时**逐字保留**（verbatim），生成时原样追加回 YAML 并加注释标注——绝不静默丢弃。对 K8s 不可表示的 peer（fqdn/entity/service）与对 Cilium 不可表示的规则（L7 非 HTTP-method/path 部分、icmps、authentication 等）都走此通道。

## HTTP L7 规则 (HTTP L7 Rules)

Cilium `toPorts[].rules.http[]` 中由 `method` + `path`（支持正则）组成的过滤条件。这是编辑器唯一建模的 L7 层；它不是一种 Endpoint，而是挂在端口规则上的约束。

## 集群模式 (Cluster Mode)

通过部署于集群内的后端代理读取/写回真实集群资源的运行形态，与"本地模式"（纯浏览器编辑）相对。

## 应用到集群 (Apply)

把当前 Policy 经后端代理写回集群的 create/update 操作。写回使用 Server-Side Apply；资源版本冲突时报错提示刷新，绝不静默覆盖。新建场景直接按编辑器内的 name/namespace 创建。

## 从集群删除 (Delete from Cluster)

从集群清单发起的删除操作：对单个资源发 DELETE，或对多选集合尽力而为地逐条删除。删除的对象是**集群里的单个资源**（K8s 多 spec 策略的衍生资源在清单里各自独立，所见即所删）。

- **不可逆**：需要显式确认（单条弹窗 / 批量逐行列出）；确认前对带 Fleet/Helm 管理标记的策略给出"可能被重建"提示。
- **尽力而为 (best-effort)**：批量删除逐条执行，404 视为已删除，真失败（如 403）收集后统一报告，不中断其余删除。
- **页签独立**：删除不影响正在编辑该策略的页签；页签的本地模型继续存在，此时"应用到集群"退化为 create——这正是"来源 (origin)"语义的体现。

## 集群清单 (Cluster Inventory)

懒加载的集群策略列表（kind / namespace / name）。先列清单，点开才拉取完整 spec 载入为一个编辑页签。删除操作从清单发起，支持复选多选。

## 拓扑看板 (Topology Dashboard)

只读的集群侧视图：对每个命名空间，从已有的 NetworkPolicy、CiliumNetworkPolicy（含 Clusterwide）推导出"谁允许连到谁"的图。与编辑器 (Policy 编辑) 互补——编辑器改一份策略，看板看全部策略合起来的效果。

## 聚合节点 (Aggregated Node)

拓扑图的节点。被同一组策略 selector 选中且同 owner（Deployment/StatefulSet/DaemonSet）的 pod 聚合为一个节点，标注实例数。图上永远不逐个画 pod。

## 允许路径 (Allowed Path)

两个节点之间存在至少一条策略允许的通信通路。看板只画允许路径；"被策略覆盖但默认拒绝"不画线，由节点上的**默认拒绝角标**表达。允许即绿线，与编辑器的视觉语言一致。

## 特殊端点 (Special Endpoint)

拓扑图中命名空间之外的通信端：世界 (world)、主机 (host)、kube-apiserver、CIDR 段、以及**其他命名空间**。各按类型聚合为一个节点；其他命名空间节点可点击跳转到那个命名空间的看板。

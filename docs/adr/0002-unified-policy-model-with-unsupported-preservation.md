# ADR-0002: 统一策略模型 + 不可表示规则逐字保留通道

日期：2026-10-13
状态：已接受（既有设计，随集群读取功能扩展而再次确认）

## 背景

编辑器同时面向 Kubernetes NetworkPolicy 与 CiliumNetworkPolicy，且从集群导入的现有策略必然包含编辑器未建模的字段（L7 规则细节、icmps、authentication 等）。若导入即丢弃或报错，用户将无法用编辑器处理真实策略。

## 决策

- **统一模型**：K8s 与 Cilium 共用一个内存模型（`Policy` / `PolicySpec` / `Endpoint` 判别联合），不维护两套平行类型。`format` 字段只决定序列化目标。
- **互斥 peer 变体**：Endpoint 按 `kind` 判别（all/cidr/fqdn/entity/kube-dns/labels/service），禁止可选字段堆叠。
- **不可表示规则逐字保留**：导入时解析不了的规则原样存入 `Policy.unsupported`，生成时逐字追加回 YAML 并以注释标注。绝不静默丢弃，也不为兼容而模糊化模型。
- **L7 范围**：只建模 HTTP 的 `method` + `path`；其余 L7（headers/host/Kafka/DNS）与 `icmps`、`authentication` 走 unsupported 通道。

## 后果

- round-trip（导入→导出）对任何输入都是无损的：能编辑的规则被转换，不能编辑的原样保留。
- 模型保持严谨：新增字段必须以判别变体或显式扩展进入，而不是往扁平对象里加可选字段。
- 代价是生成器/解析器需要维护 unsupported 通道的往返逻辑（已实现并有测试覆盖）。

/**
 * Simplified Chinese, typed against the shape of `en`. A missing or renamed
 * key is therefore a compile error rather than a silent fall-through to
 * English.
 *
 * Kubernetes field names (`matchName`, `matchPattern`, `host`, `remote-node`)
 * and YAML identifiers stay in their original form on purpose: they are
 * identifiers, not prose, and translating them would make the UI disagree
 * with the YAML it is editing.
 */
import type { en } from './en';

export const zh = {
  // ── 元数据校验 ──────────────────────────────────────────────────
  'name-required': '策略名称不能为空',
  'name-too-long': '策略名称最多 253 个字符',
  'name-invalid': '只能用小写字母、数字和连字符（例如 my-policy）',

  'namespace-required': '命名空间不能为空',
  'namespace-too-long': '命名空间最多 63 个字符',
  'namespace-invalid': '只能用小写字母、数字和连字符（例如 default）',

  // ── 标签校验 ────────────────────────────────────────────────────
  'label-key-required': '键不能为空',
  'label-key-separators': '键最多只能包含一个 / 分隔符',
  'label-prefix-too-long': '键前缀最多 253 个字符',
  'label-prefix-invalid': '键前缀无效（必须是 DNS 子域名）',
  'label-name-length': '键名称长度为 1-63 个字符',
  'label-name-invalid': '键名称无效',
  'label-key-too-long': '键最多 63 个字符',
  'label-alnum': '必须以字母或数字开头和结尾，可包含 . _ -',
  'label-value-too-long': '值最多 63 个字符',

  // ── 端口与 CIDR 校验 ────────────────────────────────────────────
  'port-range': '端口必须是 1-65535',
  'port-required': '端口不能为空',
  'port-range-start': '范围起始值必须是 1-65535',
  'port-range-end': '范围结束值必须是 1-65535',
  'port-range-order': '范围结束值必须大于等于起始值',
  'port-named-too-long': '命名端口最多 15 个字符',
  'port-named-invalid': '命名端口只能用小写，须以字母开头，仅含 a-z 0-9 -',

  'cidr-required': 'CIDR 不能为空',
  'cidr-prefix-required': '必须包含前缀长度（例如 10.0.0.0/8）',
  'cidr-invalid-ip': '无效的 IPv4 地址',
  'cidr-prefix-invalid': '前缀长度必须是 0-32',
  'cidr-exception-subset': '例外必须是主 CIDR 的子集',

  // ── 主机名校验 ──────────────────────────────────────────────────
  'hostname-required': '主机名不能为空',
  'pattern-required': '模式不能为空',
  'hostname-no-spaces': '主机名不能包含空格',
  'hostname-too-long': '主机名最多 253 个字符',
  'hostname-label-too-long': '主机名每一段最多 63 个字符',
  'hostname-label-invalid': '无效的主机名分段',
  'hostname-wildcard-position': '通配符必须位于开头的 `*.`',

  // ── 告警面板 ────────────────────────────────────────────────────
  'count-errors': '{{count}} 个错误',
  'count-warnings': '{{count}} 个警告',
  'count-infos': '{{count}} 条提示',

  'summary-empty-policy': '未定义任何规则 —— 此策略不会生效',
  'summary-duplicate-ingress': '{{count}} 条重复的入站规则',
  'summary-duplicate-egress': '{{count}} 条重复的出站规则',
  'summary-k8s-unrepresentable': '{{endpoint}} 无法用 Kubernetes NetworkPolicy 表达',
  'summary-fqdn-ingress': 'FQDN 规则只适用于出站方向',
  'summary-open-cidr': '0.0.0.0/0 允许所有流量',
  'summary-duplicate-ports': '端口/协议条目重复',
  'summary-no-ports': '未指定端口 —— 允许所有端口',
  'summary-open-internet': '对整个互联网开放',
  'summary-all-namespaces': '匹配所有命名空间中的 Pod',
  'summary-empty-pod-selector': '空的 Pod 选择器会匹配作用域内的所有 Pod',

  'summary-fqdn-invalid': '{{label}} FQDN：{{message}}',
  'summary-cidr-invalid': '{{label}} CIDR：{{message}}',
  'summary-exception-invalid': '{{label}} 例外 "{{value}}"：{{message}}',
  'summary-port-invalid': '{{label}} 端口 {{value}}：{{message}}',

  'label-key-invalid': '{{label}} 键 "{{value}}"：{{message}}',
  'label-value-invalid': '{{label}} 值 "{{value}}"：{{message}}',
  'selector-pod': '{{dir}} Pod 选择器',
  'selector-needs-value': '{{label}} "{{key}}" 使用 {{operator}} 时至少需要一个值',
  'selector-no-value': '{{label}} "{{key}}"：{{operator}} 不能带值',

  // ── 字段、表头与按钮 ────────────────────────────────────────────
  'field-cidr': 'CIDR',
  'field-except-cidr': '例外 CIDR',
  'field-fqdn-name': '精确主机名（matchName）',
  'field-fqdn-pattern': '通配模式（matchPattern）',
  'field-entity': '实体',
  'field-namespace': '命名空间',
  'field-service-name': 'Service 名称',
  'field-namespace-labels': '命名空间标签',
  'field-pod-selector': 'Pod 选择器',
  'field-expressions': '匹配表达式',
  'field-ports': '端口',
  'field-scope': '作用域',

  'header-key': '键',
  'header-value': '值',
  'header-port': '端口',
  'header-protocol': '协议',

  'action-add-label': '添加标签',
  'label-pick-from-cluster': '从集群选择',
  'label-pick-loading': '正在加载工作负载…',
  'label-pick-empty': '未找到工作负载标签',
  'label-pick-load-error': '加载集群标签失败',
  'action-add-port': '添加端口',
  'action-add-expression': '添加表达式',
  'action-add-exception': '添加例外',
  'action-add-cidr': '添加 CIDR',

  'placeholder-cidr': '10.0.0.0/8',
  'placeholder-hostname': 'api.example.com',
  'placeholder-fqdn-pattern': '*.example.com',
  'placeholder-namespace': 'kube-system',
  'placeholder-service-name': 'dns',
  'placeholder-all-namespaces': '* 表示所有命名空间',
  'placeholder-policy-name': 'my-network-policy',
  'placeholder-namespace-field': 'default',
  'placeholder-port': '端口（1-65535）',
  'placeholder-label-key': 'key',
  'placeholder-label-value': 'value',
  'placeholder-expression-key': 'app',
  'placeholder-expression-values': '值，逗号分隔',

  // ── 画布 ────────────────────────────────────────────────────────
  'direction-ingress': '入站',
  'direction-egress': '出站',
  'direction-ingress-sources': '入站来源',
  'direction-egress-destinations': '出站目标',

  'group-outside': '集群外部',
  'group-namespace': '命名空间内',
  'group-cluster': '集群内',

  // 每个分组标题下的一行说明，讲清楚该分组的可达范围。
  // 命名空间内这一行最关键：Peer 与策略同处一个命名空间，因此该列无需选择命名空间。
  'group-outside-desc': '集群外的端点',
  'group-namespace-desc': '本策略所在命名空间内的 Pod',
  'group-cluster-desc': '集群内任意命名空间的 Pod',

  'dialog-new-rule': '新建{{group}}的{{direction}}规则',
  'dialog-edit-rule': '编辑{{group}}的{{direction}}规则',
  'dialog-rule-type': '规则类型',
  'dialog-add-rule': '添加规则',
  'action-delete': '删除',
  'action-close': '关闭',

  'picker-cilium-only': '（仅 Cilium）',
  'picker-added': '已添加',

  'picker-all-outside': '任意端点',
  'picker-any-pod': '任意 Pod',
  'picker-all-cluster': '集群内所有资源',
  'picker-cidr': 'CIDR',
  'picker-fqdn': 'FQDN',
  'picker-pod-selector': 'Pod 选择器',
  'picker-host': '宿主机',
  'picker-remote-node': '远端节点',
  'picker-kube-dns': 'Kubernetes DNS',

  'picker-ports-any': '可指定端口，也可不指定',
  'picker-cidr-example': '例如 10.2.1.0/28',
  'picker-fqdn-example': '例如 *.example.com',
  'picker-selector-example': '例如 env=prod, app=frontend',
  'picker-entity-host': 'Cilium `host` 实体',
  'picker-entity-remote-node': 'Cilium `remote-node` 实体',
  'picker-kube-dns-ports': '向 kube-dns 开放 {{port}}/{{protocol}}',

  'endpoint-any-endpoint': '任意端点',
  'endpoint-all-cluster': '集群内所有资源',
  'endpoint-any-pod': '任意 Pod',
  'endpoint-any-pod-all-namespaces': '任意 Pod（所有命名空间）',
  'endpoint-all-pods': '命名空间内所有 Pod',

  // 同行摘要中的取值都是 YAML 标识符，按原样显示
  'endpoint-cidr': '{{value}}',
  'endpoint-fqdn': '{{value}}',
  'endpoint-entity': '{{value}}',
  'endpoint-expression': '表达式',
  'endpoint-fqdn-label': 'FQDN',
  'endpoint-service': 'Service',
  'endpoint-service-names': '{{namespace}}/{{name}}',
  'endpoint-labels': '{{body}}',
  'endpoint-labels-ns': '{{namespace}}：{{body}}',

  'endpoint-kube-dns': 'Kubernetes DNS',
  'endpoint-kube-dns-detail': '（kube-system，k8s-app=kube-dns）',

  // ── 目标 Pod 节点 ───────────────────────────────────────────────
  'target-default-deny': '默认拒绝',
  'target-default-allow': '默认允许',
  'target-click-allow': '{{label}}：点击以允许全部',
  'target-click-deny': '{{label}}：点击以拒绝全部',
  'target-rules-implied': '{{label}}：{{count}} 条规则，已隐式默认拒绝',
  'target-allow-list': '{{count}} 条规则',

  // ── Pod 选择器弹窗 ──────────────────────────────────────────────
  'modal-title': 'Pod 选择器配置',
  'modal-policy-name': '策略名称',
  'modal-namespace': '命名空间',
  'modal-select-all': '选择命名空间内所有 Pod（空选择器）',
  'modal-pod-labels': 'Pod 选择器标签',
  'modal-expressions': '匹配表达式',
  'modal-cancel': '取消',
  'modal-save': '保存',

  // ── YAML 面板 ───────────────────────────────────────────────────
  'tab-k8s': 'Kubernetes Network Policy',
  'tab-cilium': 'Cilium Network Policy',
  'action-copy': '复制',
  'action-copied': '已复制！',
  'action-download': '下载',
  'action-upload': '上传',
  'action-dismiss': '关闭',

  'error-parse-file': 'YAML 解析失败',
  'error-parse-inline': '无效的 YAML',
  'error-invalid-yaml': '无效的 YAML：{{message}}',
  'error-no-policy': 'YAML 中未找到策略',
  'error-unsupported-kind': '不支持的类型：{{kind}}',
  'error-no-supported-kind': '未找到受支持的策略',
  'error-mixed-kinds': '同一文档中混合了多种策略类型：{{kinds}}',

  // ── 工具栏 ──────────────────────────────────────────────────────
  'theme-switch': '切换到{{mode}}模式',
  'theme-light': '亮色',
  'theme-dark': '深色',
  'action-add-page': '新建策略页面',
  'action-locale-en': 'English',
  'action-locale-zh': '中文',

  'rate-1': '弱',
  'rate-2': '一般',
  'rate-3': '良好',
  'rate-4': '强',
  'rating-title': '安全性：{{label}}（{{rating}}/4）',

  // ── Cluster mode ───────────────────────────────────────────────────
  'auth-title': '登录',
  'auth-username': '用户名',
  'auth-password': '密码',
  'auth-login': '登录',
  'auth-oidc': '通过 OIDC 登录',
  'auth-bad-credentials': '用户名或密码错误',
  'auth-login-failed': '登录失败',
  'auth-logout': '退出登录',
  'auth-users-title': '用户管理',
  'auth-allowed-users': '允许登录的用户（OIDC）',
  'auth-new-username': 'OIDC 用户名，如 jdoe',
  'auth-add-user': '添加',
  'auth-no-users': '还没有允许的用户——请在下方添加',
  'auth-users-load-error': '加载用户列表失败',
  'auth-users-save-error': '更新用户列表失败',
  'auth-change-password': '修改管理员密码',
  'auth-current-password': '当前密码',
  'auth-new-password': '新密码（至少 8 位）',
  'auth-password-changed': '密码已修改',
  'auth-password-weak': '新密码太短（至少 8 位）',
  'auth-persist-warning': '已保存，但写入集群失败——pod 重启后将丢失该修改',

  'cluster-panel-title': '集群策略',
  'cluster-connect': '连接',
  'cluster-connected': '已连接',
  'cluster-api-url': 'API Server 地址',
  'cluster-token': 'Bearer Token',
  'cluster-load': '加载策略',
  'cluster-loading': '加载中…',
  'cluster-empty': '未找到策略',
  'cluster-apply': '应用到集群',
  'cluster-applying': '应用中…',
  'cluster-applied': '已应用',
  'cluster-synced': '已同步',
  'cluster-unsynced': '未同步',
  'cluster-conflict': '其他控制器（如 Helm/Fleet）管理着此策略的重叠字段，重试将写入你的版本并接管这些字段',
  'cluster-apply-force': '强制应用',
  'cluster-error-401': '未授权 —— Token 无效或已过期',
  'header-method': '方法',
  'header-path': '路径',
  'action-remove': '移除 HTTP 过滤',
  'cluster-namespace-filter': '命名空间…',
  'cluster-search': '搜索…',
  'cluster-load-error': '加载集群策略失败',
  'cluster-apply-error': '应用到集群失败',
  'cluster-select-row': '选择',
  'cluster-delete': '删除',
  'cluster-delete-selected': '删除所选',
  'cluster-delete-one-title': '从集群删除',
  'cluster-delete-bulk-title': '从集群删除策略',
  'cluster-delete-confirm': '删除',
  'cluster-delete-deleting': '删除中…',
  'cluster-delete-open-tabs': '该策略正在 {{n}} 个页签中编辑 —— 页签会保留。',
  'cluster-delete-open-tabs-bulk': '其中 {{n}} 条策略正在页签中编辑 —— 页签会保留。',
  'cluster-delete-managed-row': 'Fleet/Helm 管理',
  'cluster-delete-managed-note': '带标记的策略由 Fleet 或 Helm 管理，删除后可能被自动重建。',
  'cluster-delete-result-title': '删除完成',
  'cluster-delete-result-summary': '已删除 {{deleted}} 条，失败 {{failed}} 条',
  'cluster-delete-result-failed-heading': '失败',


} satisfies Record<keyof typeof en, string>;

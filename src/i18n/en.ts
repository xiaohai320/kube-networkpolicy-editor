/**
 * English is the base dictionary. Every other locale is typed against this
 * shape, so TypeScript fails the build if a key goes missing or is renamed in
 * only one language.
 *
 * Keys are flat and hyphen-delimited on purpose: `.` is i18next's default
 * `keySeparator`, and these keys need to be addressable as-is rather than as
 * nested paths.
 *
 * `{{label}}` and `{{message}}` are placeholders filled with *translated* text
 * (see `tr` in `index.ts`), so a warning can compose another message rather
 * than duplicating its wording.
 */
export const en = {
  // ── Metadata validation ────────────────────────────────────────────
  'name-required': 'Policy name is required',
  'name-too-long': 'Policy name must be 253 characters or fewer',
  'name-invalid': 'Must be lowercase alphanumeric with hyphens (e.g. my-policy)',

  'namespace-required': 'Namespace is required',
  'namespace-too-long': 'Namespace must be 63 characters or fewer',
  'namespace-invalid': 'Must be lowercase alphanumeric with hyphens (e.g. default)',

  // ── Label validation ───────────────────────────────────────────────
  'label-key-required': 'Key is required',
  'label-key-separators': 'Key can have at most one / separator',
  'label-prefix-too-long': 'Key prefix must be 253 chars or fewer',
  'label-prefix-invalid': 'Invalid key prefix (must be a DNS subdomain)',
  'label-name-length': 'Key name must be 1-63 chars',
  'label-name-invalid': 'Invalid key name',
  'label-key-too-long': 'Key must be 63 chars or fewer',
  'label-alnum': 'Must start/end with alphanumeric, can contain . _ -',
  'label-value-too-long': 'Value must be 63 chars or fewer',

  // ── Port and CIDR validation ───────────────────────────────────────
  'port-range': 'Port must be 1-65535',
  'port-required': 'Port is required',
  'port-range-start': 'Range start must be 1-65535',
  'port-range-end': 'Range end must be 1-65535',
  'port-range-order': 'Range end must be >= start',
  'port-named-too-long': 'Named port must be 15 chars or fewer',
  'port-named-invalid': 'Named port must be lowercase, start with letter, contain only a-z 0-9 -',

  'cidr-required': 'CIDR is required',
  'cidr-prefix-required': 'Must include prefix length (e.g. 10.0.0.0/8)',
  'cidr-invalid-ip': 'Invalid IPv4 address',
  'cidr-prefix-invalid': 'Prefix must be 0-32',
  'cidr-exception-subset': 'Exception must be a subset of the main CIDR',

  // ── Hostname validation ────────────────────────────────────────────
  'hostname-required': 'Hostname is required',
  'pattern-required': 'Pattern is required',
  'hostname-no-spaces': 'Hostname must not contain spaces',
  'hostname-too-long': 'Hostname must be 253 chars or fewer',
  'hostname-label-too-long': 'Each hostname label must be 63 chars or fewer',
  'hostname-label-invalid': 'Invalid hostname label',
  'hostname-wildcard-position': 'Wildcard must be a leading `*.`',

  // ── Warning panel ──────────────────────────────────────────────────
  'count-errors': '{{count}} error{{suffix}}',
  'count-warnings': '{{count}} warning{{suffix}}',
  'count-infos': '{{count}} info',

  'summary-empty-policy': 'No rules defined — this policy has no effect',
  'summary-duplicate-ingress': '{{count}} duplicate ingress rule{{suffix}}',
  'summary-duplicate-egress': '{{count}} duplicate egress rule{{suffix}}',
  'summary-k8s-unrepresentable': '{{endpoint}} cannot be expressed in a Kubernetes NetworkPolicy',
  'summary-fqdn-ingress': 'FQDN rules only apply to egress',
  'summary-open-cidr': '0.0.0.0/0 allows ALL traffic',
  'summary-duplicate-ports': 'duplicate port/protocol entries',
  'summary-no-ports': 'no ports specified — allows ALL ports',
  'summary-open-internet': 'open to the entire internet',
  'summary-all-namespaces': 'matches pods in ALL namespaces',
  'summary-empty-pod-selector': 'empty pod selector matches every pod in scope',

  'summary-fqdn-invalid': '{{label}} FQDN: {{message}}',
  'summary-cidr-invalid': '{{label}} CIDR: {{message}}',
  'summary-exception-invalid': '{{label}} exception "{{value}}": {{message}}',
  'summary-port-invalid': '{{label}} port {{value}}: {{message}}',

  'label-key-invalid': '{{label}} key "{{value}}": {{message}}',
  'label-value-invalid': '{{label}} value "{{value}}": {{message}}',
  'selector-pod': '{{dir}} pod selector',
  'selector-needs-value': '{{label}} "{{key}}" needs at least one value for {{operator}}',
  'selector-no-value': '{{label}} "{{key}}": {{operator}} cannot have values',

  // ── Fields, table headers and buttons ──────────────────────────────
  'field-cidr': 'CIDR',
  'field-except-cidr': 'Except CIDRs',
  'field-fqdn-name': 'Exact hostname (matchName)',
  'field-fqdn-pattern': 'Wildcard pattern (matchPattern)',
  'field-entity': 'Entity',
  'field-namespace': 'Namespace',
  'field-service-name': 'Service name',
  'field-namespace-labels': 'Namespace labels',
  'field-pod-selector': 'Pod selector',
  'field-expressions': 'Match expressions',
  'field-ports': 'Ports',
  'field-scope': 'Scope',

  'header-key': 'Key',
  'header-value': 'Value',
  'header-port': 'Port',
  'header-protocol': 'Protocol',

  'action-add-label': 'Add Label',
  'action-add-port': 'Add Port',
  'action-add-expression': 'Add Expression',
  'action-add-exception': 'Add exception',
  'action-add-cidr': 'Add CIDR',

  'placeholder-cidr': '10.0.0.0/8',
  'placeholder-hostname': 'api.example.com',
  'placeholder-fqdn-pattern': '*.example.com',
  'placeholder-namespace': 'kube-system',
  'placeholder-service-name': 'dns',
  'placeholder-all-namespaces': '* for all namespaces',
  'placeholder-policy-name': 'my-network-policy',
  'placeholder-namespace-field': 'default',
  'placeholder-port': 'port (1-65535)',
  'placeholder-label-key': 'key',
  'placeholder-label-value': 'value',
  'placeholder-expression-key': 'app',
  'placeholder-expression-values': 'values, comma separated',

  // ── Canvas ─────────────────────────────────────────────────────────
  'direction-ingress': 'Ingress',
  'direction-egress': 'Egress',
  'direction-ingress-sources': 'Ingress Sources',
  'direction-egress-destinations': 'Egress Destinations',

  'group-outside': 'Outside Cluster',
  'group-namespace': 'In Namespace',
  'group-cluster': 'In Cluster',

  // One line under each group title, stating what the group reaches. The
  // `namespace` one is the important one: the peer is co-located with the
  // policy, so there is no namespace to pick inside that column.
  'group-outside-desc': 'Endpoints outside the cluster',
  'group-namespace-desc': "Pods in this policy's namespace",
  'group-cluster-desc': 'Pods anywhere in this cluster',

  'dialog-new-rule': 'New {{direction}} rule ({{group}})',
  'dialog-edit-rule': 'Edit {{direction}} rule ({{group}})',
  'dialog-rule-type': 'Rule type',
  'dialog-add-rule': 'Add rule',
  'action-delete': 'Delete',
  'action-close': 'Close',

  'picker-cilium-only': '(Cilium only)',
  'picker-added': 'added',

  'picker-all-outside': 'Any endpoint',
  'picker-any-pod': 'Any pod',
  'picker-all-cluster': 'Everything in the cluster',
  'picker-cidr': 'CIDR',
  'picker-fqdn': 'FQDN',
  'picker-pod-selector': 'Pod selector',
  'picker-host': 'Host',
  'picker-remote-node': 'Remote node',
  'picker-kube-dns': 'Kubernetes DNS',

  'picker-ports-any': 'With or without specific ports',
  'picker-cidr-example': 'Ex.: 10.2.1.0/28',
  'picker-fqdn-example': 'Ex.: *.example.com',
  'picker-selector-example': 'Ex.: env=prod, app=frontend',
  'picker-entity-host': 'Cilium `host` entity',
  'picker-entity-remote-node': 'Cilium `remote-node` entity',
  'picker-kube-dns-ports': 'Port {{port}} {{protocol}} to kube-dns',

  'endpoint-any-endpoint': 'Any endpoint',
  'endpoint-all-cluster': 'Everything in the cluster',
  'endpoint-any-pod': 'Any pod',
  'endpoint-any-pod-all-namespaces': 'Any pod (all namespaces)',
  'endpoint-all-pods': 'All pods in namespace',

  // Peer one-liners, where the value is a YAML identifier and is shown as-is.
  'endpoint-cidr': '{{value}}',
  'endpoint-fqdn': '{{value}}',
  'endpoint-entity': '{{value}}',
  'endpoint-expression': 'expression',
  'endpoint-fqdn-label': 'FQDN',
  'endpoint-service': 'Service',
  'endpoint-service-names': '{{namespace}}/{{name}}',
  'endpoint-labels': '{{body}}',
  'endpoint-labels-ns': '{{namespace}}: {{body}}',

  'endpoint-kube-dns': 'Kubernetes DNS',
  'endpoint-kube-dns-detail': '(kube-system, k8s-app=kube-dns)',

  // ── Target pod node ────────────────────────────────────────────────
  'target-default-deny': 'Default Deny',
  'target-default-allow': 'Default Allow',
  'target-click-allow': '{{label}}: click to allow all',
  'target-click-deny': '{{label}}: click to deny everything',
  'target-rules-implied': '{{label}}: {{count}} rule{{suffix}}, default-deny implied',
  'target-allow-list': '{{count}} rule{{suffix}}',

  // ── Pod selector modal ─────────────────────────────────────────────
  'modal-title': 'Pod Selector Configuration',
  'modal-policy-name': 'Policy Name',
  'modal-namespace': 'Namespace',
  'modal-select-all': 'Select all pods in namespace (empty selector)',
  'modal-pod-labels': 'Pod Selector Labels',
  'modal-expressions': 'Match Expressions',
  'modal-cancel': 'Cancel',
  'modal-save': 'Save',

  // ── YAML panel ─────────────────────────────────────────────────────
  'tab-k8s': 'Kubernetes Network Policy',
  'tab-cilium': 'Cilium Network Policy',
  'action-copy': 'Copy',
  'action-copied': 'Copied!',
  'action-download': 'Download',
  'action-upload': 'Upload',
  'action-dismiss': 'dismiss',

  'error-parse-file': 'Failed to parse YAML',
  'error-parse-inline': 'Invalid YAML',
  'error-invalid-yaml': 'Invalid YAML: {{message}}',
  'error-no-policy': 'No policy found in the YAML',
  'error-unsupported-kind': 'Unsupported kind: {{kind}}',
  'error-no-supported-kind': 'No supported policy found',
  'error-mixed-kinds': 'Mixed policy kinds in one document: {{kinds}}',

  // ── Toolbar ────────────────────────────────────────────────────────
  'theme-switch': 'Switch to {{mode}} mode',
  'theme-light': 'light',
  'theme-dark': 'dark',
  'action-add-page': 'Add new policy page',
  'action-locale-en': 'English',
  'action-locale-zh': '中文',

  'rate-1': 'Weak',
  'rate-2': 'Partial',
  'rate-3': 'Good',
  'rate-4': 'Strong',
  'rating-title': 'Security: {{label}} ({{rating}}/4)',
} as const;

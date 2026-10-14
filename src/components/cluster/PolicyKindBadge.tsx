/**
 * The NP/CNP kind chip, shared by the inventory rows and the delete dialog so
 * the visual contract lives in one place.
 */
export function PolicyKindBadge({ kind }: { kind: 'NetworkPolicy' | 'CiliumNetworkPolicy' | string }) {
  const isCnp = kind === 'CiliumNetworkPolicy';
  return (
    <span
      className={`shrink-0 px-1 rounded text-[10px] font-mono ${
        isCnp ? 'bg-orange-900/40 text-orange-300' : 'bg-blue-900/40 text-blue-300'
      }`}
    >
      {isCnp ? 'CNP' : 'NP'}
    </span>
  );
}

/** The kind as the inventory spells it, derived from a policy format. */
export function kindOfFormat(format: string): 'NetworkPolicy' | 'CiliumNetworkPolicy' {
  return format === 'cilium' ? 'CiliumNetworkPolicy' : 'NetworkPolicy';
}

/**
 * Rule → YAML line mapping for hover-highlight (canvas rule ⇒ YAML lines).
 *
 * The generators inject a temporary `__ruleId` sentinel key as the LAST key of
 * each rule object; after dump, the sentinel's line locates the rule block, and
 * the sentinel is stripped again. A sentinel must be last: as the first key it
 * would own the `-` list marker, and removing that line would corrupt the YAML.
 *
 * 1-based, inclusive line ranges. `baseLine` shifts a document's ranges when
 * several documents are joined into one YAML stream (multi-spec K8s export).
 */

const SENTINEL_RE = /^(\s*)(?:- )?__ruleId:\s*(\S+)\s*$/;

/** ruleId → [firstLine, lastLine], 1-based inclusive, final (stripped) text. */
export type RuleLineMap = Record<string, [number, number]>;

export interface MappedYaml {
  yaml: string;
  ruleMap: RuleLineMap;
}

/**
 * Locate every sentinel, compute its rule's line range, then strip the
 * sentinel lines. Ranges are found on the pre-strip numbering and shifted by
 * the number of sentinel lines above them — sentinels are always above the
 * *next* rule's range (siblings in a list), never inside another range.
 */
export function extractRuleMap(text: string, baseLine = 0): MappedYaml {
  const lines = text.split('\n');
  const hits: Array<{ idx: number; id: string; start: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = SENTINEL_RE.exec(lines[i]!);
    if (!m) continue;
    const listItem = lines[i]!.trimStart().startsWith('- ');
    const indent = m[1]!.length;
    // Rule start: nearest meaningful line above at (indent - 2) that opens a
    // list item — that is where the rule's first key rides the `-` marker.
    // Deeper lines (nested lists) and comments/blanks are skipped. When the
    // sentinel itself rides the `-` line (an empty rule), it IS the whole
    // rule — no search above.
    let start = i;
    for (let j = listItem ? -1 : i - 1; j >= 0; j--) {
      const line = lines[j]!;
      const trimmed = line.trim();
      if (trimmed === '' || trimmed.startsWith('#')) continue;
      const lead = line.length - line.trimStart().length;
      if (lead === indent - 2 && trimmed.startsWith('- ')) {
        start = j;
        break;
      }
      if (lead < indent - 2) break; // left the rule block; fall back to the sentinel line
    }
    const raw = m[2]!;
    // Generators dump with forceQuotes, so the id arrives possibly quoted.
    const id = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
    hits.push({ idx: i, id, start });
  }

  const sentinelIdx = new Set(hits.map(h => h.idx));
  const map: RuleLineMap = {};
  for (const h of hits) {
    const shift = hits.filter(o => o.idx < h.start).length;
    // 1-based inclusive range; a single-line rule (the empty-rule sentinel
    // carrying its own `-` marker) is start === idx.
    map[h.id] = h.start === h.idx
      ? [baseLine + h.idx + 1, baseLine + h.idx + 1]
      : [baseLine + h.start + 1 - shift, baseLine + h.idx - shift];
  }

  // An empty rule has no first key to carry the `-` marker, so the sentinel
  // line itself is the whole list item (`- __ruleId: x`). Stripping it would
  // leave a bare `ingress:` — an empty list, which the apiserver defaults
  // back to deny. Such a line becomes the empty rule it encodes (`- {}`);
  // every other sentinel line is simply removed.
  const emptyRuleLine = new Set(hits.filter(h => h.start === h.idx).map(h => h.idx));
  const out = lines
    .map((line, i) => {
      if (!sentinelIdx.has(i)) return line;
      return emptyRuleLine.has(i)
        ? line.replace(SENTINEL_RE, (_m, indent) => `${indent}- {}`)
        : null;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
  return { yaml: out, ruleMap: map };
}

/** Inject the sentinel as the last key, so the `-` marker stays on the first
    key. On an EMPTY rule the sentinel is the only key and rides the `-` line
    itself; extractRuleMap rewrites that line to `- {}` on strip. */
export function withRuleSentinel<T extends object>(rule: T, id: string): T {
  return { ...rule, __ruleId: id } as T;
}

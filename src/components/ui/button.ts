/**
 * Shared button classes.
 *
 * The canvas is a white card on a light grey field, so a borderless icon reads
 * as a smudge rather than as something clickable. Every button therefore gets
 * a visible border, and these constants keep the hover states consistent across
 * the ~20 button sites instead of each one reinventing them.
 *
 * Tailwind tokens only — no hardcoded hex, so the dark theme picks these up
 * without a second pass.
 */

/** Icon-only control with room to breathe: the `+` on a rule group, add-page. */
export const BTN_ICON =
  'inline-flex items-center justify-center rounded-md border border-card-border p-1 text-text-secondary ' +
  'hover:text-text-primary hover:bg-surface hover:border-accent/60 transition-colors';

/** Same, for a control that removes something: hovers red rather than accent. */
export const BTN_ICON_REMOVE =
  'inline-flex items-center justify-center rounded-md border border-card-border p-1 text-text-secondary ' +
  'hover:text-arrow-deny hover:bg-surface hover:border-arrow-deny/60 transition-colors';

/** Tight variant for the remove controls that sit inside a table row. */
export const BTN_ROW_REMOVE =
  'inline-flex items-center justify-center rounded border border-card-border p-0.5 text-text-secondary ' +
  'hover:text-arrow-deny hover:bg-surface hover:border-arrow-deny/60 transition-colors';

/** Bordered `+ Add …` button, as used by the label / port / CIDR editors. */
export const BTN_ADD =
  'inline-flex items-center gap-1 rounded-md border border-card-border px-1.5 py-0.5 text-xs ' +
  'text-text-secondary hover:text-accent hover:bg-surface hover:border-accent/60 transition-colors';

/** Toolbar icon button: theme and locale toggles. */
export const BTN_TOOLBAR =
  'inline-flex items-center justify-center rounded-lg border border-card-border p-2 text-text-secondary ' +
  'hover:text-accent hover:bg-surface hover:border-accent/60 transition-colors';

/** Toolbar text button: copy / download / upload. */
export const BTN_TOOLBAR_TEXT =
  'inline-flex items-center gap-1 rounded-md border border-card-border px-2 py-1 text-xs ' +
  'text-action-text hover:text-text-primary hover:bg-surface hover:border-accent/60 transition-colors';

/** Form footer secondary button: Cancel. */
export const BTN_SECONDARY =
  'px-3 py-1.5 text-xs font-medium text-text-secondary border border-card-border rounded ' +
  'hover:text-text-primary hover:bg-surface transition-colors';

/** Form footer primary button: Save, Add. */
export const BTN_PRIMARY =
  'px-3 py-1.5 text-xs font-medium text-white bg-accent border border-accent rounded hover:opacity-90';

/** Shape for a primary button that must be clickable-disabled rather than grey. */
export const BTN_PRIMARY_DISABLED = 'opacity-50 cursor-not-allowed';

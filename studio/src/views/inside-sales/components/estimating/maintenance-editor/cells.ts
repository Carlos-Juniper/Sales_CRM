// Shared cell styling for the maintenance line table (SectionCard and its
// category blocks). Blue cells (#eff6ff / #bfdbfe) mark estimator inputs.

/** Blue-cell convention: estimator-editable inputs (legacy Excel language). */
export const BLUE_CELL = 'bg-[#eff6ff] border-[#bfdbfe] focus-visible:ring-[#2E7D52]'

export const cellInput =
  'h-8 rounded-md border px-2 text-sm text-[hsl(var(--fg))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors'

/**
 * One track list for the hours-driven line table: the column header, every
 * category header and every service row use it. Tracks are explicit (not
 * `auto`) and children are `min-w-0`, so each grid sizes from the template
 * instead of its own content.
 *
 * Service | OCC | COMP | P/H | TH | Discipline | Billing | P/P | TP | remove
 */
export const MAINTENANCE_LINE_GRID =
  'grid w-full items-center gap-x-4 px-4 [&>*]:min-w-0 grid-cols-[minmax(9rem,1.6fr)_minmax(6.5rem,0.8fr)_minmax(7rem,0.8fr)_minmax(4.5rem,0.55fr)_minmax(4.5rem,0.55fr)_minmax(6.25rem,0.7fr)_minmax(8rem,0.9fr)_minmax(5.5rem,0.6fr)_minmax(7rem,0.8fr)_2rem]'

/** Keeps the tracks intact; a narrow card scrolls instead of collapsing. */
export const MAINTENANCE_LINE_MIN_WIDTH = 'min-w-[72rem]'

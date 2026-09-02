interface SectionPlaceholderProps {
  /** The section's stable slug — drives the `settings-section-<slug>` testid. */
  slug: string
  /** Human label for the empty-state copy. */
  name: string
}

/**
 * Empty section body. Slices 10–12 replace each placeholder with a real form;
 * the stable `data-testid` (`settings-section-<slug>`) is the contract they slot
 * into, so tests and later slices can locate a section without guessing markup.
 */
export function SectionPlaceholder({ slug, name }: SectionPlaceholderProps) {
  return (
    <div
      data-testid={`settings-section-${slug}`}
      className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
    >
      <h2 className="text-sm font-semibold text-[var(--fg)]">{name}</h2>
      <p className="mt-1 text-xs text-[var(--fg)] opacity-60">
        Coming soon — this section is not yet configurable.
      </p>
    </div>
  )
}

/**
 * Manager picker for a field-sales user. Options are Regional Sales users only.
 * An empty value clears reports_to_user_id.
 */
export function ReportsToSelect({
  id,
  testId,
  value,
  onChange,
  managers,
}: {
  id: string
  testId: string
  value: string
  onChange: (userId: string) => void
  managers: { id: string; name: string }[]
}) {
  return (
    <select
      id={id}
      data-testid={testId}
      aria-label="Reports to"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
    >
      <option value="">None</option>
      {managers.map((manager) => (
        <option key={manager.id} value={manager.id}>
          {manager.name}
        </option>
      ))}
    </select>
  )
}

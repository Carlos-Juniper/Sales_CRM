// Maps TeamMemberTitle enum values to human-readable labels.
// Used everywhere a title is displayed to avoid printing raw snake_case.
export const TEAM_MEMBER_TITLE_LABELS: Record<string, string> = {
  regional_director: 'Regional Director',
  // 'manager' is the canonical DB value (aligned to CANONICAL_ROLES in api/authz.py)
  manager: 'Branch Manager',
  // 'branch_manager' is the display-friendly alias used in the UI and some seeded rows
  branch_manager: 'Branch Manager',
  account_manager: 'Account Manager',
  agronomy_manager: 'Agronomy Manager',
  irrigation_manager: 'Irrigation Manager',
  production_manager: 'Production Manager',
  operations_manager: 'Operations Manager',
  executive: 'Executive',
  sales_rep: 'Sales Representative',
  lead_sales_rep: 'Lead Sales Representative',
}

export function teamMemberTitleLabel(title: string): string {
  return TEAM_MEMBER_TITLE_LABELS[title] ?? title.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

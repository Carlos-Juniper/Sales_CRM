import { apiClient } from './client'

/**
 * A branch the current user may MANAGE (the Settings branch-picker source).
 *
 * The list is scoped and roster-filtered SERVER-side (GET /api/settings/branches):
 * admin sees every operating branch, a BM/RD only its `user_branches`, and every
 * response already excludes `active = 0` / `'%DO NOT USE%'` rows. The client
 * renders exactly what the endpoint returns — no client-side filtering.
 */
export interface ManageableBranch {
  aspireBranchId: number
  branchName: string
  city: string | null
}

export const settingsApi = {
  /** Operating branches the caller may manage, sorted by branch name. */
  branches: () => apiClient.get<ManageableBranch[]>('/settings/branches'),
}

import type { ManageableBranch } from '@/api/settings'
import { CheckboxList } from '@/components/shared/CheckboxList'

const branchId = (b: ManageableBranch) => b.aspireBranchId
const branchName = (b: ManageableBranch) => b.branchName

/**
 * The branch picker for the authorize form and each row's inline editor: a
 * CheckboxList over manageable branches producing a replace-set of
 * aspire_branch_ids. `selected` is the WHOLE set that gets PATCHed, matching
 * the backend's replace-set semantics, and bulk actions write explicit ids
 * (no "all" sentinel).
 */
export function BranchMultiSelect({
  branches,
  selected,
  onChange,
  idPrefix,
}: {
  branches: ManageableBranch[]
  selected: number[]
  onChange: (next: number[]) => void
  /** Namespaces the testids so multiple pickers can coexist (per-row editors). */
  idPrefix: string
}) {
  return (
    <CheckboxList
      items={branches}
      selected={selected}
      onChange={onChange}
      getId={branchId}
      getLabel={branchName}
      noun="branches"
      idPrefix={idPrefix}
    />
  )
}

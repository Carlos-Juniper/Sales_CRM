import { useState } from 'react'
import type { AdminUser, DirectoryCandidate, ManageableBranch } from '@/api/settings'
import type { UserRole } from '@/types'
import { useAuthorizeUser, useDirectorySearch } from '@/hooks/useUserAdmin'
import { FIELD_SALES_ROLES, requiresAspireSalesRep } from '@/lib/roles'
import { RoleSelect } from './RoleSelect'
import { BranchMultiSelect } from './BranchMultiSelect'
import { ReportsToSelect } from './ReportsToSelect'

/**
 * Authorize a NEW user (§2.8 "authorize, not create"): the admin searches the
 * M365 directory and PICKS a person — name+email autofill, so a mistyped email
 * (which would silently break Entra SSO matching) is impossible. Then they set
 * role + branches and submit `POST /settings/users`.
 *
 * Sales hard-block: a `sales` role with no resolvable Aspire rep 422s and the
 * row is NEVER created. We surface the backend's EXACT §2.8 copy (never a local
 * re-word) beside a "Link Aspire Rep" action, which re-attempts the authorize
 * once the admin has created the matching Aspire contact.
 */
export function AuthorizeUserForm({
  branches,
  regionalManagers,
}: {
  branches: ManageableBranch[]
  regionalManagers: AdminUser[]
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<DirectoryCandidate | null>(null)
  const [role, setRole] = useState<UserRole>('procurement')
  const [reportsTo, setReportsTo] = useState('')
  const [selectedBranches, setSelectedBranches] = useState<number[]>([])
  // The verbatim §2.8 copy the backend returned on a sales block, or null.
  const [blockCopy, setBlockCopy] = useState<string | null>(null)

  const directory = useDirectorySearch(query)
  const authorize = useAuthorizeUser({
    onBlocked: (message) => setBlockCopy(message),
    onDone: resetForm,
  })

  function resetForm() {
    setQuery('')
    setPicked(null)
    setRole('procurement')
    setReportsTo('')
    setSelectedBranches([])
    setBlockCopy(null)
  }

  function pick(candidate: DirectoryCandidate) {
    setPicked(candidate)
    setQuery('')
    setBlockCopy(null)
  }

  function toggleBranch(id: number) {
    setSelectedBranches((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    )
  }

  function submit() {
    if (!picked) return
    setBlockCopy(null)
    const fieldSales = requiresAspireSalesRep(role)
    authorize.mutate({
      name: picked.name,
      email: picked.email,
      role,
      branches: selectedBranches,
      reports_to_user_id: fieldSales && reportsTo ? reportsTo : null,
    })
  }

  return (
    <section className="rounded-lg border border-[var(--border)] p-4">
      <h3 className="text-sm font-semibold text-[var(--fg)]">Authorize a user</h3>
      <p className="mt-0.5 mb-3 text-xs opacity-60">
        Search your Microsoft 365 directory and pick a person — their name and
        email fill in automatically.
      </p>

      {/* Directory typeahead */}
      <label
        htmlFor="directory-search"
        className="block text-xs font-medium opacity-70 mb-1"
      >
        Directory search
      </label>
      <input
        id="directory-search"
        data-testid="directory-search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email…"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm"
      />
      {query.trim().length >= 2 && (
        <ul className="mt-1 rounded-md border border-[var(--border)] text-sm">
          {directory.isLoading && (
            <li className="px-3 py-1.5 opacity-60">Searching…</li>
          )}
          {directory.isError && (
            <li role="alert" className="px-3 py-1.5 text-red-600">
              Could not search the directory.
            </li>
          )}
          {directory.data?.length === 0 && !directory.isLoading && (
            <li className="px-3 py-1.5 opacity-60">No matches.</li>
          )}
          {directory.data?.map((c) => (
            <li key={c.email}>
              <button
                type="button"
                onClick={() => pick(c)}
                className="block w-full px-3 py-1.5 text-left hover:bg-[var(--sidebar-hover-bg)]"
              >
                <span className="font-medium">{c.name}</span>{' '}
                <span className="opacity-60">{c.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <div className="mt-3 space-y-3">
          <p className="text-sm">
            Authorizing{' '}
            <span className="font-medium">{picked.name}</span>{' '}
            <span
              data-testid="authorize-selected-email"
              className="opacity-70"
            >
              {picked.email}
            </span>
          </p>

          <div>
            <label
              htmlFor="authorize-role"
              className="block text-xs font-medium opacity-70 mb-1"
            >
              Role
            </label>
            <RoleSelect
              id="authorize-role"
              testId="authorize-role"
              value={role}
              onChange={(r) => {
                if (r === 'outside_sales') return
                setRole(r)
                if (!(FIELD_SALES_ROLES as readonly string[]).includes(r)) setReportsTo('')
                setBlockCopy(null)
              }}
            />
          </div>

          {(FIELD_SALES_ROLES as readonly string[]).includes(role) && (
            <div>
              <label
                htmlFor="authorize-reports-to"
                className="block text-xs font-medium opacity-70 mb-1"
              >
                Reports to
              </label>
              <ReportsToSelect
                id="authorize-reports-to"
                testId="authorize-reports-to"
                value={reportsTo}
                onChange={setReportsTo}
                managers={regionalManagers}
              />
            </div>
          )}

          <div>
            <p className="text-xs font-medium opacity-70 mb-1">Branches</p>
            <BranchMultiSelect
              branches={branches}
              selected={selectedBranches}
              onToggle={toggleBranch}
              idPrefix="authorize-branch"
            />
          </div>

          {/* Sales hard-block: verbatim backend copy + Link Aspire Rep retry. */}
          {blockCopy && (
            <div
              role="alert"
              data-testid="authorize-aspire-block"
              className="rounded-md border border-red-300 bg-red-50 p-3 text-xs text-red-700"
            >
              <p>{blockCopy}</p>
              <button
                type="button"
                onClick={submit}
                disabled={authorize.isPending}
                className="mt-2 rounded-md border border-red-400 px-3 py-1 font-medium disabled:opacity-50"
              >
                Link Aspire Rep
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={submit}
            disabled={authorize.isPending}
            className="rounded-md bg-[var(--sidebar-active-bg)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {authorize.isPending ? 'Authorizing…' : 'Authorize user'}
          </button>
        </div>
      )}
    </section>
  )
}

import { useRole } from '@/hooks/useRole'
import { useBranchList } from '@/hooks/useBranchList'
import { useUserList } from '@/hooks/useUserAdmin'
import { AuthorizeUserForm } from './AuthorizeUserForm'
import { UserRow } from './UserRow'

/**
 * Company → Users admin surface (§2.8 "authorize, not create").
 *
 * Defense-in-depth admin gate (the shell already gates the Company group, but
 * authorizing users moves a real authorization boundary, so a non-admin who
 * reaches this slug sees an admin-only note, never the surface). Composes the
 * live user LIST with the M365 AUTHORIZE form; all server state flows through
 * React Query hooks (CLAUDE.md §2/§4), components never call the API directly.
 */
export function UsersSection({ slug, label }: { slug: string; label: string }) {
  const { isAdmin } = useRole()

  if (!isAdmin) {
    return (
      <div
        data-testid={`settings-section-${slug}`}
        className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center"
      >
        <h2 className="text-sm font-semibold text-[var(--fg)]">{label}</h2>
        <p className="mt-1 text-xs opacity-60">
          Admin only — user administration is admin-owned.
        </p>
      </div>
    )
  }

  return <UsersAdmin slug={slug} label={label} />
}

function UsersAdmin({ slug, label }: { slug: string; label: string }) {
  const users = useUserList()
  const { data: branches } = useBranchList()
  const branchList = branches ?? []

  return (
    <div data-testid={`settings-section-${slug}`} className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-sm font-semibold text-[var(--fg)]">{label}</h2>
        <p className="mt-1 text-xs opacity-60">
          Authorize people from your Microsoft 365 directory, set their role and
          branches, and activate or deactivate access.
        </p>
      </div>

      <AuthorizeUserForm
        branches={branchList}
        regionalManagers={(users.data ?? []).filter(
          (manager) => manager.role === 'regional_sales' && manager.active !== 0 && manager.active !== false,
        )}
      />

      <div>
        <h3 className="mb-2 text-sm font-semibold text-[var(--fg)]">
          Current users
        </h3>
        {users.isLoading && <p className="text-xs opacity-60">Loading…</p>}
        {users.isError && (
          <p role="alert" className="text-xs text-red-600">
            Could not load users.
          </p>
        )}
        {users.data && users.data.length === 0 && (
          <p className="text-xs opacity-60">No users yet.</p>
        )}
        {users.data && users.data.length > 0 && (
          <ul className="space-y-2">
            {users.data.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                branches={branchList}
                regionalManagers={(users.data ?? []).filter(
                  (manager) => manager.role === 'regional_sales' && manager.active !== 0 && manager.active !== false,
                )}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import type { AdminUser, ManageableBranch } from '@/api/settings'
import type { UserRole } from '@/types'
import { CANONICAL_ROLES } from '@/types'
import { useLinkAspireRep, useUpdateUser } from '@/hooks/useUserAdmin'
import { RoleSelect } from './RoleSelect'
import { BranchMultiSelect } from './BranchMultiSelect'
import { isUserActive } from './userDisplay'

/**
 * One user in the admin list. Read view shows name/email/role/branches and an
 * active/inactive marker; Edit opens an inline role + branches editor (branches
 * PATCH as a replace-set). Deactivate/Activate toggles `active` via PATCH — never
 * a DELETE, so a deactivated user stays listed (historical) and visibly marked.
 */
export function UserRow({ user, branches }: { user: AdminUser; branches: ManageableBranch[] }) {
  const [editing, setEditing] = useState(false)
  const active = isUserActive(user)

  const update = useUpdateUser({ onDone: () => setEditing(false) })
  const link = useLinkAspireRep()

  function toggleActive() {
    update.mutate({ userId: user.id, body: { active: !active } })
  }

  return (
    <li
      data-testid={`user-row-${user.id}`}
      className="rounded-md border border-[var(--border)] p-3"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--fg)]">
            {user.name}
            {!active && (
              <span className="ml-2 rounded bg-[var(--border)] px-1.5 py-0.5 text-[10px] uppercase tracking-wide opacity-70">
                Inactive
              </span>
            )}
          </p>
          <p className="text-xs opacity-60">{user.email}</p>
          <p className="mt-0.5 text-xs opacity-70">Role: {user.role}</p>
        </div>

        <div className="flex flex-shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setEditing((v) => !v)}
            aria-label={`Edit ${user.name}`}
            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={toggleActive}
            disabled={update.isPending}
            aria-label={`${active ? 'Deactivate' : 'Activate'} ${user.name}`}
            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-xs disabled:opacity-50"
          >
            {active ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      </div>

      {editing && (
        <UserRowEditor
          user={user}
          branches={branches}
          onSave={(body) => update.mutate({ userId: user.id, body })}
          pending={update.isPending}
          onLinkAspire={() => link.mutate(user.id)}
          linkPending={link.isPending}
        />
      )}
    </li>
  )
}

function UserRowEditor({
  user,
  branches,
  onSave,
  pending,
  onLinkAspire,
  linkPending,
}: {
  user: AdminUser
  branches: ManageableBranch[]
  onSave: (body: { role: UserRole; branches: number[] }) => void
  pending: boolean
  onLinkAspire: () => void
  linkPending: boolean
}) {
  // Seed the role from the row if it is a canonical value, else default to sales
  // (legacy rows normalize there — mirrors useRole.normalizeRole).
  const initialRole = (CANONICAL_ROLES as readonly string[]).includes(user.role)
    ? (user.role as UserRole)
    : 'sales'
  const [role, setRole] = useState<UserRole>(initialRole)
  const [selected, setSelected] = useState<number[]>(user.branches ?? [])

  function toggleBranch(id: number) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id],
    )
  }

  return (
    <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
      <div>
        <label
          htmlFor={`edit-role-${user.id}`}
          className="block text-xs font-medium opacity-70 mb-1"
        >
          Role
        </label>
        <RoleSelect
          id={`edit-role-${user.id}`}
          testId={`edit-role-${user.id}`}
          value={role}
          onChange={setRole}
        />
      </div>

      <div>
        <p className="text-xs font-medium opacity-70 mb-1">Branches</p>
        <BranchMultiSelect
          branches={branches}
          selected={selected}
          onToggle={toggleBranch}
          idPrefix={`edit-branch-${user.id}`}
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onSave({ role, branches: selected })}
          disabled={pending}
          aria-label={`Save ${user.name}`}
          className="rounded-md bg-[var(--sidebar-active-bg)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Saving…' : 'Save'}
        </button>
        {/* For an existing user whose role is (or becomes) sales but has no
            resolved rep, the dedicated link endpoint resolves it in place. */}
        <button
          type="button"
          onClick={onLinkAspire}
          disabled={linkPending}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {linkPending ? 'Linking…' : 'Link Aspire Rep'}
        </button>
      </div>
    </div>
  )
}

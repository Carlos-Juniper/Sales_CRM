import { useState } from 'react'
import { useRole } from '@/hooks/useRole'
import {
  useTeamMembers,
  useCreateTeamMember,
  useUpdateTeamMember,
  useDeactivateTeamMember,
  useUploadTeamMemberHeadshot,
  useDeleteTeamMemberHeadshot,
} from '@/hooks/useProposals'
import { teamMemberTitleLabel } from '@/lib/proposal/titleLabels'
import { ImageUploadField } from '@/components/settings/ImageUploadField'
import type { TeamMember } from '@/types/proposal'
import type {
  TeamMemberCreateBody,
  TeamMemberPatchBody,
} from '@/api/settings'
import { SettingsFormShell, FormStatus } from '../company/formStatus'

/**
 * Branch team roster management section (Slice 13b).
 *
 * Lists team members scoped to the selected branch (null-branch / company-wide rows
 * are always included by the API's null-branch-inclusion rule — Amendment A.6).
 *
 * Scope rules:
 *   - Branch-owned rows (aspireBranchId === current branch): BM can create/edit/deactivate.
 *   - Company-wide rows (aspireBranchId === null): read-only for BM, editable only by admin.
 *
 * Headshots upload here (Handoff 43 §2). The picker only appears on an existing
 * row: the object key is derived from the row id, so there is nothing to attach
 * a photo to until the member has been created.
 */
/**
 * @param aspireBranchId  a branch id, or `null` for the company-wide roster
 *        (Handoff 50 §3 Marketing group). In company-wide mode the list shows
 *        only company-wide rows and `canEditCompanyWide` (marketing/admin)
 *        governs edit rights.
 */
export function TeamRosterSection({
  aspireBranchId,
  canEditCompanyWide = false,
}: {
  aspireBranchId: number | null
  canEditCompanyWide?: boolean
}) {
  const companyWide = aspireBranchId === null
  const { data, isLoading, isError } = useTeamMembers(
    companyWide ? undefined : { aspireBranchId },
  )
  const { isAdmin } = useRole()
  // In company-wide mode, marketing (or admin) may edit; the branch view keeps
  // its original rule (company-wide rows admin-only, branch rows BM-editable).
  const canEditCompany = isAdmin || canEditCompanyWide
  const [showCreate, setShowCreate] = useState(false)

  if (isLoading) {
    return (
      <SettingsFormShell slug="team-roster" title="Team roster">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError) {
    return (
      <SettingsFormShell slug="team-roster" title="Team roster">
        <p role="alert" className="text-xs text-red-600">
          Could not load team members. The branch may be out of your scope.
        </p>
      </SettingsFormShell>
    )
  }

  // Company-wide mode shows only the company-wide (null-branch) rows; the
  // branch view keeps the API's null-inclusion behaviour.
  const members = (data ?? []).filter((m) =>
    companyWide ? m.aspireBranchId === null : true,
  )

  return (
    <SettingsFormShell
      slug="team-roster"
      title="Team roster"
      description={
        companyWide
          ? 'Company-wide team members (leadership / executive) included in every proposal package.'
          : 'Branch team members included in proposal packages. Company-wide rows are read-only here — edit them as admin.'
      }
    >
      {members.length === 0 && !showCreate && (
        <p className="text-xs text-[var(--fg)] opacity-60 mb-3">
          {companyWide ? 'No company-wide team members yet.' : 'No team members yet for this branch.'}
        </p>
      )}

      <ul className="space-y-2 mb-4">
        {members.map((member) => (
          <TeamMemberRow
            key={member.id}
            member={member}
            branchId={aspireBranchId}
            isAdmin={canEditCompany}
          />
        ))}
      </ul>

      {showCreate ? (
        <TeamMemberForm
          aspireBranchId={aspireBranchId}
          onDone={() => setShowCreate(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--sidebar-hover-bg)]"
        >
          Add team member
        </button>
      )}
    </SettingsFormShell>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function TeamMemberRow({
  member,
  branchId,
  isAdmin,
}: {
  member: TeamMember
  branchId: number | null
  isAdmin: boolean
}) {
  const [editing, setEditing] = useState(false)
  // The branch id is only a cache-key hint (unused by the hook); 0 is a safe
  // company-wide sentinel since invalidation is by query-key prefix.
  const deactivate = useDeactivateTeamMember(branchId ?? 0)
  const upload = useUploadTeamMemberHeadshot()
  const removeHeadshot = useDeleteTeamMemberHeadshot()

  // Company-wide rows (aspireBranchId === null): admin/marketing edit freely; a
  // branch manager sees them read-only. The `isAdmin` prop already carries the
  // company-wide edit capability from the parent (canEditCompany).
  const isCompanyWide = member.aspireBranchId === null
  const canEdit = isAdmin || !isCompanyWide

  if (editing && canEdit) {
    return (
      <li>
        <TeamMemberForm
          aspireBranchId={branchId}
          existing={member}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="rounded-md border border-[var(--border)] px-3 py-2 text-xs">
      <div className="flex items-start justify-between">
        <div>
          <span className="font-medium text-[var(--fg)]">{member.name}</span>
          <span className="ml-2 text-[var(--fg)] opacity-60">{teamMemberTitleLabel(member.title)}</span>
          {member.location && (
            <span className="ml-2 text-[var(--fg)] opacity-50">— {member.location}</span>
          )}
          {isCompanyWide && (
            <span
              data-testid={`team-member-${member.id}-readonly`}
              className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800"
            >
              Company-wide (read-only)
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex gap-2 ml-3 flex-shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-[var(--fg)] opacity-60 hover:opacity-100 text-[10px]"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => deactivate.mutate(member.id)}
              disabled={deactivate.isPending}
              className="text-red-600 opacity-70 hover:opacity-100 text-[10px] disabled:opacity-30"
            >
              Deactivate
            </button>
          </div>
        )}
      </div>
      {canEdit && (
        <div className="mt-2">
          <ImageUploadField
            id={`tm-headshot-${member.id}`}
            label="Headshot"
            objectKey={member.headshotObjectKey}
            alt={`${member.name} headshot`}
            aspect="portrait"
            hint="3:4 portrait crop — it prints at 1.45 × 1.93in."
            isPending={upload.isPending || removeHeadshot.isPending}
            onUpload={(file) => upload.mutate({ memberId: member.id, file })}
            onRemove={() => removeHeadshot.mutate(member.id)}
          />
        </div>
      )}
    </li>
  )
}

// ── Create / Edit form ────────────────────────────────────────────────────────

function TeamMemberForm({
  aspireBranchId,
  existing,
  onDone,
}: {
  aspireBranchId: number | null
  existing?: TeamMember
  onDone: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [title, setTitle] = useState(existing?.title ?? '')
  const [bio, setBio] = useState(existing?.bio ?? '')
  const [location, setLocation] = useState(existing?.location ?? '')

  const create = useCreateTeamMember(aspireBranchId ?? 0)
  const update = useUpdateTeamMember(aspireBranchId ?? 0)

  const isPending = create.isPending || update.isPending
  const isSuccess = create.isSuccess || update.isSuccess
  const isError = create.isError || update.isError

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !title.trim()) return

    if (existing) {
      const body: TeamMemberPatchBody = {}
      if (name !== existing.name) body.name = name
      if (title !== existing.title) body.title = title
      if (bio !== existing.bio) body.bio = bio
      if (location !== (existing.location ?? '')) body.location = location || null
      if (Object.keys(body).length === 0) { onDone(); return }
      update.mutate(
        { memberId: existing.id, body },
        { onSuccess: onDone },
      )
    } else {
      const body: TeamMemberCreateBody = {
        name,
        title,
        // A company-wide row (null branch) is a leadership/executive entry;
        // a branch row keeps the branch teamType.
        teamType: aspireBranchId === null ? 'leadership' : 'branch',
        aspireBranchId,
        bio,
        location: location || null,
      }
      create.mutate(body, { onSuccess: onDone })
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-[var(--border)] px-3 py-3 space-y-2"
    >
      <Field id="tm-name" label="Name" value={name} onChange={setName} required />
      <Field id="tm-title" label="Title" value={title} onChange={setTitle} required />
      <Field id="tm-location" label="Location" value={location} onChange={setLocation} />
      <TextareaField id="tm-bio" label="Bio" value={bio} onChange={setBio} />
      {!existing && (
        <p className="text-[10px] text-[var(--fg)] opacity-50">
          Add the headshot after saving — the photo attaches to the created row.
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-[var(--sidebar-active-bg)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {isPending ? 'Saving…' : existing ? 'Save' : 'Create'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs"
        >
          Cancel
        </button>
      </div>
      <FormStatus isSuccess={isSuccess} isError={isError} />
    </form>
  )
}

// ── Shared field primitives ───────────────────────────────────────────────────

function Field({
  id,
  label,
  value,
  onChange,
  required,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  required?: boolean
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5"
      >
        {label}
        {required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
      />
    </div>
  )
}

function TextareaField({
  id,
  label,
  value,
  onChange,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5"
      >
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
      />
    </div>
  )
}

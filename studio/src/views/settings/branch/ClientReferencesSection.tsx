import { useState } from 'react'
import { useRole } from '@/hooks/useRole'
import {
  useClientReferences,
  useCreateClientReference,
  useUpdateClientReference,
  useDeactivateClientReference,
} from '@/hooks/useProposals'
import type { ClientReference } from '@/types/proposal'
import type {
  ClientReferenceCreateBody,
  ClientReferencePatchBody,
} from '@/api/settings'
import { SettingsFormShell, FormStatus } from '../company/formStatus'

/**
 * Branch client references management section (Slice 13b).
 *
 * Lists references for the selected branch. The GET endpoint includes null-branch
 * (company-wide) rows in addition to branch-specific ones (Amendment A.6 rule).
 *
 * Scope:
 *   - Branch-owned rows: BM can create/edit/deactivate.
 *   - Company-wide rows (aspireBranchId === null): read-only for BM, admin-editable only.
 */
/**
 * @param aspireBranchId  a branch id, or `null` for the company-wide references
 *        (Handoff 50 §3 Marketing group). In company-wide mode the list shows
 *        only company-wide rows and `canEditCompanyWide` (marketing/admin)
 *        governs edit rights.
 */
export function ClientReferencesSection({
  aspireBranchId,
  canEditCompanyWide = false,
}: {
  aspireBranchId: number | null
  canEditCompanyWide?: boolean
}) {
  const companyWide = aspireBranchId === null
  const { data, isLoading, isError } = useClientReferences(
    companyWide ? undefined : { aspireBranchId },
  )
  const { isAdmin } = useRole()
  const canEditCompany = isAdmin || canEditCompanyWide
  const [showCreate, setShowCreate] = useState(false)

  if (isLoading) {
    return (
      <SettingsFormShell slug="client-references" title="Client references">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError) {
    return (
      <SettingsFormShell slug="client-references" title="Client references">
        <p role="alert" className="text-xs text-red-600">
          Could not load client references. The branch may be out of your scope.
        </p>
      </SettingsFormShell>
    )
  }

  const refs = (data ?? []).filter((r) =>
    companyWide ? r.aspireBranchId === null : true,
  )

  return (
    <SettingsFormShell
      slug="client-references"
      title="Client references"
      description={
        companyWide
          ? 'Company-wide client references included in every proposal package.'
          : 'Client references for proposal packages. Company-wide rows are read-only here — edit them as admin.'
      }
    >
      {refs.length === 0 && !showCreate && (
        <p className="text-xs text-[var(--fg)] opacity-60 mb-3">
          {companyWide ? 'No company-wide client references yet.' : 'No client references yet for this branch.'}
        </p>
      )}

      <ul className="space-y-2 mb-4">
        {refs.map((ref) => (
          <ClientReferenceRow
            key={ref.id}
            ref={ref}
            branchId={aspireBranchId}
            isAdmin={canEditCompany}
          />
        ))}
      </ul>

      {showCreate ? (
        <ClientReferenceForm
          aspireBranchId={aspireBranchId}
          onDone={() => setShowCreate(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--sidebar-hover-bg)]"
        >
          Add client reference
        </button>
      )}
    </SettingsFormShell>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ClientReferenceRow({
  ref: cr,
  branchId,
  isAdmin,
}: {
  ref: ClientReference
  branchId: number | null
  isAdmin: boolean
}) {
  const [editing, setEditing] = useState(false)
  const deactivate = useDeactivateClientReference(branchId ?? 0)

  const isCompanyWide = cr.aspireBranchId === null
  const canEdit = isAdmin || !isCompanyWide

  if (editing && canEdit) {
    return (
      <li>
        <ClientReferenceForm
          aspireBranchId={branchId}
          existing={cr}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between rounded-md border border-[var(--border)] px-3 py-2 text-xs">
      <div>
        <span className="font-medium text-[var(--fg)]">{cr.propertyName}</span>
        <span className="ml-2 text-[var(--fg)] opacity-60">{cr.contactName}</span>
        <span className="ml-2 text-[var(--fg)] opacity-50">· {cr.clientSinceYear}</span>
        {isCompanyWide && (
          <span
            data-testid={`client-ref-${cr.id}-readonly`}
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
            onClick={() => deactivate.mutate(cr.id)}
            disabled={deactivate.isPending}
            className="text-red-600 opacity-70 hover:opacity-100 text-[10px] disabled:opacity-30"
          >
            Deactivate
          </button>
        </div>
      )}
    </li>
  )
}

// ── Create / Edit form ────────────────────────────────────────────────────────

function ClientReferenceForm({
  aspireBranchId,
  existing,
  onDone,
}: {
  aspireBranchId: number | null
  existing?: ClientReference
  onDone: () => void
}) {
  const [propertyName, setPropertyName] = useState(existing?.propertyName ?? '')
  const [servicesProvided, setServicesProvided] = useState(existing?.servicesProvided ?? '')
  const [contactName, setContactName] = useState(existing?.contactName ?? '')
  const [contactTitle, setContactTitle] = useState(existing?.contactTitle ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [address, setAddress] = useState(existing?.address ?? '')
  const [clientSinceYear, setClientSinceYear] = useState(
    String(existing?.clientSinceYear ?? new Date().getFullYear()),
  )

  const create = useCreateClientReference(aspireBranchId ?? 0)
  const update = useUpdateClientReference(aspireBranchId ?? 0)

  const isPending = create.isPending || update.isPending
  const isSuccess = create.isSuccess || update.isSuccess
  const isError = create.isError || update.isError

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!propertyName.trim() || !contactName.trim() || !phone.trim() || !email.trim()) return

    const year = parseInt(clientSinceYear, 10)

    if (existing) {
      const body: ClientReferencePatchBody = {}
      if (propertyName !== existing.propertyName) body.propertyName = propertyName
      if (servicesProvided !== existing.servicesProvided) body.servicesProvided = servicesProvided
      if (contactName !== existing.contactName) body.contactName = contactName
      if (contactTitle !== (existing.contactTitle ?? '')) body.contactTitle = contactTitle || null
      if (phone !== existing.phone) body.phone = phone
      if (email !== existing.email) body.email = email
      if (address !== existing.address) body.address = address
      if (year !== existing.clientSinceYear) body.clientSinceYear = year
      if (Object.keys(body).length === 0) { onDone(); return }
      update.mutate({ refId: existing.id, body }, { onSuccess: onDone })
    } else {
      const body: ClientReferenceCreateBody = {
        propertyName,
        servicesProvided,
        contactName,
        contactTitle: contactTitle || null,
        phone,
        email,
        address,
        clientSinceYear: year,
        aspireBranchId,
      }
      create.mutate(body, { onSuccess: onDone })
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-[var(--border)] px-3 py-3 space-y-2"
    >
      <Field id="cr-property-name" label="Property name" value={propertyName} onChange={setPropertyName} required />
      <Field id="cr-services" label="Services provided" value={servicesProvided} onChange={setServicesProvided} />
      <Field id="cr-contact-name" label="Contact name" value={contactName} onChange={setContactName} required />
      <Field id="cr-contact-title" label="Contact title" value={contactTitle} onChange={setContactTitle} />
      <Field id="cr-phone" label="Phone" value={phone} onChange={setPhone} required />
      <Field id="cr-email" label="Email" value={email} onChange={setEmail} required />
      <Field id="cr-address" label="Address" value={address} onChange={setAddress} />
      <Field id="cr-since" label="Client since (year)" value={clientSinceYear} onChange={setClientSinceYear} />
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

// ── Shared field primitive ────────────────────────────────────────────────────

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

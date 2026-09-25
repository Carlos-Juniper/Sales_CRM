import { useState } from 'react'
import { useRole } from '@/hooks/useRole'
import {
  useClientReferences,
  useCreateClientReference,
  useUpdateClientReference,
  useDeactivateClientReference,
} from '@/hooks/useProposals'
import type { ClientReference } from '@/types/proposal'
import { AllRegionsBadge } from '@/components/proposal/RegionSwitcher'
import type {
  ClientReferenceCreateBody,
  ClientReferencePatchBody,
} from '@/api/settings'
import { SettingsFormShell, FormStatus, LegacyOwnerBadge } from '../company/formStatus'
import { errorDetail } from '../errorDetail'

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
  repId,
}: {
  aspireBranchId: number | null
  canEditCompanyWide?: boolean
  /** When set, list and writes are scoped to this sales rep (Settings). */
  repId?: string
}) {
  const companyWide = aspireBranchId === null
  const repScoped = repId !== undefined
  // Reference management must keep seeing every region. repId scopes Settings
  // to one sales rep without dropping the other regions.
  const { data, isLoading, isError, error } = useClientReferences(
    repScoped
      ? { repId, regionId: 'all' }
      : companyWide
        ? { regionId: 'all' }
        : { aspireBranchId, regionId: 'all' },
  )
  const { isAdmin } = useRole()
  const canEditCompany = repScoped || isAdmin || canEditCompanyWide
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
          {errorDetail(error, 'Could not load client references. The branch may be out of your scope.')}
        </p>
      </SettingsFormShell>
    )
  }

  const refs = (data ?? []).filter((r) =>
    repScoped ? true : companyWide ? r.aspireBranchId === null : true,
  )

  return (
    <SettingsFormShell
      slug="client-references"
      title="Client references"
      description={
        repScoped
          ? 'This rep’s client references included in their proposal packages.'
          : companyWide
            ? 'Company-wide client references included in every proposal package.'
            : 'Client references for proposal packages. Company-wide rows are read-only here — edit them as admin.'
      }
    >
      {refs.length === 0 && !showCreate && (
        <p className="text-xs text-[var(--fg)] opacity-60 mb-3">
          {repScoped
            ? 'No client references yet for this rep.'
            : companyWide
              ? 'No company-wide client references yet.'
              : 'No client references yet for this branch.'}
        </p>
      )}

      <ul className="space-y-2 mb-4">
        {refs.map((reference) => (
          <ClientReferenceRow
            key={reference.id}
            reference={reference}
            branchId={aspireBranchId}
            isAdmin={canEditCompany}
            repId={repId}
            repScoped={repScoped}
          />
        ))}
      </ul>

      {showCreate ? (
        <ClientReferenceForm
          aspireBranchId={aspireBranchId}
          repId={repId}
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
  reference,
  branchId,
  isAdmin,
  repId,
  repScoped,
}: {
  reference: ClientReference
  branchId: number | null
  isAdmin: boolean
  repId?: string
  repScoped: boolean
}) {
  const [editing, setEditing] = useState(false)
  const deactivate = useDeactivateClientReference(branchId ?? 0, repId)

  const isCompanyWide = reference.aspireBranchId === null
  const canEdit = isAdmin || !isCompanyWide

  if (editing && canEdit) {
    return (
      <li>
        <ClientReferenceForm
          aspireBranchId={branchId}
          existing={reference}
          repId={repId}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="rounded-md border border-[var(--border)] px-3 py-2 text-xs">
      <div className="flex items-start justify-between">
      <div>
        <span className="font-medium text-[var(--fg)]">{reference.propertyName}</span>
        <AllRegionsBadge regionId={reference.regionId} testId={`client-ref-${reference.id}-all-regions`} />
        <span className="ml-2 text-[var(--fg)] opacity-60">{reference.contactName}</span>
        <span className="ml-2 text-[var(--fg)] opacity-50">· {reference.clientSinceYear}</span>
        {!repScoped && isCompanyWide && (
          <span
            data-testid={`client-ref-${reference.id}-readonly`}
            className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800"
          >
            Company-wide (read-only)
          </span>
        )}
        {reference.ownerUserId === null && (
          <LegacyOwnerBadge testId={`client-ref-${reference.id}-legacy`} />
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
            onClick={() => deactivate.mutate(reference.id)}
            disabled={deactivate.isPending}
            className="text-red-600 opacity-70 hover:opacity-100 text-[10px] disabled:opacity-30"
          >
            Deactivate
          </button>
        </div>
      )}
      </div>
      {deactivate.isError && (
        <p role="alert" className="mt-1 text-[10px] text-red-600">
          {errorDetail(deactivate.error, 'Could not deactivate.')}
        </p>
      )}
    </li>
  )
}

// ── Create / Edit form ────────────────────────────────────────────────────────

function ClientReferenceForm({
  aspireBranchId,
  existing,
  repId,
  onDone,
}: {
  aspireBranchId: number | null
  existing?: ClientReference
  repId?: string
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

  const create = useCreateClientReference(aspireBranchId ?? 0, repId)
  const update = useUpdateClientReference(aspireBranchId ?? 0, repId)

  const isPending = create.isPending || update.isPending
  const isSuccess = create.isSuccess || update.isSuccess
  const isError = create.isError || update.isError
  const saveError = create.error ?? update.error

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
      <FormStatus
        isSuccess={isSuccess}
        isError={isError}
        errorText={errorDetail(saveError, 'Could not save. Try again.')}
      />
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

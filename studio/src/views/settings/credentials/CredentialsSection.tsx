import { useState, useRef } from 'react'
import { useRole } from '@/hooks/useRole'
import { useProposalLicenses, useProposalMediaUrl } from '@/hooks/useProposals'
import {
  useSettingsLicenses,
  useCreateLicense,
  useUpdateLicense,
  useDeactivateLicense,
  useUploadLicenseScan,
  useSettingsInsurance,
  useDeleteInsurance,
  useUploadInsuranceCert,
  useUpdateInsurance,
} from '@/hooks/useCredentials'
import { SettingsFormShell, FormStatus } from '../company/formStatus'
import type {
  LicenseCreateBody,
  LicensePatchBody,
  InsurancePatchBody,
  LicenseSettingsRow,
  InsuranceCert,
} from '@/api/settings'

// ── Public types (re-exported so tests can import them here) ──────────────────

export type { LicenseSettingsRow, InsuranceCert }

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Unified Credentials section — rendered for BOTH the company `credentials` slug
 * (aspireBranchId=null, admin-only) and the branch `branch-credentials` slug
 * (aspireBranchId=number, BM-scoped).
 *
 * Scope rules (C.5):
 *   - Company-wide rows (aspireBranchId===null on the row): BM sees read-only;
 *     admin may edit/deactivate.
 *   - Branch-scoped rows: BM can create/edit/deactivate within their branch.
 *   - Insurance: admin-only management; BM sees the list read-only.
 *
 * One shared expiry-warning banner (C.3) at the top covers BOTH insurance and
 * licenses. Expiry state uses the server-computed isExpired from
 * /proposals/config/licenses — the frontend NEVER recomputes from the date.
 */
export function CredentialsSection({
  aspireBranchId,
}: {
  aspireBranchId: number | null
}) {
  const { isAdmin } = useRole()
  const [includeExpired, setIncludeExpired] = useState(false)

  // ── Settings-path lists (management: create/edit/deactivate) ─────────────
  const licensesQuery = useSettingsLicenses({ aspireBranchId: aspireBranchId ?? undefined, includeExpired })
  const insuranceQuery = useSettingsInsurance()

  // ── Proposals-path list (expiry flag — server-computed isExpired) ─────────
  const expiryQuery = useProposalLicenses({ aspireBranchId: aspireBranchId ?? undefined })

  const licenseRows = licensesQuery.data ?? []
  const insuranceCerts = insuranceQuery.data ?? []
  const expiryData = expiryQuery.data

  // ── Expiry banner: trust server isExpired, never recompute ────────────────
  const hasExpiredLicense =
    expiryData !== undefined &&
    ([...expiryData.licenses, ...expiryData.certifications].some((l) => l.isExpired))

  // Insurance: banner also fires when the most-recent cert has a past expiryDate.
  // The settings endpoint doesn't return isExpired for insurance, but the expiryDate
  // IS the server-stored value (not client-computed). We surface it if present.
  const hasExpiredInsurance = insuranceCerts.some((cert) => {
    if (!cert.expiryDate) return false
    return cert.expiryDate < new Date().toISOString().slice(0, 10)
  })

  const showExpiryBanner = hasExpiredLicense || hasExpiredInsurance

  // Determine the slug for the section shell testid.
  // Both company-wide (null) and branch-scoped views share the slug key 'credentials'.
  const sectionSlug = aspireBranchId === null ? 'credentials' : 'credentials'

  return (
    <SettingsFormShell
      slug={sectionSlug}
      title="Credentials"
      description={
        aspireBranchId === null
          ? 'Company-wide licenses, certifications, and insurance certificate.'
          : 'Branch licenses, certifications, and company insurance certificate.'
      }
    >
      {/* Shared expiry-warning banner — ONE element covering both subsections */}
      {showExpiryBanner && (
        <div
          data-testid="credentials-expiry-banner"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <p className="text-xs font-medium text-amber-800">
            One or more credentials are expired or expiring soon. Review the items below.
          </p>
        </div>
      )}

      {/* ── Insurance area ─────────────────────────────────────────────────── */}
      <div data-testid="credentials-insurance-area" className="mb-8">
        <h3 className="mb-2 text-xs font-semibold text-[var(--fg)] uppercase tracking-wide">
          Insurance certificate
        </h3>
        <InsuranceArea
          certs={insuranceCerts}
          isLoading={insuranceQuery.isLoading}
          isError={insuranceQuery.isError}
          isAdmin={isAdmin}
        />
      </div>

      {/* ── Licenses & certifications area ────────────────────────────────── */}
      <div data-testid="credentials-licenses-area">
        <h3 className="mb-2 text-xs font-semibold text-[var(--fg)] uppercase tracking-wide">
          Licenses &amp; certifications
        </h3>

        <label className="mb-3 flex items-center gap-2 text-xs text-[var(--fg)] opacity-70 cursor-pointer">
          <input
            type="checkbox"
            checked={includeExpired}
            onChange={(e) => setIncludeExpired(e.target.checked)}
            aria-label="Include expired / inactive"
            className="rounded"
          />
          Include expired / inactive
        </label>

        <LicensesArea
          rows={licenseRows}
          isLoading={licensesQuery.isLoading}
          isError={licensesQuery.isError}
          aspireBranchId={aspireBranchId}
          isAdmin={isAdmin}
        />
      </div>
    </SettingsFormShell>
  )
}

// ── Insurance area ────────────────────────────────────────────────────────────

function InsuranceArea({
  certs,
  isLoading,
  isError,
  isAdmin,
}: {
  certs: InsuranceCert[]
  isLoading: boolean
  isError: boolean
  isAdmin: boolean
}) {
  const [showUpload, setShowUpload] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const deleteInsurance = useDeleteInsurance()

  if (isLoading) return <p className="text-xs opacity-60">Loading…</p>
  if (isError) return <p role="alert" className="text-xs text-red-600">Could not load insurance certificates.</p>

  return (
    <div>
      {certs.length === 0 && !showUpload && (
        <p className="text-xs text-[var(--fg)] opacity-60 mb-3">No insurance certificate on file.</p>
      )}

      <ul className="space-y-2 mb-4">
        {certs.map((cert) => (
          editingId === cert.id ? (
            <li key={cert.id}>
              <InsurancePatchForm
                cert={cert}
                onDone={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={cert.id}
              className="flex items-start justify-between rounded-md border border-[var(--border)] px-3 py-2 text-xs"
            >
              <div>
                <span className="font-medium text-[var(--fg)]">
                  {cert.label ?? 'Insurance certificate'}
                </span>
                {cert.expiryDate && (
                  <span className="ml-2 text-[var(--fg)] opacity-60">
                    Expires {cert.expiryDate}
                  </span>
                )}
                <InsuranceScanLink objectKey={cert.objectKey} />
              </div>
              {isAdmin && (
                <div className="flex gap-2 ml-3 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setEditingId(cert.id)}
                    className="text-[var(--fg)] opacity-60 hover:opacity-100 text-[10px]"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteInsurance.mutate(cert.id)}
                    disabled={deleteInsurance.isPending}
                    className="text-red-600 opacity-70 hover:opacity-100 text-[10px] disabled:opacity-30"
                  >
                    Remove
                  </button>
                </div>
              )}
            </li>
          )
        ))}
      </ul>

      {isAdmin && (
        showUpload ? (
          <InsuranceUploadForm onDone={() => setShowUpload(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setShowUpload(true)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--sidebar-hover-bg)]"
          >
            Upload insurance certificate
          </button>
        )
      )}
    </div>
  )
}

function InsuranceScanLink({ objectKey }: { objectKey: string }) {
  const { data } = useProposalMediaUrl(objectKey)
  if (!data?.url) return null
  return (
    <a
      href={data.url}
      target="_blank"
      rel="noopener noreferrer"
      className="ml-2 text-blue-600 text-[10px] underline"
    >
      View scan
    </a>
  )
}

function InsuranceUploadForm({ onDone }: { onDone: () => void }) {
  const [expiryDate, setExpiryDate] = useState('')
  const [label, setLabel] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const upload = useUploadInsuranceCert()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file || !expiryDate) return
    upload.mutate({ file, expiryDate, label: label || null }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-[var(--border)] px-3 py-3 space-y-2">
      <div>
        <label htmlFor="ins-label" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">
          Label (e.g. General Liability)
        </label>
        <input
          id="ins-label"
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        />
      </div>
      <div>
        <label htmlFor="ins-expiry" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">
          Expiry date <span className="text-red-500">*</span>
        </label>
        <input
          id="ins-expiry"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          required
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        />
      </div>
      <div>
        <label htmlFor="ins-file" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">
          Certificate PDF <span className="text-red-500">*</span>
        </label>
        <input
          id="ins-file"
          type="file"
          ref={fileRef}
          accept=".pdf,image/*"
          required
          className="text-xs"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={upload.isPending}
          className="rounded-md bg-[var(--sidebar-active-bg)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs">
          Cancel
        </button>
      </div>
      <FormStatus isSuccess={upload.isSuccess} isError={upload.isError} />
    </form>
  )
}

function InsurancePatchForm({ cert, onDone }: { cert: InsuranceCert; onDone: () => void }) {
  const [expiryDate, setExpiryDate] = useState(cert.expiryDate ?? '')
  const [label, setLabel] = useState(cert.label ?? '')
  const update = useUpdateInsurance()

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    const body: InsurancePatchBody = {}
    if (expiryDate !== (cert.expiryDate ?? '')) body.expiryDate = expiryDate
    if (label !== (cert.label ?? '')) body.label = label || null
    if (Object.keys(body).length === 0) { onDone(); return }
    update.mutate({ certId: cert.id, body }, { onSuccess: onDone })
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-[var(--border)] px-3 py-3 space-y-2">
      <div>
        <label htmlFor={`ins-edit-label-${cert.id}`} className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">Label</label>
        <input
          id={`ins-edit-label-${cert.id}`}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        />
      </div>
      <div>
        <label htmlFor={`ins-edit-expiry-${cert.id}`} className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">Expiry date</label>
        <input
          id={`ins-edit-expiry-${cert.id}`}
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        />
      </div>
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={update.isPending}
          className="rounded-md bg-[var(--sidebar-active-bg)] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onDone} className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs">Cancel</button>
      </div>
      <FormStatus isSuccess={update.isSuccess} isError={update.isError} />
    </form>
  )
}

// ── Licenses & certifications area ────────────────────────────────────────────

function LicensesArea({
  rows,
  isLoading,
  isError,
  aspireBranchId,
  isAdmin,
}: {
  rows: LicenseSettingsRow[]
  isLoading: boolean
  isError: boolean
  aspireBranchId: number | null
  isAdmin: boolean
}) {
  const [showCreate, setShowCreate] = useState(false)

  if (isLoading) return <p className="text-xs opacity-60">Loading…</p>
  if (isError) return <p role="alert" className="text-xs text-red-600">Could not load licenses.</p>

  return (
    <div>
      {rows.length === 0 && !showCreate && (
        <p className="text-xs text-[var(--fg)] opacity-60 mb-3">No licenses or certifications yet.</p>
      )}

      <ul className="space-y-2 mb-4">
        {rows.map((row) => (
          <LicenseRow
            key={row.id}
            row={row}
            aspireBranchId={aspireBranchId}
            isAdmin={isAdmin}
          />
        ))}
      </ul>

      {/* Only BM/admin for branch-scoped; only admin for company-wide (null) */}
      {(isAdmin || aspireBranchId !== null) && (
        showCreate ? (
          <LicenseForm
            aspireBranchId={aspireBranchId}
            onDone={() => setShowCreate(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--sidebar-hover-bg)]"
          >
            Add license / certification
          </button>
        )
      )}
    </div>
  )
}

function LicenseRow({
  row,
  aspireBranchId,
  isAdmin,
}: {
  row: LicenseSettingsRow
  aspireBranchId: number | null
  isAdmin: boolean
}) {
  const [editing, setEditing] = useState(false)
  const deactivate = useDeactivateLicense(aspireBranchId ?? undefined)

  // Company-wide rows (aspireBranchId===null): admin edits freely; BM is read-only.
  const isCompanyWide = row.aspireBranchId === null
  const canEdit = isAdmin || !isCompanyWide

  if (editing && canEdit) {
    return (
      <li>
        <LicenseForm
          aspireBranchId={aspireBranchId}
          existing={row}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between rounded-md border border-[var(--border)] px-3 py-2 text-xs">
      <div>
        <span className="rounded bg-[var(--sidebar-hover-bg)] px-1 py-0.5 text-[10px] text-[var(--fg)] opacity-70 mr-2">
          {row.kind}
        </span>
        <span className="font-medium text-[var(--fg)]">{row.name}</span>
        {row.issuingBody && (
          <span className="ml-2 text-[var(--fg)] opacity-60">{row.issuingBody}</span>
        )}
        {row.identifier && (
          <span className="ml-2 text-[var(--fg)] opacity-50">· {row.identifier}</span>
        )}
        {row.expiryDate && (
          <span className="ml-2 text-[var(--fg)] opacity-50">Exp {row.expiryDate}</span>
        )}
        {!row.active && (
          <span className="ml-2 rounded bg-gray-100 px-1 py-0.5 text-[10px] text-gray-500">Inactive</span>
        )}
        {isCompanyWide && !isAdmin && (
          <span
            data-testid={`license-${row.id}-readonly`}
            className="ml-2 rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800"
          >
            Company-wide (read-only)
          </span>
        )}
        <LicenseScanCell row={row} canEdit={canEdit} aspireBranchId={aspireBranchId} />
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
            onClick={() => deactivate.mutate(row.id)}
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

/**
 * Scan upload control + signed view link for a license row.
 * The view link is built via the media-url signer — never a hand-built GCS URL.
 */
function LicenseScanCell({
  row,
  canEdit,
  aspireBranchId,
}: {
  row: LicenseSettingsRow
  canEdit: boolean
  aspireBranchId: number | null
}) {
  const uploadScan = useUploadLicenseScan(aspireBranchId ?? undefined)
  const { data: signedUrl } = useProposalMediaUrl(row.objectKey)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    uploadScan.mutate({ licenseId: row.id, file })
  }

  return (
    <span className="ml-2">
      {row.objectKey && signedUrl?.url ? (
        <a
          href={signedUrl.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 text-[10px] underline"
        >
          View scan
        </a>
      ) : (
        row.objectKey && !signedUrl?.url ? (
          <span className="text-[10px] opacity-50">Scan (loading link…)</span>
        ) : null
      )}
      {canEdit && (
        <label className="ml-2 cursor-pointer text-[10px] text-[var(--fg)] opacity-60 hover:opacity-100">
          <input
            type="file"
            accept=".pdf,image/*"
            className="sr-only"
            data-testid={`license-${row.id}-scan-upload`}
            onChange={onFileChange}
            disabled={uploadScan.isPending}
          />
          {uploadScan.isPending ? 'Uploading…' : row.objectKey ? 'Replace scan' : 'Upload scan'}
        </label>
      )}
    </span>
  )
}

// ── License create/edit form ───────────────────────────────────────────────────

function LicenseForm({
  aspireBranchId,
  existing,
  onDone,
}: {
  aspireBranchId: number | null
  existing?: LicenseSettingsRow
  onDone: () => void
}) {
  const [kind, setKind] = useState<'license' | 'certification'>(existing?.kind ?? 'license')
  const [name, setName] = useState(existing?.name ?? '')
  const [issuingBody, setIssuingBody] = useState(existing?.issuingBody ?? '')
  const [identifier, setIdentifier] = useState(existing?.identifier ?? '')
  const [holderName, setHolderName] = useState(existing?.holderName ?? '')
  const [issuedDate, setIssuedDate] = useState(existing?.issuedDate ?? '')
  const [expiryDate, setExpiryDate] = useState(existing?.expiryDate ?? '')

  const create = useCreateLicense(aspireBranchId ?? undefined)
  const update = useUpdateLicense(aspireBranchId ?? undefined)

  const isPending = create.isPending || update.isPending
  const isSuccess = create.isSuccess || update.isSuccess
  const isError = create.isError || update.isError

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return

    if (existing) {
      const body: LicensePatchBody = {}
      if (kind !== existing.kind) body.kind = kind
      if (name !== existing.name) body.name = name
      if (issuingBody !== (existing.issuingBody ?? '')) body.issuingBody = issuingBody || null
      if (identifier !== (existing.identifier ?? '')) body.identifier = identifier || null
      if (holderName !== (existing.holderName ?? '')) body.holderName = holderName || null
      if (issuedDate !== (existing.issuedDate ?? '')) body.issuedDate = issuedDate || null
      if (expiryDate !== (existing.expiryDate ?? '')) body.expiryDate = expiryDate || null
      if (Object.keys(body).length === 0) { onDone(); return }
      update.mutate({ licenseId: existing.id, body }, { onSuccess: onDone })
    } else {
      const body: LicenseCreateBody = {
        kind,
        name,
        issuingBody: issuingBody || null,
        identifier: identifier || null,
        holderName: holderName || null,
        aspireBranchId,
        issuedDate: issuedDate || null,
        expiryDate: expiryDate || null,
      }
      create.mutate(body, { onSuccess: onDone })
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-[var(--border)] px-3 py-3 space-y-2">
      <div>
        <label htmlFor="lic-kind" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">
          Type <span className="text-red-500">*</span>
        </label>
        <select
          id="lic-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'license' | 'certification')}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        >
          <option value="license">License</option>
          <option value="certification">Certification</option>
        </select>
      </div>
      <LicField id="lic-name" label="Name" value={name} onChange={setName} required />
      <LicField id="lic-body" label="Issuing body" value={issuingBody} onChange={setIssuingBody} />
      <LicField id="lic-id" label="Identifier / number" value={identifier} onChange={setIdentifier} />
      <LicField id="lic-holder" label="Holder name" value={holderName} onChange={setHolderName} />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor="lic-issued" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">Issued date</label>
          <input
            id="lic-issued"
            type="date"
            value={issuedDate}
            onChange={(e) => setIssuedDate(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          />
        </div>
        <div>
          <label htmlFor="lic-expiry" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">Expiry date</label>
          <input
            id="lic-expiry"
            type="date"
            value={expiryDate}
            onChange={(e) => setExpiryDate(e.target.value)}
            className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
          />
        </div>
      </div>
      <p className="text-[10px] text-[var(--fg)] opacity-50">
        Leave expiry date blank for non-expiring credentials.
      </p>
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

function LicField({
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

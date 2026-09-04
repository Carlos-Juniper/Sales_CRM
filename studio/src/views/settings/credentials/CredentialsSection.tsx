import { useState } from 'react'
import { useRole } from '@/hooks/useRole'
import { useProposalLicenses, useProposalMediaUrl } from '@/hooks/useProposals'
import {
  useSettingsLicenses,
  useCreateLicense,
  useUpdateLicense,
  useDeactivateLicense,
  useUploadLicenseScan,
} from '@/hooks/useCredentials'
import { SettingsFormShell, FormStatus } from '../company/formStatus'
import type {
  LicenseCreateBody,
  LicensePatchBody,
  LicenseSettingsRow,
  DocumentKind,
} from '@/api/settings'

// ── Public types (re-exported so tests can import them here) ──────────────────

export type { LicenseSettingsRow }

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Unified Documents section — manages licenses, certifications, and insurance
 * documents in a single list. Rendered for BOTH the company `credentials` slug
 * (aspireBranchId=null, admin-only) and the branch `branch-credentials` slug
 * (aspireBranchId=number, BM-scoped).
 *
 * Scope rules (Handoff 42):
 *   - Company-wide rows (row.aspireBranchId===null): BM sees read-only; admin may edit/deactivate.
 *   - Branch-scoped rows: BM can create/edit/deactivate within their branch.
 *   - Insurance is no longer admin-only — branch-scoped insurance can be created by BMs.
 *
 * Expiry banner (C.3) uses server-computed isExpired from /proposals/config/licenses.
 * The frontend NEVER recomputes expiry from the date string.
 */
export function CredentialsSection({
  aspireBranchId,
}: {
  aspireBranchId: number | null
}) {
  const { isAdmin } = useRole()
  const [includeExpired, setIncludeExpired] = useState(false)

  // Settings-path list — all kinds in one query
  const docsQuery = useSettingsLicenses({ aspireBranchId: aspireBranchId ?? undefined, includeExpired })

  // Proposals-path list — carries server-computed isExpired; used only for the banner
  const expiryQuery = useProposalLicenses({ aspireBranchId: aspireBranchId ?? undefined })

  const rows = docsQuery.data ?? []
  const expiryData = expiryQuery.data

  // Banner: trust server isExpired, never recompute from date string
  const hasExpiredDoc =
    expiryData !== undefined &&
    ([...expiryData.licenses, ...expiryData.certifications].some((l) => l.isExpired))

  // Insurance rows from the unified list: check expiryDate verbatim (server value)
  const hasExpiredInsuranceRow = rows.some((row) => {
    if (row.kind !== 'insurance') return false
    return row.expiryDate < new Date().toISOString().slice(0, 10)
  })

  const showExpiryBanner = hasExpiredDoc || hasExpiredInsuranceRow

  return (
    <SettingsFormShell
      slug="credentials"
      title="Documents"
      description={
        aspireBranchId === null
          ? 'Company-wide licenses, certifications, and insurance documents.'
          : 'Branch licenses, certifications, and insurance documents.'
      }
    >
      {/* Shared expiry-warning banner covering all document kinds */}
      {showExpiryBanner && (
        <div
          data-testid="credentials-expiry-banner"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3"
        >
          <p className="text-xs font-medium text-amber-800">
            One or more documents are expired or expiring soon. Review the items below.
          </p>
        </div>
      )}

      {/* ── Unified documents area ──────────────────────────────────────────── */}
      <div data-testid="credentials-licenses-area">
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

        <DocumentsArea
          rows={rows}
          isLoading={docsQuery.isLoading}
          isError={docsQuery.isError}
          aspireBranchId={aspireBranchId}
          isAdmin={isAdmin}
        />
      </div>
    </SettingsFormShell>
  )
}

// ── Documents list area ───────────────────────────────────────────────────────

function DocumentsArea({
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
  if (isError) return <p role="alert" className="text-xs text-red-600">Could not load documents.</p>

  return (
    <div>
      {rows.length === 0 && !showCreate && (
        <p className="text-xs text-[var(--fg)] opacity-60 mb-3">No documents yet.</p>
      )}

      <ul className="space-y-2 mb-4">
        {rows.map((row) => (
          <DocumentRow
            key={row.id}
            row={row}
            aspireBranchId={aspireBranchId}
            isAdmin={isAdmin}
          />
        ))}
      </ul>

      {/* BM can create branch-scoped docs; admin can create company-wide or branch-scoped */}
      {(isAdmin || aspireBranchId !== null) && (
        showCreate ? (
          <DocumentForm
            aspireBranchId={aspireBranchId}
            onDone={() => setShowCreate(false)}
          />
        ) : (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--sidebar-hover-bg)]"
          >
            Add document
          </button>
        )
      )}
    </div>
  )
}

// ── Document row ──────────────────────────────────────────────────────────────

function DocumentRow({
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

  // Company-wide rows (row.aspireBranchId===null): admin edits freely; BM is read-only.
  const isCompanyWide = row.aspireBranchId === null
  const canEdit = isAdmin || !isCompanyWide

  if (editing && canEdit) {
    return (
      <li>
        <DocumentForm
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
        <span className="ml-2 text-[var(--fg)] opacity-50">Exp {row.expiryDate}</span>
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
        <DocumentScanCell row={row} canEdit={canEdit} aspireBranchId={aspireBranchId} />
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

// ── Scan/file upload cell + signed view link ──────────────────────────────────

/**
 * One file upload per document row (the /scan endpoint). Accepts any file type.
 * View link is built via the media-url signer — never a hand-built GCS URL.
 */
function DocumentScanCell({
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

// ── Document create/edit form ─────────────────────────────────────────────────

const KIND_LABELS: Record<DocumentKind, string> = {
  license: 'License',
  certification: 'Certification',
  insurance: 'Insurance',
}

function DocumentForm({
  aspireBranchId,
  existing,
  onDone,
}: {
  aspireBranchId: number | null
  existing?: LicenseSettingsRow
  onDone: () => void
}) {
  const [kind, setKind] = useState<DocumentKind>(existing?.kind ?? 'license')
  const [name, setName] = useState(existing?.name ?? '')
  const [expiryDate, setExpiryDate] = useState(existing?.expiryDate ?? '')
  const [issuingBody, setIssuingBody] = useState(existing?.issuingBody ?? '')
  const [identifier, setIdentifier] = useState(existing?.identifier ?? '')
  const [holderName, setHolderName] = useState(existing?.holderName ?? '')
  const [issuedDate, setIssuedDate] = useState(existing?.issuedDate ?? '')

  const create = useCreateLicense(aspireBranchId ?? undefined)
  const update = useUpdateLicense(aspireBranchId ?? undefined)

  const isPending = create.isPending || update.isPending
  const isSuccess = create.isSuccess || update.isSuccess
  const isError = create.isError || update.isError

  // Insurance rows typically leave the license-specific metadata fields null;
  // hide them when kind='insurance' to keep the form clean.
  const showLicenseFields = kind !== 'insurance'

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !expiryDate) return

    if (existing) {
      const body: LicensePatchBody = {}
      if (kind !== existing.kind) body.kind = kind
      if (name !== existing.name) body.name = name
      if (expiryDate !== existing.expiryDate) body.expiryDate = expiryDate
      if (issuingBody !== (existing.issuingBody ?? '')) body.issuingBody = issuingBody || null
      if (identifier !== (existing.identifier ?? '')) body.identifier = identifier || null
      if (holderName !== (existing.holderName ?? '')) body.holderName = holderName || null
      if (issuedDate !== (existing.issuedDate ?? '')) body.issuedDate = issuedDate || null
      if (Object.keys(body).length === 0) { onDone(); return }
      update.mutate({ licenseId: existing.id, body }, { onSuccess: onDone })
    } else {
      const body: LicenseCreateBody = {
        kind,
        name,
        expiryDate,
        issuingBody: issuingBody || null,
        identifier: identifier || null,
        holderName: holderName || null,
        aspireBranchId,
        issuedDate: issuedDate || null,
      }
      create.mutate(body, { onSuccess: onDone })
    }
  }

  return (
    <form onSubmit={onSubmit} className="rounded-md border border-[var(--border)] px-3 py-3 space-y-2">
      <div>
        <label htmlFor="doc-kind" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">
          Type <span className="text-red-500">*</span>
        </label>
        <select
          id="doc-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as DocumentKind)}
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        >
          {(Object.keys(KIND_LABELS) as DocumentKind[]).map((k) => (
            <option key={k} value={k}>{KIND_LABELS[k]}</option>
          ))}
        </select>
      </div>

      <DocField id="doc-name" label="Name" value={name} onChange={setName} required />

      <div>
        <label htmlFor="doc-expiry" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">
          Expiry date <span className="text-red-500">*</span>
        </label>
        <input
          id="doc-expiry"
          type="date"
          value={expiryDate}
          onChange={(e) => setExpiryDate(e.target.value)}
          required
          className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
        />
      </div>

      {/* License/certification metadata fields — hidden for insurance */}
      {showLicenseFields && (
        <>
          <DocField id="doc-body" label="Issuing body" value={issuingBody} onChange={setIssuingBody} />
          <DocField id="doc-id" label="Identifier / number" value={identifier} onChange={setIdentifier} />
          <DocField id="doc-holder" label="Holder name" value={holderName} onChange={setHolderName} />
          <div>
            <label htmlFor="doc-issued" className="block text-[10px] font-medium text-[var(--fg)] opacity-70 mb-0.5">Issued date</label>
            <input
              id="doc-issued"
              type="date"
              value={issuedDate}
              onChange={(e) => setIssuedDate(e.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs"
            />
          </div>
        </>
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

// ── Shared field primitive ────────────────────────────────────────────────────

function DocField({
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

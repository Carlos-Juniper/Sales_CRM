import { useState } from 'react'
import {
  usePortfolio,
  useCreatePortfolioProperty,
  useUpdatePortfolioProperty,
  useDeletePortfolioProperty,
} from '@/hooks/useProposals'
import type { PortfolioProperty } from '@/types/proposal'
import type {
  PortfolioPropertyCreateBody,
  PortfolioPropertyPatchBody,
} from '@/api/settings'
import { SettingsFormShell, FormStatus } from './formStatus'

/**
 * Portfolio properties management section (Slice 13b).
 *
 * Admin-only, company-scoped. Listed/created/edited/deleted here; the
 * CompanySection wrapper already gates the entire Company group to admin,
 * but CompanySection also applies a second defense-in-depth check for
 * non-admin callers (renders an "Admin only" note rather than the form).
 *
 * DELETE is a hard delete until a backend migration adds an `active` column
 * (follow-up task #18). This is documented but not blocked here.
 *
 * Photo uploads (GCS) are a Slice 15 concern — not available here yet.
 */
export function PortfolioSection() {
  const { data, isLoading, isError } = usePortfolio()
  const [showCreate, setShowCreate] = useState(false)

  if (isLoading) {
    return (
      <SettingsFormShell slug="portfolio" title="Portfolio">
        <p className="text-xs opacity-60">Loading…</p>
      </SettingsFormShell>
    )
  }
  if (isError) {
    return (
      <SettingsFormShell slug="portfolio" title="Portfolio">
        <p role="alert" className="text-xs text-red-600">
          Could not load portfolio properties.
        </p>
      </SettingsFormShell>
    )
  }

  const properties = data ?? []

  return (
    <SettingsFormShell
      slug="portfolio"
      title="Portfolio"
      description="Portfolio properties featured in proposal packages. Photo uploads are managed separately (Slice 15)."
    >
      {properties.length === 0 && !showCreate && (
        <p className="text-xs text-[var(--fg)] opacity-60 mb-3">
          No portfolio properties yet.
        </p>
      )}

      <ul className="space-y-2 mb-4">
        {properties.map((property) => (
          <PortfolioPropertyRow key={property.id} property={property} />
        ))}
      </ul>

      {showCreate ? (
        <PortfolioPropertyForm onDone={() => setShowCreate(false)} />
      ) : (
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="rounded-md border border-[var(--border)] px-3 py-1.5 text-xs font-medium text-[var(--fg)] hover:bg-[var(--sidebar-hover-bg)]"
        >
          Add portfolio property
        </button>
      )}
    </SettingsFormShell>
  )
}

// ── Row ───────────────────────────────────────────────────────────────────────

function PortfolioPropertyRow({ property }: { property: PortfolioProperty }) {
  const [editing, setEditing] = useState(false)
  const del = useDeletePortfolioProperty()

  if (editing) {
    return (
      <li>
        <PortfolioPropertyForm
          existing={property}
          onDone={() => setEditing(false)}
        />
      </li>
    )
  }

  return (
    <li className="flex items-start justify-between rounded-md border border-[var(--border)] px-3 py-2 text-xs">
      <div>
        <span className="font-medium text-[var(--fg)]">{property.name}</span>
        <span className="ml-2 text-[var(--fg)] opacity-60">{property.cityState}</span>
        <span className="ml-2 text-[var(--fg)] opacity-50">· {property.regionId}</span>
      </div>
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
          onClick={() => del.mutate(property.id)}
          disabled={del.isPending}
          className="text-red-600 opacity-70 hover:opacity-100 text-[10px] disabled:opacity-30"
        >
          Delete
        </button>
      </div>
    </li>
  )
}

// ── Create / Edit form ────────────────────────────────────────────────────────

function PortfolioPropertyForm({
  existing,
  onDone,
}: {
  existing?: PortfolioProperty
  onDone: () => void
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [cityState, setCityState] = useState(existing?.cityState ?? '')
  const [regionId, setRegionId] = useState(existing?.regionId ?? '')

  const create = useCreatePortfolioProperty()
  const update = useUpdatePortfolioProperty()

  const isPending = create.isPending || update.isPending
  const isSuccess = create.isSuccess || update.isSuccess
  const isError = create.isError || update.isError

  function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !cityState.trim() || !regionId.trim()) return

    if (existing) {
      const body: PortfolioPropertyPatchBody = {}
      if (name !== existing.name) body.name = name
      if (cityState !== existing.cityState) body.cityState = cityState
      if (regionId !== existing.regionId) body.regionId = regionId
      if (Object.keys(body).length === 0) { onDone(); return }
      update.mutate({ propertyId: existing.id, body }, { onSuccess: onDone })
    } else {
      const body: PortfolioPropertyCreateBody = { name, cityState, regionId }
      create.mutate(body, { onSuccess: onDone })
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-md border border-[var(--border)] px-3 py-3 space-y-2"
    >
      <Field id="pp-name" label="Name" value={name} onChange={setName} required />
      <Field id="pp-city-state" label="City / State" value={cityState} onChange={setCityState} required />
      <Field id="pp-region" label="Region ID" value={regionId} onChange={setRegionId} required />
      <p className="text-[10px] text-[var(--fg)] opacity-50">
        Photo uploads are managed separately via GCS (Slice 15).
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

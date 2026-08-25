/**
 * PropertySelector — pick or create the property an estimate/opportunity belongs to.
 *
 * The LOCAL /api/properties table is the source of truth: search reads it; a new
 * property is created locally (pending) and pushed to Aspire in the background.
 * Before creating, the estimator sees the selected property's PRIOR Aspire
 * opportunities (best-effort) so historical / other-employee work is caught first
 * — Melissa's front-end dedup step. "Create new" is only reachable after a search
 * so a miss is a deliberate choice, not the default.
 */
import { useEffect, useState } from 'react'
import { propertiesApi } from '@/api/estimating'
import type { AspireOpportunitySummary, CreatePropertyPayload, Property } from '@/types/estimating'
import { BranchPicker } from './AspirePickers'

/**
 * Canonical-origin fields for a newly created property (Handoff 15). When the
 * property originates from an HOA prospect, pass
 * `{ propertyType: 'hoa', sourceType: 'hoa', sourceId: <hoa id> }`; omitted
 * fields default to 'manual' / null.
 */
export interface PropertyOrigin {
  propertyType?: string
  sourceType?: string
  sourceId?: string | null
}

interface Props {
  value: Property | null
  onSelect: (property: Property | null) => void
  origin?: PropertyOrigin
}

export function PropertySelector({ value, onSelect, origin }: Props) {
  if (value) {
    return <SelectedProperty property={value} onChange={() => onSelect(null)} />
  }
  return <PropertySearch onSelect={onSelect} origin={origin} />
}

function PropertySearch({
  onSelect,
  origin,
}: {
  onSelect: (p: Property) => void
  origin?: PropertyOrigin
}) {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<Property[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch() {
    setSearching(true)
    setCreating(false)
    setError(null)
    try {
      setResults(await propertiesApi.list(term))
    } catch {
      setError('Search failed. Please try again.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <div className="space-y-3">
      {/* Not a <form>: PropertySelector renders inside the intake modal's <form>,
          and nested forms are invalid HTML (a submit here would fire the outer
          form). Enter in the input triggers the search via onKeyDown instead. */}
      <div className="flex gap-2">
        <input
          aria-label="Search properties"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSearch()
            }
          }}
          placeholder="Search by name or address…"
          className="flex-1 rounded border border-gray-300 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={searching}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {searching ? 'Searching…' : 'Search'}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      {results && !creating && (
        <div className="rounded border border-gray-200">
          {results.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-500">No matching properties.</p>
          )}
          <ul>
            {results.map((p) => (
              <li key={p.id} className="border-b border-gray-100 last:border-0">
                <button
                  type="button"
                  onClick={() => onSelect(p)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
                >
                  <span className="font-medium">{p.name}</span>
                  {p.address1 && <span className="ml-2 text-gray-500">{p.address1}</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-gray-200 p-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="text-sm font-medium text-blue-600 hover:underline"
            >
              + Create new property
            </button>
          </div>
        </div>
      )}

      {creating && <CreatePropertyForm defaultName={term} onCreated={onSelect} origin={origin} />}
    </div>
  )
}

function CreatePropertyForm({
  defaultName,
  onCreated,
  origin,
}: {
  defaultName: string
  onCreated: (p: Property) => void
  origin?: PropertyOrigin
}) {
  const sourceType = origin?.sourceType ?? 'manual'
  const [form, setForm] = useState<CreatePropertyPayload>({
    name: defaultName,
    // Canonical origin (Handoff 15): propertyType drives estimating/Aspire
    // logic; sourceType/sourceId trace provenance (manual ⇒ no sourceId).
    propertyType: origin?.propertyType ?? (sourceType !== 'manual' ? sourceType : 'manual'),
    sourceType,
    sourceId: sourceType !== 'manual' ? (origin?.sourceId ?? null) : null,
    address1: '',
    city: '',
    state: '',
    zip: '',
    branchCity: '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function set<K extends keyof CreatePropertyPayload>(key: K, v: CreatePropertyPayload[K]) {
    setForm((f) => ({ ...f, [key]: v }))
  }

  async function handleCreate() {
    if (!form.name.trim()) {
      setError('Property name is required.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const created = await propertiesApi.create(form)
      onCreated(created)
    } catch {
      setError('Could not create the property. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full rounded border border-gray-300 px-2 py-1.5 text-sm'

  // Not a <form>: renders inside the intake modal's <form> (nested forms are
  // invalid HTML). The Create button calls handleCreate() directly.
  return (
    <div className="space-y-2 rounded border border-gray-200 p-3">
      <div>
        <label htmlFor="prop-name" className="mb-1 block text-xs font-medium text-gray-600">
          Property name
        </label>
        <input
          id="prop-name"
          className={field}
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          required
        />
      </div>
      <input
        aria-label="Address"
        className={field}
        placeholder="Address"
        value={form.address1 ?? ''}
        onChange={(e) => set('address1', e.target.value)}
      />
      <div className="grid grid-cols-3 gap-2">
        <input aria-label="City" className={field} placeholder="City" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
        <input aria-label="State" className={field} placeholder="State" value={form.state ?? ''} onChange={(e) => set('state', e.target.value)} />
        <input aria-label="Zip" className={field} placeholder="Zip" value={form.zip ?? ''} onChange={(e) => set('zip', e.target.value)} />
      </div>
      <BranchPicker label="Branch" value={form.branchCity ?? ''} onChange={(v) => set('branchCity', v)} />
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={() => void handleCreate()}
        disabled={saving}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
      >
        {saving ? 'Creating…' : 'Create property'}
      </button>
    </div>
  )
}

function SelectedProperty({ property, onChange }: { property: Property; onChange: () => void }) {
  const [opps, setOpps] = useState<AspireOpportunitySummary[] | null>(null)

  useEffect(() => {
    let active = true
    propertiesApi
      .opportunities(property.id)
      .then((data) => active && setOpps(data))
      .catch(() => active && setOpps([]))
    return () => {
      active = false
    }
  }, [property.id])

  return (
    <div className="space-y-2 rounded border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium">{property.name}</span>
          {property.address1 && <span className="ml-2 text-sm text-gray-500">{property.address1}</span>}
        </div>
        <button type="button" onClick={onChange} className="text-sm font-medium text-blue-600 hover:underline">
          Change
        </button>
      </div>
      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
          Prior Aspire opportunities
        </h4>
        {opps === null ? (
          <p className="text-sm text-gray-400">Checking…</p>
        ) : opps.length === 0 ? (
          <p className="text-sm text-gray-400">No prior opportunities found.</p>
        ) : (
          <ul className="mt-1 space-y-1">
            {opps.map((o) => (
              <li key={o.OpportunityID} className="text-sm">
                <span className="font-medium">{o.OpportunityName ?? 'Opportunity'}</span>
                {o.OpportunityNumber != null && (
                  <span className="ml-2 text-gray-500">#{String(o.OpportunityNumber)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

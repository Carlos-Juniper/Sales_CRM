import { useState, useMemo, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopNav } from '@/components/layout/TopNav'
import { useHOAProperties, useHOAFilterOptions, type HOAFilterParams } from '@/hooks/useHOAProperties'
import { useManagementCompanies, useCreateManagementCompany } from '@/hooks/useManagementCompanies'
import { useCreateHOAProperty, usePromoteHOAProperty } from '@/hooks/useHOAProperties'
import { AccountsToolbar } from './components/accounts/AccountsToolbar'
import { HOATable } from './components/accounts/HOATable'
import { PMList } from './components/accounts/PMList'
import { AddHOAPanel } from './components/accounts/AddHOAPanel'
import { AddPMPanel } from './components/accounts/AddPMPanel'
import { HOADetailPanel } from './components/accounts/HOADetailPanel'
import type { FilterState } from '@/hooks/useAccountFilters'
import type { AccountTab, HOAProperty } from '@/types/accounts'

const HOA_STATUSES = ['Prospect', 'Bidding', 'Active', 'At Risk', 'Lost']
const PM_STATUSES = ['Partner', 'Engaged', 'Target', 'Inactive']

function emptyFilters(): FilterState {
  return { rep: new Set(), branch: new Set(), city: new Set(), status: new Set(), contacted: new Set() }
}

export default function AccountsPage() {
  const navigate = useNavigate()

  const [tab, setTab] = useState<AccountTab>('hoa')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [hoaFilters, setHoaFilters] = useState<FilterState>(emptyFilters())
  const [pmFilters, setPmFilters] = useState<FilterState>(emptyFilters())

  // Debounce search so typing doesn't fire a BigQuery call on every keystroke
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 400)
    return () => clearTimeout(t)
  }, [search])

  // Derive HOA server-side filter params — dropdown filters apply immediately, search is debounced
  const hoaParams = useMemo<HOAFilterParams>(() => ({
    search: debouncedSearch || undefined,
    status: hoaFilters.status.size ? [...hoaFilters.status].join(',') : undefined,
    branch_id: hoaFilters.branch.size ? [...hoaFilters.branch].join(',') : undefined,
    city: hoaFilters.city.size ? [...hoaFilters.city].join(',') : undefined,
  }), [debouncedSearch, hoaFilters])

  const { data: hoaProperties = [], isLoading: hoaLoading } = useHOAProperties(hoaParams)
  const { data: pmCompanies = [], isLoading: pmLoading } = useManagementCompanies()
  const { data: filterOptionsData } = useHOAFilterOptions()
  const isLoading = hoaLoading || pmLoading

  const createHOAProperty = useCreateHOAProperty()
  const createManagementCompany = useCreateManagementCompany()
  const promoteHOAProperty = usePromoteHOAProperty()

  const [addPanel, setAddPanel] = useState<AccountTab | null>(null)
  const [selectedHOA, setSelectedHOA] = useState<HOAProperty | null>(null)
  const [expandedPM, setExpandedPM] = useState<Set<string>>(new Set())

  // PM filtering is client-side (3K rows is fine)
  const q = search.trim().toLowerCase()
  const filteredPM = useMemo(() => pmCompanies.filter((c) => {
    if (q && !(
      c.company_name.toLowerCase().includes(q) ||
      (c.city ?? '').toLowerCase().includes(q) ||
      c.contacts.some((ct) => (ct.name ?? '').toLowerCase().includes(q))
    )) return false
    if (pmFilters.status.size && !pmFilters.status.has(c.status)) return false
    if (pmFilters.city.size && !pmFilters.city.has(c.city ?? '')) return false
    return true
  }), [pmCompanies, q, pmFilters])

  // Properties per PM company (used by PM tab accordion)
  const propertiesForCompany = useMemo(() => {
    const map = new Map<string, HOAProperty[]>()
    for (const p of hoaProperties) {
      if (p.management_company_id) {
        const existing = map.get(p.management_company_id) ?? []
        existing.push(p)
        map.set(p.management_company_id, existing)
      }
    }
    return map
  }, [hoaProperties])

  const filters = { hoa: hoaFilters, pm: pmFilters }
  const currentFilters = tab === 'hoa' ? hoaFilters : pmFilters
  const activeFilterCount =
    currentFilters.rep.size + currentFilters.branch.size + currentFilters.city.size +
    currentFilters.status.size + currentFilters.contacted.size

  function updateFilter(t: AccountTab, key: keyof FilterState, next: Set<string>) {
    if (t === 'hoa') setHoaFilters((prev) => ({ ...prev, [key]: next }))
    else setPmFilters((prev) => ({ ...prev, [key]: next }))
  }

  function clearAllFilters() {
    if (tab === 'hoa') setHoaFilters(emptyFilters())
    else setPmFilters(emptyFilters())
  }

  function togglePM(id: string) {
    setExpandedPM((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function handleCreateBid(property: HOAProperty) {
    const lead = await promoteHOAProperty.mutateAsync(property.id)
    navigate(`/inside-sales/bids?leadId=${lead.id}`)
  }

  const filterOptions = {
    reps: [],
    branches: filterOptionsData?.branches ?? [],
    cities: tab === 'hoa'
      ? filterOptionsData?.cities ?? []
      : [...new Set(pmCompanies.map((c) => c.city).filter(Boolean) as string[])].sort(),
    statuses: tab === 'hoa' ? HOA_STATUSES : PM_STATUSES,
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopNav
        title="Accounts"
        subtitle={`${hoaProperties.length} HOA properties · ${pmCompanies.length} management companies`}
      />

      <AccountsToolbar
        tab={tab}
        onTabChange={(t) => { setTab(t) }}
        hoaCount={hoaProperties.length}
        pmCount={pmCompanies.length}
        search={search}
        onSearchChange={setSearch}
        filters={filters}
        onUpdateFilter={updateFilter}
        onClearAll={clearAllFilters}
        activeFilterCount={activeFilterCount}
        onAdd={() => setAddPanel(tab)}
        filterOptions={filterOptions}
      />

      <div className="flex-1 overflow-y-auto p-4">
        {tab === 'hoa' ? (
          isLoading ? (
            <div className="text-sm text-[hsl(var(--muted-fg))] text-center py-10">Loading…</div>
          ) : hoaProperties.length === 0 ? (
            <div className="text-center py-12 text-sm text-[hsl(var(--muted-fg))]">
              No properties match your search.
            </div>
          ) : (
            <HOATable
              rows={hoaProperties}
              companies={pmCompanies}
              onSelect={setSelectedHOA}
            />
          )
        ) : (
          <PMList
            companies={filteredPM}
            expandedIds={expandedPM}
            onToggle={togglePM}
            onSelectProperty={setSelectedHOA}
            propertiesForCompany={propertiesForCompany}
          />
        )}
      </div>

      {addPanel === 'hoa' && (
        <AddHOAPanel
          isOpen
          onClose={() => setAddPanel(null)}
          onSave={async (body) => {
            await createHOAProperty.mutateAsync(body)
            setAddPanel(null)
          }}
          managementCompanies={pmCompanies}
        />
      )}

      {addPanel === 'pm' && (
        <AddPMPanel
          isOpen
          onClose={() => setAddPanel(null)}
          onSave={async (body) => {
            await createManagementCompany.mutateAsync(body)
            setAddPanel(null)
          }}
        />
      )}

      {selectedHOA && (
        <HOADetailPanel
          isOpen
          property={selectedHOA}
          company={pmCompanies.find((c) => c.id === selectedHOA.management_company_id) ?? null}
          onClose={() => setSelectedHOA(null)}
          onCreateBid={handleCreateBid}
        />
      )}
    </div>
  )
}

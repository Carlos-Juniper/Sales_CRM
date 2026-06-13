import { useState, useMemo } from 'react'
import type { AccountTab, HOAProperty, ManagementCompany } from '@/types/accounts'

export interface FilterState {
  rep: Set<string>
  branch: Set<string>
  city: Set<string>
  status: Set<string>
  contacted: Set<string>
}

function emptyFilters(): FilterState {
  return {
    rep: new Set(),
    branch: new Set(),
    city: new Set(),
    status: new Set(),
    contacted: new Set(),
  }
}

export function useAccountFilters(
  hoaProperties: HOAProperty[],
  pmCompanies: ManagementCompany[],
) {
  const [tab, setTab] = useState<AccountTab>('hoa')
  const [search, setSearch] = useState('')
  const [filters, setFilters] = useState<{ hoa: FilterState; pm: FilterState }>({
    hoa: emptyFilters(),
    pm: emptyFilters(),
  })

  const currentFilters = filters[tab]

  const activeFilterCount =
    currentFilters.rep.size +
    currentFilters.branch.size +
    currentFilters.city.size +
    currentFilters.status.size +
    currentFilters.contacted.size

  function updateFilter(tab: AccountTab, key: keyof FilterState, next: Set<string>) {
    setFilters((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], [key]: next },
    }))
  }

  function clearAllFilters() {
    setFilters((prev) => ({ ...prev, [tab]: emptyFilters() }))
  }

  const q = search.trim().toLowerCase()

  const filteredHOA = useMemo(() => {
    const hf = filters.hoa
    return hoaProperties.filter((p) => {
      if (
        q &&
        !(
          p.property_name.toLowerCase().includes(q) ||
          (p.association_name ?? '').toLowerCase().includes(q) ||
          (p.city ?? '').toLowerCase().includes(q) ||
          (p.county ?? '').toLowerCase().includes(q)
        )
      )
        return false
      if (hf.status.size && !hf.status.has(p.status)) return false
      if (hf.branch.size && !hf.branch.has(p.branch ?? '')) return false
      if (hf.city.size && !hf.city.has(p.city)) return false
      return true
    })
  }, [hoaProperties, q, filters.hoa])

  const filteredPM = useMemo(() => {
    const pf = filters.pm
    return pmCompanies.filter((c) => {
      if (
        q &&
        !(
          c.company_name.toLowerCase().includes(q) ||
          (c.city ?? '').toLowerCase().includes(q) ||
          c.contacts.some((ct) => (ct.name ?? '').toLowerCase().includes(q))
        )
      )
        return false
      if (pf.status.size && !pf.status.has(c.status)) return false
      if (pf.city.size && !pf.city.has(c.city ?? '')) return false
      return true
    })
  }, [pmCompanies, q, filters.pm])

  // Map from company id → properties it manages (for PM tab expansion)
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

  return {
    tab,
    setTab,
    search,
    setSearch,
    filters,
    updateFilter,
    clearAllFilters,
    activeFilterCount,
    filteredHOA,
    filteredPM,
    propertiesForCompany,
  }
}

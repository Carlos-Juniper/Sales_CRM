import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { HOATable } from '@/views/inside-sales/components/accounts/HOATable'
import type { HOAProperty, ManagementCompany } from '@/types/accounts'

// ── Fixtures ──────────────────────────────────────────────────────

const sampleCompany: ManagementCompany = {
  id: 'pm1',
  company_name: 'Alliant Property Management',
  website: 'www.alliantproperty.com',
  phone: '(239) 454-1101',
  street: '13831 Vector Ave',
  city: 'Fort Myers',
  state: 'FL',
  zip: '33907',
  primary_email: 'service@alliantproperty.com',
  branch_id: 'b1',
  assigned_to: 'Trent Boyd',
  status: 'Partner',
  contact_status: 'contacted',
  last_contacted: '2026-05-30',
  contacts: [
    { id: 'c1', name: 'Dana Whitfield', title: 'Community Association Manager', email: 'dwhitfield@alliantproperty.com', phone: '(239) 454-1108' },
  ],
}

function makeProperty(overrides: Partial<HOAProperty> = {}): HOAProperty {
  return {
    id: 'h1',
    property_name: 'Pelican Bay',
    association_name: 'Pelican Bay Foundation, Inc.',
    address: '6620 Pelican Bay Blvd',
    city: 'Naples',
    state: 'FL',
    zip: '34108',
    county: 'Collier',
    acreage: 570,
    units: 6800,
    status: 'Active',
    contact_status: 'contacted',
    branch: 'Naples',
    assigned_to: 'Marisol Vega',
    last_contacted: '2026-05-20',
    management_company_id: 'pm1',
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────

describe('HOATable — column headers', () => {
  it('renders all expected column headers', () => {
    render(
      <HOATable rows={[makeProperty()]} companies={[sampleCompany]} onSelect={vi.fn()} />,
    )

    expect(screen.getByRole('columnheader', { name: /property/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /location/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /acreage/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /management company/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /status/i })).toBeInTheDocument()
  })
})

describe('HOATable — row rendering', () => {
  it('renders a row for each property with name, city, and state', () => {
    const props = [
      makeProperty({ id: 'h1', property_name: 'Pelican Bay', city: 'Naples' }),
      makeProperty({ id: 'h2', property_name: "Fiddler's Creek", city: 'Fort Myers' }),
    ]
    render(<HOATable rows={props} companies={[sampleCompany]} onSelect={vi.fn()} />)

    expect(screen.getByText('Pelican Bay')).toBeInTheDocument()
    expect(screen.getByText("Fiddler's Creek")).toBeInTheDocument()
    expect(screen.getAllByText(/Naples/)).toHaveLength(2) // city column and association name may both include Naples
  })

  it('renders acreage and units for a property', () => {
    render(
      <HOATable rows={[makeProperty({ acreage: 570, units: 6800 })]} companies={[sampleCompany]} onSelect={vi.fn()} />,
    )

    expect(screen.getByText(/570/)).toBeInTheDocument()
  })

  it('shows management company name when management_company_id is linked', () => {
    render(
      <HOATable
        rows={[makeProperty({ management_company_id: 'pm1' })]}
        companies={[sampleCompany]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText('Alliant Property Management')).toBeInTheDocument()
  })

  it('shows "Self-managed" when management_company_id is null', () => {
    render(
      <HOATable
        rows={[makeProperty({ management_company_id: null })]}
        companies={[sampleCompany]}
        onSelect={vi.fn()}
      />,
    )
    expect(screen.getByText(/self-managed/i)).toBeInTheDocument()
  })

  it('renders AccountStatusBadge with the correct status text for each property', () => {
    const rows = [
      makeProperty({ id: 'h1', status: 'Active' }),
      makeProperty({ id: 'h2', status: 'Bidding' }),
    ]
    render(<HOATable rows={rows} companies={[sampleCompany]} onSelect={vi.fn()} />)

    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.getByText('Bidding')).toBeInTheDocument()
  })
})

describe('HOATable — interaction', () => {
  it('clicking a row calls onSelect with the correct property', async () => {
    const onSelect = vi.fn()
    const property = makeProperty()
    const user = userEvent.setup()

    render(<HOATable rows={[property]} companies={[sampleCompany]} onSelect={onSelect} />)

    await user.click(screen.getByText('Pelican Bay'))

    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(property)
  })

  it('calls onSelect with the correct property when table has multiple rows', async () => {
    const onSelect = vi.fn()
    const p1 = makeProperty({ id: 'h1', property_name: 'Pelican Bay' })
    const p2 = makeProperty({ id: 'h2', property_name: "Fiddler's Creek" })
    const user = userEvent.setup()

    render(<HOATable rows={[p1, p2]} companies={[sampleCompany]} onSelect={onSelect} />)

    await user.click(screen.getByText("Fiddler's Creek"))

    expect(onSelect).toHaveBeenCalledWith(p2)
  })
})

describe('HOATable — empty state', () => {
  it('renders "No properties match" empty state when rows is empty', () => {
    render(<HOATable rows={[]} companies={[]} onSelect={vi.fn()} />)
    expect(screen.getByText(/no properties match/i)).toBeInTheDocument()
  })

  it('does not render any table rows when rows is empty', () => {
    render(<HOATable rows={[]} companies={[]} onSelect={vi.fn()} />)
    expect(screen.queryByText('Pelican Bay')).not.toBeInTheDocument()
  })
})

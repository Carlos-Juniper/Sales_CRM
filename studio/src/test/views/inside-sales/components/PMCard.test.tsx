import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '@/test/utils'
import { PMCard } from '@/views/inside-sales/components/accounts/PMCard'
import type { HOAProperty, ManagementCompany } from '@/types/accounts'

// ── Fixtures ──────────────────────────────────────────────────────

const sampleContacts = [
  { id: 'c1', name: 'Dana Whitfield', title: 'Community Association Manager', email: 'dwhitfield@alliantproperty.com', phone: '(239) 454-1108' },
  { id: 'c2', name: 'Marcus Reyes', title: 'Director of Operations', email: 'mreyes@alliantproperty.com', phone: '(239) 454-1112' },
]

function makeCompany(overrides: Partial<ManagementCompany> = {}): ManagementCompany {
  return {
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
    contacts: sampleContacts,
    ...overrides,
  }
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

const sampleProperties = [
  makeProperty({ id: 'h1', property_name: 'Pelican Bay' }),
  makeProperty({ id: 'h2', property_name: "Fiddler's Creek" }),
]

// ── Tests ─────────────────────────────────────────────────────────

describe('PMCard — collapsed state (default)', () => {
  it('renders company name in the card header', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={false}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Alliant Property Management')).toBeInTheDocument()
  })

  it('does not show contact names when collapsed', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={false}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.queryByText('Dana Whitfield')).not.toBeInTheDocument()
    expect(screen.queryByText('Marcus Reyes')).not.toBeInTheDocument()
  })

  it('does not show managed property names when collapsed', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={false}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.queryByText('Pelican Bay')).not.toBeInTheDocument()
    expect(screen.queryByText("Fiddler's Creek")).not.toBeInTheDocument()
  })
})

describe('PMCard — header click', () => {
  it('clicking the card header calls onToggle', async () => {
    const onToggle = vi.fn()
    const user = userEvent.setup()
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={false}
        onToggle={onToggle}
        onSelectProperty={vi.fn()}
      />,
    )

    await user.click(screen.getByText('Alliant Property Management'))

    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('PMCard — expanded state', () => {
  it('renders each contact name when expanded=true', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={true}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Dana Whitfield')).toBeInTheDocument()
    expect(screen.getByText('Marcus Reyes')).toBeInTheDocument()
  })

  it('renders each contact title when expanded=true', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={true}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Community Association Manager')).toBeInTheDocument()
    expect(screen.getByText('Director of Operations')).toBeInTheDocument()
  })

  it('renders each contact email as a link when expanded=true', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={true}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('dwhitfield@alliantproperty.com')).toBeInTheDocument()
    expect(screen.getByText('mreyes@alliantproperty.com')).toBeInTheDocument()
  })

  it('renders managed property names when expanded=true', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={sampleProperties}
        expanded={true}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Pelican Bay')).toBeInTheDocument()
    expect(screen.getByText("Fiddler's Creek")).toBeInTheDocument()
  })

  it('shows "No additional contacts on file" when contacts array is empty and expanded', () => {
    render(
      <PMCard
        company={makeCompany({ contacts: [] })}
        properties={sampleProperties}
        expanded={true}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText(/no additional contacts on file/i)).toBeInTheDocument()
  })

  it('shows "No properties linked yet" when properties array is empty and expanded', () => {
    render(
      <PMCard
        company={makeCompany()}
        properties={[]}
        expanded={true}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText(/no properties linked yet/i)).toBeInTheDocument()
  })
})

describe('PMCard — property selection', () => {
  it('clicking a property in the expanded body calls onSelectProperty with the property', async () => {
    const onSelectProperty = vi.fn()
    const user = userEvent.setup()
    const p1 = makeProperty({ id: 'h1', property_name: 'Pelican Bay' })
    const p2 = makeProperty({ id: 'h2', property_name: "Fiddler's Creek" })

    render(
      <PMCard
        company={makeCompany()}
        properties={[p1, p2]}
        expanded={true}
        onToggle={vi.fn()}
        onSelectProperty={onSelectProperty}
      />,
    )

    await user.click(screen.getByText("Fiddler's Creek"))

    expect(onSelectProperty).toHaveBeenCalledTimes(1)
    expect(onSelectProperty).toHaveBeenCalledWith(p2)
  })
})

describe('PMCard — PMStatusBadge', () => {
  it('renders PMStatusBadge with "Partner" status', () => {
    render(
      <PMCard
        company={makeCompany({ status: 'Partner' })}
        properties={[]}
        expanded={false}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Partner')).toBeInTheDocument()
  })

  it('renders PMStatusBadge with "Engaged" status', () => {
    render(
      <PMCard
        company={makeCompany({ status: 'Engaged' })}
        properties={[]}
        expanded={false}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Engaged')).toBeInTheDocument()
  })

  it('renders PMStatusBadge with "Target" status', () => {
    render(
      <PMCard
        company={makeCompany({ status: 'Target' })}
        properties={[]}
        expanded={false}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Target')).toBeInTheDocument()
  })

  it('renders PMStatusBadge with "Inactive" status', () => {
    render(
      <PMCard
        company={makeCompany({ status: 'Inactive' })}
        properties={[]}
        expanded={false}
        onToggle={vi.fn()}
        onSelectProperty={vi.fn()}
      />,
    )
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })
})

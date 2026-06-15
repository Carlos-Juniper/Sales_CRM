export type HOAStatus = 'Prospect' | 'Bidding' | 'Active' | 'At Risk' | 'Lost'
export type PMStatus = 'Partner' | 'Engaged' | 'Target' | 'Inactive'
export type ContactStatus = 'uncontacted' | 'contacted'
export type AccountTab = 'hoa' | 'pm'

export interface PMContact {
  id: string
  name: string
  title: string | null
  email: string | null
  phone: string | null
}

export interface HOAProperty {
  id: string
  property_name: string
  association_name: string | null
  address: string
  city: string
  state: string
  zip: string
  county: string | null
  acreage: number | null
  units: number | null
  status: HOAStatus
  contact_status: ContactStatus
  branch: string | null
  assigned_to: string | null
  last_contacted: string | null
  management_company_id: string | null
}

export interface ManagementCompany {
  id: string
  company_name: string
  website: string | null
  phone: string | null
  street: string | null
  city: string | null
  state: string | null
  zip: string | null
  primary_email: string | null
  branch_id: string | null
  assigned_to: string | null
  status: PMStatus
  contact_status: ContactStatus
  last_contacted: string | null
  contacts: PMContact[]
  created_at?: string
  updated_at?: string
}

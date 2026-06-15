import { useRef, useState } from 'react'
import { SlideOverPanel } from '@/components/shared/SlideOverPanel'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/TextField'
import { Plus, Trash2 } from 'lucide-react'
import type { CreateManagementCompanyPayload } from '@/api/managementCompanies'

interface ContactRow {
  key: number
  name: string
  title: string
  email: string
  phone: string
}

interface AddPMPanelProps {
  isOpen: boolean
  onClose: () => void
  onSave: (body: CreateManagementCompanyPayload) => Promise<void>
}

interface CompanyForm {
  company_name: string
  website: string
  phone: string
  street: string
  city: string
  state: string
  zip: string
  primary_email: string
}

const INITIAL_FORM: CompanyForm = {
  company_name: '',
  website: '',
  phone: '',
  street: '',
  city: '',
  state: 'FL',
  zip: '',
  primary_email: '',
}

export function AddPMPanel({ isOpen, onClose, onSave }: AddPMPanelProps) {
  const nextKeyRef = useRef(1)

  function makeContact(): ContactRow {
    return { key: nextKeyRef.current++, name: '', title: '', email: '', phone: '' }
  }

  const [form, setForm] = useState<CompanyForm>(INITIAL_FORM)
  const [contacts, setContacts] = useState<ContactRow[]>([makeContact()])
  const [saving, setSaving] = useState(false)

  const isValid = form.company_name.trim().length > 0

  function setField(key: keyof CompanyForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }))
  }

  function setContactField(idx: number, key: keyof Omit<ContactRow, 'key'>) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setContacts((prev) =>
        prev.map((c, i) => (i === idx ? { ...c, [key]: e.target.value } : c))
      )
  }

  function addContact() {
    setContacts((prev) => [...prev, makeContact()])
  }

  function removeContact(idx: number) {
    setContacts((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit() {
    if (!isValid) return
    setSaving(true)
    try {
      // Filter out contacts where both name AND email are empty
      const filteredContacts = contacts
        .filter((c) => c.name.trim() || c.email.trim())
        .map((c) => ({
          id: String(c.key),
          name: c.name.trim(),
          title: c.title.trim() || null,
          email: c.email.trim() || null,
          phone: c.phone.trim() || null,
        }))

      await onSave({
        company_name: form.company_name.trim(),
        website: form.website.trim() || null,
        phone: form.phone.trim() || null,
        street: form.street.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        zip: form.zip.trim() || null,
        primary_email: form.primary_email.trim() || null,
        contacts: filteredContacts,
      })
      setForm(INITIAL_FORM)
      setContacts([makeContact()])
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOverPanel isOpen={isOpen} onClose={onClose} title="Add management company">
      <div className="p-5 space-y-5">
        {/* Company details */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            Company
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <TextField
                label="Company name"
                required
                type="text"
                value={form.company_name}
                onChange={setField('company_name')}
                placeholder="Alliant Property Management"
              />
            </div>

            <TextField
              label="Website"
              type="text"
              value={form.website}
              onChange={setField('website')}
              placeholder="www.alliantproperty.com"
            />

            <TextField
              label="Phone"
              type="text"
              value={form.phone}
              onChange={setField('phone')}
              placeholder="(239) 454-1101"
            />
          </div>
        </section>

        {/* Mailing address */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            Mailing address
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <TextField
                label="Street address"
                type="text"
                value={form.street}
                onChange={setField('street')}
                placeholder="13831 Vector Ave"
              />
            </div>

            <TextField
              label="City"
              type="text"
              value={form.city}
              onChange={setField('city')}
              placeholder="Fort Myers"
            />

            <TextField
              label="State"
              type="text"
              value={form.state}
              onChange={setField('state')}
              placeholder="FL"
            />

            <div className="col-span-2">
              <TextField
                label="ZIP"
                type="text"
                value={form.zip}
                onChange={setField('zip')}
                placeholder="33907"
              />
            </div>
          </div>
        </section>

        {/* Primary email */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            Primary contact email
          </p>

          <TextField
            label="Email"
            type="email"
            value={form.primary_email}
            onChange={setField('primary_email')}
            placeholder="service@alliantproperty.com"
          />
        </section>

        {/* Additional contacts */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
              Additional contacts
            </p>
            <span className="text-[10px] text-[hsl(var(--muted-fg))]">
              {contacts.length} {contacts.length === 1 ? 'contact' : 'contacts'}
            </span>
          </div>

          <div className="space-y-2.5">
            {contacts.map((contact, idx) => (
              <div
                key={contact.key}
                className="border border-[hsl(var(--border))] rounded-lg p-3 bg-[hsl(var(--muted))]/30"
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
                    Contact {idx + 1}
                  </span>
                  {contacts.length > 1 && (
                    <button
                      type="button"
                      aria-label="Remove contact"
                      onClick={() => removeContact(idx)}
                      className="flex items-center gap-1 text-[hsl(var(--muted-fg))] hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2">
                    <TextField
                      label="Contact name"
                      type="text"
                      value={contact.name}
                      onChange={setContactField(idx, 'name')}
                      placeholder="Dana Whitfield"
                    />
                  </div>

                  <div className="col-span-2">
                    <TextField
                      label="Title"
                      type="text"
                      value={contact.title}
                      onChange={setContactField(idx, 'title')}
                      placeholder="Community Association Manager"
                    />
                  </div>

                  <TextField
                    label="Email"
                    type="email"
                    value={contact.email}
                    onChange={setContactField(idx, 'email')}
                    placeholder="dwhitfield@…"
                  />

                  <TextField
                    label="Phone"
                    type="text"
                    value={contact.phone}
                    onChange={setContactField(idx, 'phone')}
                    placeholder="(239) 454-1108"
                  />
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addContact}
            className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg border border-dashed border-[hsl(var(--border))] text-xs font-semibold text-[#2E7D52] hover:border-[#2E7D52] hover:bg-[#2E7D52]/5 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add contact
          </button>
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-[hsl(var(--border))] px-5 py-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} type="button">
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!isValid || saving}
          onClick={handleSubmit}
          type="button"
          className="ml-auto"
        >
          Create company
        </Button>
      </div>
    </SlideOverPanel>
  )
}

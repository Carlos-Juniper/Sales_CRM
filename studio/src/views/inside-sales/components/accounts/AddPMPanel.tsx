import { useRef, useState } from 'react'
import { SlideOverPanel } from '@/components/shared/SlideOverPanel'
import { Button } from '@/components/ui/button'
import { TextField } from '@/components/ui/TextField'
import { Plus, Trash2 } from 'lucide-react'
import type { ManagementCompany } from '@/types/accounts'
import type { CreateManagementCompanyPayload, PatchManagementCompanyPayload } from '@/api/managementCompanies'

interface ContactRow {
  key: number
  name: string
  title: string
  email: string
  phone: string
}

interface ContactDraftRow {
  id?: string     // undefined = new contact (no id yet)
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
  /** Present in edit mode — pre-fills company fields and enables editable contacts */
  initialValues?: ManagementCompany
  onUpdate?: (body: PatchManagementCompanyPayload) => Promise<void>
  onAddContact?: (body: { name: string; title?: string | null; email?: string | null; phone?: string | null }) => Promise<void>
  onUpdateContact?: (contactId: string, body: { name?: string; title?: string | null; email?: string | null; phone?: string | null }) => Promise<void>
  onDeleteContact?: (contactId: string) => Promise<void>
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

function formFromCompany(co: ManagementCompany): CompanyForm {
  return {
    company_name: co.company_name,
    website: co.website ?? '',
    phone: co.phone ?? '',
    street: co.street ?? '',
    city: co.city ?? '',
    state: co.state ?? 'FL',
    zip: co.zip ?? '',
    primary_email: co.primary_email ?? '',
  }
}

export function AddPMPanel({ isOpen, onClose, onSave, initialValues, onUpdate, onAddContact, onUpdateContact, onDeleteContact }: AddPMPanelProps) {
  const nextKeyRef = useRef(1)
  const isEditMode = initialValues !== undefined

  function makeContact(): ContactRow {
    return { key: nextKeyRef.current++, name: '', title: '', email: '', phone: '' }
  }

  function draftFromInitial(co: ManagementCompany): ContactDraftRow[] {
    return co.contacts.map((c) => ({
      id: c.id,
      key: nextKeyRef.current++,
      name: c.name,
      title: c.title ?? '',
      email: c.email ?? '',
      phone: c.phone ?? '',
    }))
  }

  const [form, setForm] = useState<CompanyForm>(() =>
    isEditMode ? formFromCompany(initialValues) : INITIAL_FORM
  )
  const [contacts, setContacts] = useState<ContactRow[]>([makeContact()])
  // Edit-mode contact drafts — kept separate so create-mode ContactRow type is unchanged
  const [contactDrafts, setContactDrafts] = useState<ContactDraftRow[]>(() =>
    isEditMode ? draftFromInitial(initialValues) : []
  )
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

  // Edit-mode contact draft helpers
  function setContactDraftField(idx: number, key: keyof Omit<ContactDraftRow, 'key' | 'id'>) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setContactDrafts((prev) =>
        prev.map((c, i) => (i === idx ? { ...c, [key]: e.target.value } : c))
      )
  }

  function addContactDraft() {
    setContactDrafts((prev) => [...prev, { key: nextKeyRef.current++, name: '', title: '', email: '', phone: '' }])
  }

  function removeContactDraft(idx: number) {
    setContactDrafts((prev) => prev.filter((_, i) => i !== idx))
  }

  function handleClose() {
    setForm(isEditMode ? formFromCompany(initialValues) : INITIAL_FORM)
    if (isEditMode) {
      setContactDrafts(draftFromInitial(initialValues))
    } else {
      setContacts([makeContact()])
    }
    onClose()
  }

  async function handleSubmit() {
    if (!isValid) return
    setSaving(true)
    try {
      if (isEditMode && onUpdate) {
        await onUpdate({
          company_name: form.company_name.trim(),
          website: form.website.trim() || null,
          phone: form.phone.trim() || null,
          street: form.street.trim() || null,
          city: form.city.trim() || null,
          state: form.state.trim() || null,
          zip: form.zip.trim() || null,
          primary_email: form.primary_email.trim() || null,
        })

        // Reconcile contacts against initialValues
        const originalById = new Map(initialValues.contacts.map((c) => [c.id, c]))
        const draftIdSet = new Set(contactDrafts.filter((d) => d.id).map((d) => d.id!))

        const mutations: Promise<void>[] = []

        // Deleted contacts: were in initialValues but are no longer in drafts
        if (onDeleteContact) {
          for (const original of initialValues.contacts) {
            if (!draftIdSet.has(original.id)) {
              mutations.push(onDeleteContact(original.id))
            }
          }
        }

        for (const draft of contactDrafts) {
          if (draft.id) {
            // Existing contact — check for changes
            const original = originalById.get(draft.id)
            if (original && onUpdateContact) {
              const changed: Record<string, string | null> = {}
              if (draft.name.trim() !== original.name) changed.name = draft.name.trim()
              if ((draft.title.trim() || null) !== (original.title ?? null)) changed.title = draft.title.trim() || null
              if ((draft.email.trim() || null) !== (original.email ?? null)) changed.email = draft.email.trim() || null
              if ((draft.phone.trim() || null) !== (original.phone ?? null)) changed.phone = draft.phone.trim() || null
              if (Object.keys(changed).length > 0) {
                mutations.push(onUpdateContact(draft.id, changed))
              }
            }
          } else {
            // New contact — only add if has name or email
            if ((draft.name.trim() || draft.email.trim()) && onAddContact) {
              mutations.push(
                onAddContact({
                  name: draft.name.trim(),
                  title: draft.title.trim() || null,
                  email: draft.email.trim() || null,
                  phone: draft.phone.trim() || null,
                })
              )
            }
          }
        }

        await Promise.all(mutations)
      } else {
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
      }
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOverPanel isOpen={isOpen} onClose={handleClose} title={isEditMode ? 'Edit management company' : 'Add management company'}>
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

        {/* Contacts — editable in both create and edit mode */}
        <section className="space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
            {isEditMode ? 'Contacts' : 'Additional contacts'}
          </p>

          {isEditMode ? (
            // Edit mode: editable contact draft rows
            <>
              {contactDrafts.length === 0 ? (
                <p className="text-xs text-[hsl(var(--muted-fg))]">No contacts on file.</p>
              ) : (
                <div className="space-y-2.5">
                  {contactDrafts.map((contact, idx) => (
                    <div
                      key={contact.key}
                      className="border border-[hsl(var(--border))] rounded-lg p-3 bg-[hsl(var(--muted))]/30"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-fg))]">
                          Contact {idx + 1}
                        </span>
                        <button
                          type="button"
                          aria-label="Remove contact"
                          onClick={() => removeContactDraft(idx)}
                          className="flex items-center gap-1 text-[hsl(var(--muted-fg))] hover:text-red-600 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div className="col-span-2">
                          <TextField
                            label="Contact name"
                            type="text"
                            value={contact.name}
                            onChange={setContactDraftField(idx, 'name')}
                            placeholder="Dana Whitfield"
                          />
                        </div>

                        <div className="col-span-2">
                          <TextField
                            label="Title"
                            type="text"
                            value={contact.title}
                            onChange={setContactDraftField(idx, 'title')}
                            placeholder="Community Association Manager"
                          />
                        </div>

                        <TextField
                          label="Email"
                          type="email"
                          value={contact.email}
                          onChange={setContactDraftField(idx, 'email')}
                          placeholder="dwhitfield@…"
                        />

                        <TextField
                          label="Phone"
                          type="text"
                          value={contact.phone}
                          onChange={setContactDraftField(idx, 'phone')}
                          placeholder="(239) 454-1108"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={addContactDraft}
                className="flex items-center justify-center gap-1.5 w-full h-9 rounded-lg border border-dashed border-[hsl(var(--border))] text-xs font-semibold text-[#2E7D52] hover:border-[#2E7D52] hover:bg-[#2E7D52]/5 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" />
                Add contact
              </button>
            </>
          ) : (
            // Create mode: editable contact rows
            <>
              <div className="flex items-center justify-end">
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
            </>
          )}
        </section>
      </div>

      {/* Footer */}
      <div className="border-t border-[hsl(var(--border))] px-5 py-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={handleClose} type="button">
          Cancel
        </Button>
        <Button
          size="sm"
          disabled={!isValid || saving}
          onClick={handleSubmit}
          type="button"
          className="ml-auto"
        >
          {isEditMode ? 'Save changes' : 'Create company'}
        </Button>
      </div>
    </SlideOverPanel>
  )
}

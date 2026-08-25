import { useEffect, useMemo, useState } from 'react'
import { Printer, FileText, Leaf, Phone, Mail, MapPin, Check } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { estimatingApi } from '@/api/estimating'
import { formatCurrency, formatDate } from '@/lib/utils'
import { COMPANY_INFO } from '@/lib/constants'
import { useAuthStore } from '@/store/authStore'
import type { Estimate } from '@/types/estimating'
import { acresFromSqft } from '@/lib/estimating/calc'

const DEFAULT_TERMS = `1. Scope of Work: Services shall be performed as described above on the agreed schedule. Additional services not listed require a written change order.

2. Payment Terms: Invoices issued monthly. Payment due within 30 days. A 1.5% monthly finance charge applies to past-due balances.

3. Term: This proposal is valid for 30 days from the date above. Contract term is 12 months with 30-day written termination notice.

4. Insurance: Juniper Landscaping maintains General Liability ($2M per occurrence) and Workers' Compensation insurance. Certificates available upon request.

5. Warranty: We guarantee satisfaction with all services. If you are not satisfied, contact us within 48 hours and we will re-perform at no charge.`

interface Props {
  /** Pre-select a specific estimate by ID; falls back to the first in the list. */
  estimateId?: string | null
}

const ROLE_LABELS: Record<string, string> = {
  inside_sales: 'Inside Sales',
  outside_sales: 'Outside Sales',
  manager: 'Manager',
}

function estimateAcres(e: Estimate): number {
  if (e.acreage !== null) return e.acreage
  return acresFromSqft(e.sections.reduce((sum, s) => sum + s.squareFeet, 0))
}

export function ProposalExport({ estimateId }: Props) {
  const user = useAuthStore((s) => s.user)

  const [estimates, setEstimates] = useState<Estimate[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>(estimateId ?? '')

  useEffect(() => {
    let alive = true
    setLoading(true)
    estimatingApi
      .list()
      .then((list) => {
        if (!alive) return
        setEstimates(list)
        if (!selectedId && list.length > 0) setSelectedId(estimateId ?? list[0].id)
      })
      .catch(() => {
        if (alive) setEstimates([])
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const estimate = useMemo(() => {
    if (selectedId) return estimates.find((e) => e.id === selectedId) ?? estimates[0]
    return estimates[0]
  }, [estimates, selectedId])

  const [clientName, setClientName] = useState(estimate?.name ?? '')
  const [clientContact, setClientContact] = useState('')
  const [clientEmail, setClientEmail] = useState('')
  const [proposalDate, setProposalDate] = useState(new Date().toISOString().split('T')[0])
  const [validUntil, setValidUntil] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().split('T')[0]
  })
  const [terms, setTerms] = useState(DEFAULT_TERMS)
  const [showPreview, setShowPreview] = useState(false)

  // Sync clientName when estimate changes
  useEffect(() => {
    if (estimate) setClientName(estimate.name)
  }, [estimate])

  if (loading) {
    return <div className="py-8 text-center text-xs text-[hsl(var(--muted-fg))]">Loading estimates…</div>
  }

  if (!estimate) {
    return <div className="py-8 text-center text-[hsl(var(--muted-fg))]">No estimates available.</div>
  }

  const totalPrice = estimate.contractValueCents / 100
  const acres = estimateAcres(estimate)

  function handlePrint() {
    window.print()
  }

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <Select value={estimate.id} onValueChange={setSelectedId}>
          <SelectTrigger className="w-56 h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {estimates.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2 ml-auto">
          <Button variant="outline" size="sm" onClick={() => setShowPreview(!showPreview)} className="text-xs gap-1">
            <FileText className="h-3.5 w-3.5" />
            {showPreview ? 'Edit Details' : 'Preview'}
          </Button>
          <Button size="sm" onClick={handlePrint} className="text-xs gap-1">
            <Printer className="h-3.5 w-3.5" />
            Generate PDF
          </Button>
        </div>
      </div>

      {!showPreview ? (
        /* Edit form */
        <Card className="no-print">
          <CardHeader className="pb-2 pt-4">
            <CardTitle className="text-sm">Proposal Details</CardTitle>
          </CardHeader>
          <CardContent className="pb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Client / Property Name</Label>
                <Input value={clientName} onChange={(e) => setClientName(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contact Name</Label>
                <Input value={clientContact} onChange={(e) => setClientContact(e.target.value)} className="h-8 text-xs" placeholder="e.g. Jennifer Walsh" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Contact Email</Label>
                <Input type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Proposal Date</Label>
                <Input type="date" value={proposalDate} onChange={(e) => setProposalDate(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Valid Until</Label>
                <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} className="h-8 text-xs" />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">Terms & Conditions</Label>
                <Textarea value={terms} onChange={(e) => setTerms(e.target.value)} rows={16} className="text-xs font-mono" />
              </div>
            </div>
            <Button size="sm" onClick={() => setShowPreview(true)} className="text-xs gap-1">
              <Check className="h-3.5 w-3.5" /> Preview Proposal
            </Button>
          </CardContent>
        </Card>
      ) : (
        /* Proposal preview (print-optimized) */
        <div id="proposal-preview" className="bg-white dark:bg-white text-black font-sans text-sm rounded-xl border border-[hsl(var(--border))] overflow-hidden print:border-0 print:rounded-none print:shadow-none">
          {/* Letterhead */}
          <div className="bg-[#2E7D52] text-white px-8 py-6 print:py-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl bg-white/20 flex items-center justify-center">
                  <Leaf className="h-6 w-6 text-white" />
                </div>
                <div>
                  <p className="text-xl font-bold tracking-tight">{COMPANY_INFO.name}</p>
                  <p className="text-xs text-green-200">{COMPANY_INFO.tagline}</p>
                </div>
              </div>
              <div className="text-right text-xs text-green-100 space-y-0.5 hidden sm:block">
                <div className="flex items-center justify-end gap-1"><Phone className="h-3 w-3" /> {COMPANY_INFO.phone}</div>
                <div className="flex items-center justify-end gap-1"><Mail className="h-3 w-3" /> {COMPANY_INFO.email}</div>
                <div className="flex items-center justify-end gap-1"><MapPin className="h-3 w-3" /> {COMPANY_INFO.address}</div>
              </div>
            </div>
          </div>

          <div className="px-8 py-6 space-y-6">
            {/* Proposal header */}
            <div className="flex flex-wrap justify-between gap-4 pb-4 border-b border-gray-200">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Proposal Submitted To</p>
                <p className="text-base font-bold text-black mt-0.5">{clientName || estimate.name}</p>
                {clientContact && <p className="text-sm text-gray-600">{clientContact}</p>}
                {clientEmail && <p className="text-sm text-gray-500">{clientEmail}</p>}
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 uppercase tracking-wide font-medium">Proposal</p>
                <p className="text-base font-bold text-black mt-0.5">#{estimate.id.slice(0, 8).toUpperCase()}</p>
                <p className="text-xs text-gray-500 mt-0.5">Date: {proposalDate}</p>
                <p className="text-xs text-gray-500">Valid until: {validUntil}</p>
              </div>
            </div>

            {/* Property overview */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Property Overview</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <div><span className="text-gray-500">Acreage:</span> <span className="font-medium">{acres.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} acres</span></div>
                <div><span className="text-gray-500">Type:</span> <span className="font-medium capitalize">{estimate.estimateType}</span></div>
                {estimate.siteWalkDate && (
                  <div><span className="text-gray-500">Site Walk:</span> <span className="font-medium">{formatDate(estimate.siteWalkDate)}</span></div>
                )}
              </div>
              {estimate.notes && (
                <p className="mt-2 text-xs text-gray-600 italic">{estimate.notes}</p>
              )}
            </div>

            {/* Services by section */}
            {estimate.sections.filter((s) => s.services.length > 0).map((section) => (
              <div key={section.id}>
                <p className="text-xs font-bold uppercase tracking-wide text-[#2E7D52] mb-2">{section.name}</p>
                <table className="w-full text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-1.5 text-gray-500 font-medium">Service Description</th>
                      <th className="text-right py-1.5 text-gray-500 font-medium w-20">Qty</th>
                      <th className="text-right py-1.5 text-gray-500 font-medium w-16">Unit</th>
                      <th className="text-right py-1.5 text-gray-500 font-medium w-24">Unit Price</th>
                      <th className="text-right py-1.5 text-gray-500 font-medium w-24">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {section.services.map((svc) => {
                      const unitPrice = svc.unitSellCents != null ? svc.unitSellCents / 100 : null
                      const lineTotal = unitPrice != null ? svc.qty * unitPrice : null
                      return (
                        <tr key={svc.id} className="border-b border-gray-100">
                          <td className="py-1.5 text-gray-800">{svc.label}</td>
                          <td className="py-1.5 text-right text-gray-600">{svc.qty}</td>
                          <td className="py-1.5 text-right text-gray-600">{svc.uom}</td>
                          <td className="py-1.5 text-right text-gray-600">{unitPrice != null ? formatCurrency(unitPrice) : '—'}</td>
                          <td className="py-1.5 text-right font-medium text-gray-800">{lineTotal != null ? formatCurrency(lineTotal) : '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}

            {/* Pricing summary */}
            <div className="flex justify-end">
              <div className="w-64 space-y-1.5 text-sm">
                <div className="flex justify-between text-gray-600">
                  <span>Subtotal</span>
                  <span>{formatCurrency(totalPrice)}</span>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Tax</span>
                  <span>$0.00</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t border-gray-300 pt-1.5 text-black">
                  <span>Annual Contract Total</span>
                  <span className="text-[#2E7D52]">{formatCurrency(totalPrice)}</span>
                </div>
                <p className="text-[10px] text-gray-500">
                  Billed monthly at {formatCurrency(totalPrice / 12)}/month
                </p>
              </div>
            </div>

            {/* Terms */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">Terms & Conditions</p>
              <div className="text-xs text-gray-600 space-y-1 whitespace-pre-line">{terms}</div>
            </div>

            {/* Signature block */}
            <div className="grid grid-cols-2 gap-8 mt-6 pt-6 border-t border-gray-200">
              <div>
                <p className="text-xs text-gray-500 mb-8">Client Signature</p>
                <div className="border-b border-gray-400 h-px" />
                <p className="text-xs text-gray-500 mt-1">{clientContact || 'Authorized Representative'}</p>
                <p className="text-xs text-gray-400">Date: _____________</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-8">Juniper Landscaping</p>
                <div className="border-b border-gray-400 h-px" />
                <p className="text-xs text-gray-500 mt-1">{user?.name}, {ROLE_LABELS[user?.role ?? ''] ?? ''}</p>
                <p className="text-xs text-gray-400">Date: {proposalDate}</p>
              </div>
            </div>

            <p className="text-[10px] text-gray-400 text-center mt-4">
              {COMPANY_INFO.name} · {COMPANY_INFO.address} · {COMPANY_INFO.phone} · {COMPANY_INFO.email} · {COMPANY_INFO.website}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

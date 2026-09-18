import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableRowSkeleton } from '@/components/shared/LoadingSkeleton'
import { useMarkCommissionPaid } from '@/hooks/useCommissions'
import { formatCents } from '@/lib/estimating/maintenance'
import { formatRate, formatPaymentPeriod, formatContractNumber } from '@/lib/commissions'
import type { Commission, CommissionFilters } from '@/types/commissions'

interface CommissionDetailTableProps {
  commissions: Commission[]
  isLoading: boolean
  filters: CommissionFilters
  onFiltersChange: (filters: CommissionFilters) => void
  isAdmin: boolean
}

type SortField = 'created_at' | 'commission_amount_cents' | 'property_name'
type SortDirection = 'asc' | 'desc'

const STATUS_BADGE: Record<Commission['status'], { label: string; className: string }> = {
  approved: { label: 'Approved', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  paid:     { label: 'Paid',     className: 'bg-green-50 text-green-700 border-green-200' },
  cancelled:{ label: 'Cancelled',className: 'bg-gray-50 text-gray-700 border-gray-200' },
}

export function CommissionDetailTable({
  commissions,
  isLoading,
  filters,
  onFiltersChange,
  isAdmin,
}: CommissionDetailTableProps) {
  const [sortField, setSortField] = useState<SortField>('created_at')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const markPaid = useMarkCommissionPaid()

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const sortedCommissions = [...commissions].sort((a, b) => {
    const dir = sortDirection === 'asc' ? 1 : -1
    switch (sortField) {
      case 'created_at':
        return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      case 'commission_amount_cents':
        return dir * (a.commission_amount_cents - b.commission_amount_cents)
      case 'property_name':
        return dir * (a.property_name ?? '').localeCompare(b.property_name ?? '')
      default:
        return 0
    }
  })

  const handleMarkPaid = (commissionId: string) => {
    markPaid.mutate({ commissionId, paymentPeriod: formatPaymentPeriod(new Date()) })
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc'
      ? <ChevronUp className="h-3.5 w-3.5 inline ml-1" />
      : <ChevronDown className="h-3.5 w-3.5 inline ml-1" />
  }

  const colCount = isAdmin ? 8 : 7

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 px-4 py-3 border-b bg-[hsl(var(--muted))]">
        <Select
          value={filters.status ?? 'all'}
          onValueChange={(value) =>
            onFiltersChange({ ...filters, status: value === 'all' ? undefined : value as Commission['status'] })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.estimate_type ?? 'all'}
          onValueChange={(value) =>
            onFiltersChange({
              ...filters,
              estimate_type: value === 'all' ? undefined : value as CommissionFilters['estimate_type'],
            })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="maintenance">Maintenance</SelectItem>
            <SelectItem value="install">Install</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[hsl(var(--border))] bg-[hsl(var(--muted))]">
              <th
                className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))] cursor-pointer select-none whitespace-nowrap"
                onClick={() => handleSort('created_at')}
              >
                Date <SortIcon field="created_at" />
              </th>
              <th
                className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))] cursor-pointer select-none"
                onClick={() => handleSort('property_name')}
              >
                Property <SortIcon field="property_name" />
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))] whitespace-nowrap">Contract #</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))] whitespace-nowrap">Contract Value</th>
              <th className="text-right px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Rate</th>
              <th
                className="text-right px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))] cursor-pointer select-none"
                onClick={() => handleSort('commission_amount_cents')}
              >
                Commission <SortIcon field="commission_amount_cents" />
              </th>
              <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Status</th>
              {isAdmin && (
                <th className="text-right px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Actions</th>
              )}
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 5 }).map((_, i) => (
              <TableRowSkeleton key={i} cols={colCount} />
            ))}

            {!isLoading && sortedCommissions.length === 0 && (
              <tr>
                <td colSpan={colCount} className="py-12 text-center text-sm text-[hsl(var(--muted-fg))]">
                  No commissions found
                </td>
              </tr>
            )}

            {!isLoading && sortedCommissions.map((commission) => {
              const badge = STATUS_BADGE[commission.status]
              return (
                <tr
                  key={commission.id}
                  className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--muted))] transition-colors"
                >
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {new Date(commission.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </td>
                  <td className="px-4 py-3 text-xs">{commission.property_name}</td>
                  <td className="px-4 py-3 font-mono text-xs">{formatContractNumber(commission.aspire_number, commission.estimate_number)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{formatCents(commission.contract_value_cents)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs">{formatRate(commission.commission_rate)}</td>
                  <td className="px-4 py-3 text-right font-mono text-xs font-semibold">{formatCents(commission.commission_amount_cents)}</td>
                  <td className="px-4 py-3">
                    <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                  </td>
                  {isAdmin && (
                    <td className="px-4 py-3 text-right">
                      {commission.status === 'approved' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleMarkPaid(commission.id)}
                          disabled={markPaid.isPending}
                          className="gap-1.5 h-7 text-xs"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Mark Paid
                        </Button>
                      )}
                      {commission.status === 'paid' && commission.payment_period && (
                        <span className="text-xs text-[hsl(var(--muted-fg))]">{commission.payment_period}</span>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

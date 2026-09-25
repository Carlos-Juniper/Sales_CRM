import { Fragment, useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TableRowSkeleton } from '@/components/shared/LoadingSkeleton'
import { useMarkCommissionPaid, useMarkInstallmentPaid } from '@/hooks/useCommissions'
import { formatCents } from '@/lib/estimating/maintenance'
import { formatRate, formatPaymentPeriod, formatContractNumber, payoutAmountLabel, payoutGroupLabel } from '@/lib/commissions'
import type { Commission, CommissionEstimateType, CommissionFilters, CommissionInstallment } from '@/types/commissions'
import { InstallmentStatusBadge } from './InstallmentStatusBadge'

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
  approved: { label: 'Approved', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' },
  paid:     { label: 'Paid',     className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-300 dark:border-green-800' },
  cancelled:{ label: 'Cancelled',className: 'bg-gray-50 text-gray-700 border-gray-200 dark:bg-zinc-800 dark:text-zinc-300 dark:border-zinc-700' },
}

function InstallmentLines({
  installments,
  canMark,
  pendingId,
  onMarkPaid,
}: {
  installments: CommissionInstallment[]
  canMark: boolean
  pendingId: string | undefined
  onMarkPaid: (installmentId: string) => void
}) {
  if (installments.length === 0) {
    return <p className="text-[11px] text-[hsl(var(--muted-fg))]">No installment schedule on this deal</p>
  }

  return (
    <ul className="space-y-1.5" data-testid="commission-installments">
      {installments.map((installment) => {
        const month = payoutGroupLabel(installment)
        const amount = payoutAmountLabel(installment)
        const showAmount = amount !== month
        const canPay = canMark && installment.status !== 'paid' && installment.status !== 'cancelled'
        return (
          <li
            key={installment.id}
            className="flex items-center gap-2 flex-wrap text-xs"
            data-testid={`installment-${installment.id}`}
          >
            <span className="text-[hsl(var(--muted-fg))] w-20">Payment {installment.installment_number}</span>
            <span className="text-[hsl(var(--fg))]">{month}</span>
            {showAmount && <span className="font-mono text-[hsl(var(--fg))]">{amount}</span>}
            <InstallmentStatusBadge status={installment.status} />
            {installment.status === 'pending_billing_data' && installment.billing_installment_number != null && (
              <span className="text-[11px] text-[hsl(var(--muted-fg))]">
                Billing installment {installment.billing_installment_number}
              </span>
            )}
            {installment.collected_amount_cents != null && (
              <span className="text-[11px] text-[hsl(var(--muted-fg))]">
                Collected {formatCents(installment.collected_amount_cents)}
              </span>
            )}
            {canPay && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onMarkPaid(installment.id)}
                disabled={pendingId != null}
                aria-label={`Mark installment ${installment.id} paid`}
                className="gap-1.5 h-7 text-xs"
              >
                <CheckCircle className="h-3.5 w-3.5" />
                Mark paid
              </Button>
            )}
          </li>
        )
      })}
    </ul>
  )
}

const TYPE_BADGE: Record<CommissionEstimateType, { label: string; className: string }> = {
  maintenance: { label: 'Maintenance', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' },
  install: { label: 'Install', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800' },
  enhancement: { label: 'Enhancement', className: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800' },
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
  const [searchQuery, setSearchQuery] = useState('')
  const markPaid = useMarkCommissionPaid()
  const markInstallmentPaid = useMarkInstallmentPaid()

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  const filteredCommissions = commissions.filter((c) =>
    (c.property_name ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  )

  const sortedCommissions = [...filteredCommissions].sort((a, b) => {
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

  const colCount = isAdmin ? 9 : 7

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 px-4 py-3 border-b bg-[hsl(var(--muted))]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-[hsl(var(--muted-fg))]" />
          <Input
            placeholder="Search by property..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9 w-[220px] text-sm"
          />
        </div>

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
            <SelectItem value="enhancement">Enhancement</SelectItem>
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
                <th className="text-left px-4 py-2.5 text-xs font-medium text-[hsl(var(--muted-fg))]">Rep</th>
              )}
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
              const typeBadge = commission.estimate_type ? TYPE_BADGE[commission.estimate_type] : undefined
              const installments = commission.installments ?? []
              const canMarkInstallment = isAdmin && commission.status === 'approved'
              return (
                <Fragment key={commission.id}>
                  <tr
                    className="border-b border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))] transition-colors"
                  >
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {new Date(commission.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          {commission.property_name}
                          {typeBadge && (
                            <Badge variant="outline" className={`${typeBadge.className} text-[10px] px-1.5 py-0 font-medium`}>
                              {typeBadge.label}
                            </Badge>
                          )}
                        </div>
                        {commission.notes && (
                          <p className="text-[11px] text-[hsl(var(--muted-fg))] truncate max-w-[240px] mt-0.5">
                            {commission.notes}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">{formatContractNumber(commission.aspire_number, commission.estimate_number)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatCents(commission.contract_value_cents)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{formatRate(commission.commission_rate)}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs font-semibold">{formatCents(commission.commission_amount_cents)}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={badge.className}>{badge.label}</Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-3">
                        {commission.rep_name && (
                          <span className="inline-flex items-center rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-[11px] font-medium text-[hsl(var(--fg))]">
                            {commission.rep_name}
                          </span>
                        )}
                      </td>
                    )}
                    {isAdmin && (
                      <td className="px-4 py-3 text-right">
                        {commission.status === 'approved' && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleMarkPaid(commission.id)}
                            disabled={markPaid.isPending || markInstallmentPaid.isPending}
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
                  <tr className="border-b border-[hsl(var(--border))] last:border-0">
                    <td colSpan={colCount} className="px-4 py-2 bg-[hsl(var(--muted))]">
                      <InstallmentLines
                        installments={installments}
                        canMark={canMarkInstallment}
                        pendingId={markInstallmentPaid.isPending ? markInstallmentPaid.variables : undefined}
                        onMarkPaid={(installmentId) => markInstallmentPaid.mutate(installmentId)}
                      />
                    </td>
                  </tr>
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

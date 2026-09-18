import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle } from 'lucide-react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/shared/LoadingSkeleton'
import { useMarkCommissionPaid } from '@/hooks/useCommissions'
import { formatCommission, formatRate, formatPaymentPeriod } from '@/lib/commissions'
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
    const direction = sortDirection === 'asc' ? 1 : -1

    switch (sortField) {
      case 'created_at':
        return direction * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      case 'commission_amount_cents':
        return direction * (a.commission_amount_cents - b.commission_amount_cents)
      case 'property_name':
        return direction * (a.property_name ?? '').localeCompare(b.property_name ?? '')
      default:
        return 0
    }
  })

  const handleMarkPaid = (commissionId: string) => {
    const paymentPeriod = formatPaymentPeriod(new Date())
    markPaid.mutate({ commissionId, paymentPeriod })
  }

  const getStatusBadge = (status: Commission['status']) => {
    switch (status) {
      case 'approved':
        return <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">Approved</Badge>
      case 'paid':
        return <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">Paid</Badge>
      case 'cancelled':
        return <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">Cancelled</Badge>
    }
  }

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null
    return sortDirection === 'asc' ? (
      <ChevronUp className="h-4 w-4 inline ml-1" />
    ) : (
      <ChevronDown className="h-4 w-4 inline ml-1" />
    )
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

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
            onFiltersChange({ ...filters, estimate_type: value === 'all' ? undefined : value as Commission['estimate_type'] })
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
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => handleSort('created_at')}
            >
              Date <SortIcon field="created_at" />
            </TableHead>
            <TableHead
              className="cursor-pointer select-none"
              onClick={() => handleSort('property_name')}
            >
              Property <SortIcon field="property_name" />
            </TableHead>
            <TableHead>Contract #</TableHead>
            <TableHead className="text-right">Contract Value</TableHead>
            <TableHead className="text-right">Rate</TableHead>
            <TableHead
              className="text-right cursor-pointer select-none"
              onClick={() => handleSort('commission_amount_cents')}
            >
              Commission <SortIcon field="commission_amount_cents" />
            </TableHead>
            <TableHead>Status</TableHead>
            {isAdmin && <TableHead className="text-right">Actions</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedCommissions.length === 0 ? (
            <TableRow>
              <TableCell colSpan={isAdmin ? 8 : 7} className="text-center text-[hsl(var(--muted-fg))] py-8">
                No commissions found
              </TableCell>
            </TableRow>
          ) : (
            sortedCommissions.map((commission) => (
              <TableRow key={commission.id}>
                <TableCell className="font-medium">
                  {new Date(commission.created_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </TableCell>
                <TableCell>{commission.property_name}</TableCell>
                <TableCell className="font-mono text-sm">
                  {commission.aspire_number ?? `JN-${commission.estimate_number}`}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatCommission(commission.contract_value_cents)}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {formatRate(commission.commission_rate)}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {formatCommission(commission.commission_amount_cents)}
                </TableCell>
                <TableCell>{getStatusBadge(commission.status)}</TableCell>
                {isAdmin && (
                  <TableCell className="text-right">
                    {commission.status === 'approved' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleMarkPaid(commission.id)}
                        disabled={markPaid.isPending}
                        className="gap-1.5"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Mark Paid
                      </Button>
                    )}
                    {commission.status === 'paid' && commission.payment_period && (
                      <span className="text-xs text-[hsl(var(--muted-fg))]">
                        {commission.payment_period}
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

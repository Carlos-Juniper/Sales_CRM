import { useState, useMemo } from 'react'
import './LineItemEditor.css'
import { Plus, Trash2, ChevronDown, ChevronUp, Save, RotateCcw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatCurrency, cn } from '@/lib/utils'
import type { Estimate, EstimateQueueItem, LineItem, LineItemCategory } from '@/types/estimating'

const CATEGORIES: { value: LineItemCategory; label: string; color: string }[] = [
  { value: 'labor', label: 'Labor', color: '#2E7D52' },
  { value: 'materials', label: 'Materials', color: '#2563eb' },
  { value: 'equipment', label: 'Equipment', color: '#7c3aed' },
  { value: 'overhead', label: 'Overhead', color: '#d97706' },
  { value: 'subcontractor', label: 'Subcontractor', color: '#dc2626' },
]

const UNITS = ['visits', 'months', 'weeks', 'applications', 'cycles', 'rotations', 'year', 'project', 'allowance', 'tons', 'yards', 'hours', 'sq ft']

const MARGIN_BAR_MAX_PCT = 40

function recalc(item: LineItem): LineItem {
  const total_cost = item.quantity * item.unit_cost
  const total_price = item.quantity * item.unit_price
  const margin_pct = total_price > 0 ? ((total_price - total_cost) / total_price) * 100 : 0
  return { ...item, total_cost, total_price, margin_pct }
}

function blankItem(category: LineItemCategory): LineItem {
  return {
    id: crypto.randomUUID(),
    category,
    description: '',
    quantity: 1,
    unit: 'months',
    unit_cost: 0,
    unit_price: 0,
    total_cost: 0,
    total_price: 0,
    margin_pct: 0,
  }
}

interface CategorySectionProps {
  category: LineItemCategory
  items: LineItem[]
  onUpdate: (item: LineItem) => void
  onDelete: (id: string) => void
  onAdd: (cat: LineItemCategory) => void
  collapsed: boolean
  onToggle: () => void
}

function CategorySection({ category, items, onUpdate, onDelete, onAdd, collapsed, onToggle }: CategorySectionProps) {
  const cfg = CATEGORIES.find((c) => c.value === category)!
  const totalCost = items.reduce((s, i) => s + i.total_cost, 0)
  const totalPrice = items.reduce((s, i) => s + i.total_price, 0)
  const avgMargin = totalPrice > 0 ? ((totalPrice - totalCost) / totalPrice) * 100 : 0

  return (
    <div className="border border-[hsl(var(--border))] rounded-lg overflow-hidden">
      {/* Category header */}
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-2.5 bg-[hsl(var(--muted))] hover:bg-[hsl(var(--muted))]/80 transition-colors"
      >
        <div className="h-2.5 w-2.5 rounded-full flex-shrink-0 line-item-category-dot" style={{ '--cat-color': cfg.color } as React.CSSProperties} />
        <span className="font-semibold text-sm text-[hsl(var(--fg))] flex-1 text-left capitalize">{cfg.label}</span>
        <span className="text-xs text-[hsl(var(--muted-fg))] mr-2">{items.length} items</span>
        <span className="text-xs font-medium text-[hsl(var(--fg))] mr-2">{formatCurrency(totalPrice)}</span>
        <span className={cn('text-xs font-bold mr-3', avgMargin >= 18 ? 'text-green-600' : avgMargin >= 10 ? 'text-amber-600' : 'text-red-600')}>
          {avgMargin.toFixed(1)}% margin
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4 text-[hsl(var(--muted-fg))]" /> : <ChevronUp className="h-4 w-4 text-[hsl(var(--muted-fg))]" />}
      </button>

      {!collapsed && (
        <div className="overflow-x-auto">
          {/* Table header */}
          <div className="line-item-grid grid text-[10px] font-semibold text-[hsl(var(--muted-fg))] uppercase tracking-wide px-4 py-1.5 bg-[hsl(var(--bg))] border-b border-[hsl(var(--border))]">
            <span>Description</span>
            <span>Qty</span>
            <span>Unit</span>
            <span>Unit Cost</span>
            <span>Unit Price</span>
            <span>Total Price</span>
            <span>Margin</span>
            <span />
          </div>

          {/* Line items */}
          {items.map((item) => (
            <div
              key={item.id}
              className="line-item-grid grid items-center gap-1 px-4 py-1.5 border-b border-[hsl(var(--border))]/50 hover:bg-[hsl(var(--muted))]/30"
            >
              <Input
                value={item.description}
                onChange={(e) => onUpdate(recalc({ ...item, description: e.target.value }))}
                className="h-7 text-xs border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                placeholder="Description…"
              />
              <Input
                type="number"
                value={item.quantity}
                onChange={(e) => onUpdate(recalc({ ...item, quantity: parseFloat(e.target.value) || 0 }))}
                className="h-7 text-xs text-center"
                min={0}
              />
              <Select value={item.unit} onValueChange={(v) => onUpdate({ ...item, unit: v })}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input
                type="number"
                value={item.unit_cost}
                onChange={(e) => onUpdate(recalc({ ...item, unit_cost: parseFloat(e.target.value) || 0 }))}
                className="h-7 text-xs"
                min={0}
              />
              <Input
                type="number"
                value={item.unit_price}
                onChange={(e) => onUpdate(recalc({ ...item, unit_price: parseFloat(e.target.value) || 0 }))}
                className="h-7 text-xs"
                min={0}
              />
              <span className="text-xs font-medium text-center text-[hsl(var(--fg))]">
                {formatCurrency(item.total_price)}
              </span>
              <span className={cn('text-xs font-bold text-center', item.margin_pct >= 18 ? 'text-green-600' : item.margin_pct >= 10 ? 'text-amber-600' : 'text-red-600')}>
                {item.margin_pct.toFixed(1)}%
              </span>
              <button
                onClick={() => onDelete(item.id)}
                aria-label="Delete item"
                className="flex items-center justify-center h-7 w-7 text-[hsl(var(--muted-fg))] hover:text-red-500 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}

          {/* Add item */}
          <div className="px-4 py-2">
            <button
              onClick={() => onAdd(category)}
              className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-fg))] hover:text-[hsl(var(--fg))] transition-colors"
            >
              <Plus className="h-3.5 w-3.5" /> Add {cfg.label.toLowerCase()} item
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

interface Props {
  estimate: Estimate
  queueItem?: EstimateQueueItem
  onSave: (items: LineItem[], overheadPct: number) => void
}

export function LineItemEditor({ estimate, queueItem, onSave }: Props) {
  const [items, setItems] = useState<LineItem[]>(() => estimate.line_items)
  const [overheadPct, setOverheadPct] = useState(estimate.overhead_pct)
  const [collapsed, setCollapsed] = useState<Set<LineItemCategory>>(new Set())
  const [saved, setSaved] = useState(false)

  function toggleCollapse(cat: LineItemCategory) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) { next.delete(cat) } else { next.add(cat) }
      return next
    })
  }

  function updateItem(updated: LineItem) {
    setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)))
    setSaved(false)
  }

  function deleteItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id))
    setSaved(false)
  }

  function addItem(cat: LineItemCategory) {
    setItems((prev) => [...prev, blankItem(cat)])
    setSaved(false)
  }

  const totals = useMemo(() => {
    const subtotal_cost = items.reduce((s, i) => s + i.total_cost, 0)
    const subtotal_price = items.reduce((s, i) => s + i.total_price, 0)
    const overhead = subtotal_cost * (overheadPct / 100)
    const total_cost = subtotal_cost + overhead
    const margin = subtotal_price > 0 ? ((subtotal_price - total_cost) / subtotal_price) * 100 : 0
    return { subtotal_cost, subtotal_price, overhead, total_cost, margin }
  }, [items, overheadPct])

  const byCategory = useMemo(() => {
    const map = new Map<LineItemCategory, LineItem[]>()
    CATEGORIES.forEach((c) => map.set(c.value, []))
    items.forEach((i) => map.get(i.category)?.push(i))
    return map
  }, [items])

  return (
    <div className="flex flex-col gap-4 h-full overflow-y-auto pb-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-[hsl(var(--fg))]">{estimate.property_name}</h3>
          <p className="text-xs text-[hsl(var(--muted-fg))] mt-0.5">
            {queueItem ? `${queueItem.estimated_acreage} acres • ${formatCurrency(queueItem.estimated_contract_value)} target` : 'Line-item editor'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { setItems(estimate.line_items); setOverheadPct(estimate.overhead_pct); setSaved(false) }} className="gap-1 text-xs">
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </Button>
          <Button size="sm" onClick={() => { onSave(items, overheadPct); setSaved(true) }} className="gap-1 text-xs">
            <Save className="h-3.5 w-3.5" /> {saved ? 'Saved ✓' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Category sections */}
      <div className="flex flex-col gap-2">
        {CATEGORIES.map(({ value }) => (
          <CategorySection
            key={value}
            category={value}
            items={byCategory.get(value) ?? []}
            onUpdate={updateItem}
            onDelete={deleteItem}
            onAdd={addItem}
            collapsed={collapsed.has(value)}
            onToggle={() => toggleCollapse(value)}
          />
        ))}
      </div>

      {/* Totals card */}
      <Card>
        <CardHeader className="pb-2 pt-4">
          <CardTitle className="text-sm">Estimate Summary</CardTitle>
        </CardHeader>
        <CardContent className="pb-4 space-y-2">
          <div className="flex flex-col gap-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-[hsl(var(--muted-fg))]">Subtotal (labor + materials + equipment + sub)</span>
              <span className="font-medium">{formatCurrency(totals.subtotal_price)}</span>
            </div>
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <span className="text-[hsl(var(--muted-fg))]">Overhead</span>
                <Input
                  type="number"
                  value={overheadPct}
                  onChange={(e) => setOverheadPct(parseFloat(e.target.value) || 0)}
                  className="h-6 w-14 text-xs text-center"
                  min={0}
                  max={50}
                />
                <span className="text-[hsl(var(--muted-fg))] text-xs">% of cost</span>
              </div>
              <span className="text-[hsl(var(--muted-fg))]">+{formatCurrency(totals.overhead)}</span>
            </div>
            <div className="border-t border-[hsl(var(--border))] pt-1.5 flex justify-between font-semibold">
              <span>Total Cost</span>
              <span>{formatCurrency(totals.total_cost)}</span>
            </div>
            <div className="flex justify-between font-bold text-base">
              <span>Total Bid Price</span>
              <span className="text-[#2E7D52]">{formatCurrency(totals.subtotal_price)}</span>
            </div>
          </div>

          {/* Margin indicator */}
          <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]">
            <div className="flex justify-between text-xs mb-1">
              <span className="text-[hsl(var(--muted-fg))]">Overall Margin</span>
              <span className={cn('font-bold', totals.margin >= estimate.target_margin_pct ? 'text-green-600' : totals.margin >= 10 ? 'text-amber-600' : 'text-red-600')}>
                {totals.margin.toFixed(1)}% {totals.margin >= estimate.target_margin_pct ? '✓' : `(target: ${estimate.target_margin_pct}%)`}
              </span>
            </div>
            <div className="h-2 rounded-full bg-[hsl(var(--muted))] overflow-hidden">
              <div
                className={cn('h-full rounded-full transition-all margin-bar-fill', totals.margin >= estimate.target_margin_pct ? 'bg-green-500' : totals.margin >= 10 ? 'bg-amber-500' : 'bg-red-500')}
                style={{ '--margin-bar-width': `${Math.min(100, Math.max(0, totals.margin / MARGIN_BAR_MAX_PCT * 100))}%` } as React.CSSProperties}
              />
            </div>
            <div className="flex justify-between text-[10px] text-[hsl(var(--muted-fg))] mt-0.5">
              <span>0%</span>
              <span>Target {estimate.target_margin_pct}%</span>
              <span>{MARGIN_BAR_MAX_PCT}%</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

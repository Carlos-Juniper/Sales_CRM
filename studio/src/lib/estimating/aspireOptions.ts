/**
 * Front-end mirror of the vendored Aspire option lists (api/aspire_config.py).
 * Keep in sync with the backend maps: the service-line `value` MUST equal the
 * backend ASPIRE_DIVISION_MAP key exactly (including the double space in
 * "Install:  Hardscape") or the DivisionID lookup KeyErrors on push.
 */
import type { EstimateType } from '@/types/estimating'

/** City-level branch keys (unique, sorted) — the picker's options. */
export const ASPIRE_BRANCH_CITIES: readonly string[] = [
  'Bonita Springs, FL',
  'Bradenton, FL',
  'Carlisle, PA',
  'Daytona, FL',
  'Estero, FL',
  'Fort Lauderdale, FL',
  'Fort Myers, FL',
  'Hilton Head, SC',
  'Houston, TX',
  'Lancaster, PA',
  'Melbourne, FL',
  'Naples, FL',
  'Ocala, FL',
  'Orlando, FL',
  'Palm Beach Gardens, FL',
  'Panama City Beach, FL',
  'Raleigh, NC',
  'Riviera Beach, FL',
  'Sarasota, FL',
  'South Orlando, FL',
  'Tampa East, FL',
  'Tampa North, FL',
  'Tampa South, FL',
  'Tyndall, FL',
  'Venice, FL',
  'Vero Beach, FL',
  'West Orlando, FL',
  'Wilmington, NC',
]

export interface ServiceLineOption {
  /** Sent to the backend — must equal the ASPIRE_DIVISION_MAP key exactly. */
  value: string
  /** Tidied display label. */
  label: string
}

export const SERVICE_LINES: readonly ServiceLineOption[] = [
  { value: 'Maintenance: Contract', label: 'Maintenance: Contract' },
  { value: 'Maintenance: Enhancements', label: 'Maintenance: Enhancements' },
  { value: 'Maintenance: Irrigation Service', label: 'Maintenance: Irrigation Service' },
  { value: 'Install: Landscape', label: 'Install: Landscape' },
  { value: 'Install: Enhancements', label: 'Install: Enhancements' },
  { value: 'Install:  Hardscape', label: 'Install: Hardscape' }, // double-space value on purpose
  { value: 'Install: Irrigation', label: 'Install: Irrigation' },
  { value: 'Install: Sod', label: 'Install: Sod' },
]

export const DEFAULT_SERVICE_LINE: Record<EstimateType, string> = {
  maintenance: 'Maintenance: Contract',
  install: 'Install: Landscape',
}

export function defaultServiceLine(type: EstimateType): string {
  return DEFAULT_SERVICE_LINE[type]
}

export interface LostReasonOption {
  id: number
  label: string
}

/** Active reasons only (13–15); deprecated 2–12 intentionally excluded. */
export const ASPIRE_LOST_REASONS: readonly LostReasonOption[] = [
  { id: 13, label: 'Price' },
  { id: 14, label: 'Quality / Reputation' },
  { id: 15, label: 'Relationship' },
]

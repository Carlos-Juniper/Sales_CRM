// ---------------------------------------------------------------------------
// Shared FileAttachRow sub-component — used by both InstallIntakeModal and
// MaintenanceIntakeModal. Extracted to eliminate the identical copy-paste
// that previously lived at the bottom of each modal file.
// ---------------------------------------------------------------------------

import type { ChangeEvent } from 'react'
import { FileText, Upload, X } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export interface AttachedFile {
  file: File
  name: string
}

export interface FileAttachRowProps {
  label: string
  hint: string
  file: AttachedFile | null
  testId: string
  inputRef: React.RefObject<HTMLInputElement | null>
  accept?: string
  /** Label on the empty-state button. Defaults to the PDF-only intake wording. */
  actionLabel?: string
  onChange: (e: ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
}

export function FileAttachRow({
  label,
  hint,
  file,
  testId,
  inputRef,
  accept,
  actionLabel = 'Attach PDF',
  onChange,
  onClear,
}: FileAttachRowProps) {
  return (
    <div data-testid={testId}>
      <Label className="text-xs font-medium">{label}</Label>
      <p className="text-[10px] text-[hsl(var(--muted-fg))] mb-1">{hint}</p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        aria-label={label}
        onChange={onChange}
      />
      {file ? (
        <div className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-2.5 py-1.5 text-xs">
          <FileText className="h-3.5 w-3.5 flex-shrink-0 text-[#2E7D52]" />
          <span className="flex-1 truncate">{file.name}</span>
          <button
            type="button"
            onClick={onClear}
            className="p-0.5 rounded hover:bg-[hsl(var(--muted))] cursor-pointer"
            aria-label={`Remove ${file.name}`}
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-dashed',
            'border-[hsl(var(--border))] text-xs text-[hsl(var(--muted-fg))]',
            'hover:border-[#2E7D52] hover:text-[#2E7D52] transition-colors cursor-pointer',
          )}
        >
          <Upload className="h-3.5 w-3.5" />
          {actionLabel}
        </button>
      )}
    </div>
  )
}

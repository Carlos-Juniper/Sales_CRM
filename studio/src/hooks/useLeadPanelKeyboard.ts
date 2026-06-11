import { useEffect } from 'react'

export function useLeadPanelKeyboard(
  leadId: string | null,
  onClose: () => void,
  onPrev?: () => void,
  onNext?: () => void,
): void {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowUp' && onPrev) onPrev()
      if (e.key === 'ArrowDown' && onNext) onNext()
    }
    if (leadId) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [leadId, onClose, onPrev, onNext])
}

// ---------------------------------------------------------------------------
// Page 16 — Start Up Communication (static)
// ---------------------------------------------------------------------------

import { STARTUP_COMMUNICATION_CONTENT } from '@/lib/proposal/staticContent'
import type { CopyList } from '@/lib/proposal/staticContent'
import { PrintPage, CopyLists } from './shared'

export function StartupCommunication() {
  const content = STARTUP_COMMUNICATION_CONTENT
  const [lede, ...rest] = content.body
  const [purposeList, attendeesList, agendaList, scheduleList] = content.lists ?? []
  return (
    <PrintPage data-testid="page-startup-communication">
      <div className="cols-2 comm-cols">
        <div>
          <p className="eyebrow">{content.subheading}</p>
          <h1 className="page-title">{content.heading}</h1>
          <p className="lede">{lede}</p>
          {rest.map((para, i) => (
            <p key={i}>{para}</p>
          ))}
          <CopyLists lists={purposeList ? [purposeList] : undefined} />
        </div>
        <div className="comm-col-right">
          <CopyLists lists={[attendeesList, agendaList].filter((l): l is CopyList => !!l)} />
        </div>
      </div>
      {scheduleList
        ? (
          <div className="copy-list comm-sched">
            <p className="copy-list-label">{scheduleList.label}</p>
            <div className="sched">
              <div className="sched-rule" />
              {scheduleList.items.map((item, i) => {
                // Split the lead into two roughly-even lines by word count —
                // the approved copy's three schedule leads are each 6 words,
                // so a midpoint split reproduces the reference's two-line card
                // headers ("30 days prior" / "to start date") without hardcoding
                // per-item breakpoints.
                const words = (item.lead ?? '').replace(/:\s*$/, '').split(' ')
                const mid = Math.ceil(words.length / 2)
                return (
                  <div key={i}>
                    <div className="sched-head">
                      {words.slice(0, mid).join(' ')}
                      <br />
                      {words.slice(mid).join(' ')}
                    </div>
                    <div className="sched-body">{item.text}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )
        : null}
    </PrintPage>
  )
}

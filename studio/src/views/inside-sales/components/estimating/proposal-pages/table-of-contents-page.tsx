// ---------------------------------------------------------------------------
// Table of Contents — one line per body chapter, in whatever order is in
// effect (natural, or a rep's saved rearrangement). Cover, Intro Letter, and
// Closing are locked and never appear here. See lib/proposal/chapters.ts for
// how `entries` is computed.
// ---------------------------------------------------------------------------

import { PrintPage } from './shared'

export interface TocEntry {
  key: string
  title: string
  pageNumber: number
}

export function TableOfContentsPage({ entries }: { entries: TocEntry[] }) {
  return (
    <PrintPage data-testid="page-toc">
      <h1 className="page-title">Table of Contents</h1>
      <ol className="toc-list">
        {entries.map((e) => (
          <li className="toc-entry" key={e.key}>
            <span className="toc-entry-title">{e.title}</span>
            <span className="toc-entry-dots" aria-hidden="true" />
            <span className="toc-entry-page">{e.pageNumber}</span>
          </li>
        ))}
      </ol>
    </PrintPage>
  )
}

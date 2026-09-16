// ---------------------------------------------------------------------------
// ContractTerms — Terms & Conditions boilerplate for the Landscape
// Maintenance Agreement.
//
// Static legal/procedural text, IDENTICAL on every contract regardless of the
// estimate — no estimate prop, nothing here is data-driven. Transcribed
// near-verbatim from business docs/Pointe Jupiter Yacht Club.pdf (p.40-41):
// Non-Contractual Services, Discovery Period, Terms & Conditions, Standard
// Warranty, Fees and Costs. "Florida statutes" in the source is generalized
// to "the applicable state's statutes" since this copy ships on every
// contract regardless of which branch/state the job is in.
// ---------------------------------------------------------------------------

import { PrintPage } from './shared'

interface TermsSection {
  title: string
  paragraphs: string[]
}

const PAGE_ONE_SECTIONS: TermsSection[] = [
  {
    title: 'Non-Contractual Services',
    paragraphs: [
      "Unless otherwise agreed upon, in writing, by Owner & Contractor, these services include, but are not limited to, tree, palm, plant or turf replacements, irrigation or landscape lighting repairs, mainline, pump station, or water source repairs, drainage work, arbor work, preventative disease & pest treatment, pre-emergent weed control, annual flower rotations, mulch applications, additional services above and beyond contracted frequency, storm preparation or reparation, or any requested changes or enhancements to the property.",
      "Contractor will make recommendations as needed and will act on recommendations from Owner. These services will be proposed and billed on a time and material basis. No non-contractual service will commence without signed, written permission from an authorized representative of Owner. In some cases proposals can be definitive; in others where discovery is involved, Contractor will provide its best estimate of cost, which will vary based on the work involved and will be supported with detail. Due to the volatility in labor and material cost, and Contractor's inability to budget for non-contractual services, pricing will always be based on cost at time of service.",
    ],
  },
  {
    title: 'Discovery Period',
    paragraphs: [
      "As part of the discovery period, Contractor will provide Owner a start-up plan detailing the first 90 days of service. This will include the existing deficiencies report, described below, as well as expectations for milestones achieved in each of the thirty (30), sixty (60) and ninety (90) day periods. The start-up plan may vary on smaller properties.",
      "Contractor will utilize the first ninety (90) days of service to identify existing deficiencies on site. Issues include, but are not limited to, negligent pruning or mowing, excessive debris, high or low pH in soil, insufficient cation exchange rate, poorly drained areas, malfunctioning or non-operational irrigation or landscape lighting, water quality, volume or pressure issues, and active disease or pests affecting trees, palms, ornamentals or turf. Depending on the level of deficiency and property size this may be completed sooner, but it may also exceed the ninety (90) day benchmark; if so, Contractor will notify Owner and set a new expectation.",
      "Once evaluation is complete, Contractor will provide a detailed issues report along with proposals for remediation. Owner has an obligation to either approve remediation work or waive Contractor's liability for pre-existing deficiencies, including future damages they may cause.",
    ],
  },
]

const PAGE_TWO_SECTIONS: TermsSection[] = [
  {
    title: 'Terms & Conditions',
    paragraphs: [
      "This Contract is for an initial term of twelve (12) months, with two twelve (12) month renewals, beginning with the contractual start date on this agreement. Owner or Contractor may terminate this agreement at any time with thirty (30) days' certified mail notice for cause. If neither party terminates this agreement, it will automatically renew with a 5% increase for the next twelve (12) months. If the Contract is terminated prematurely, Owner is responsible for actual costs incurred rather than the level billing; level billing exists only for the Owner's convenience and does not reflect where costs are accrued.",
      "Contractor reserves the right to terminate the Contract or stop service if Owner is thirty (30) days past due. Under no circumstances may Owner withhold payment for Contracted services already rendered. For termination for cause: (1) Owner shall provide Contractor written notice by certified mail of deficiencies in the performance of the contracted scope; (2) Contractor shall have fifteen (15) days after receipt of notice to remedy the deficiencies referenced in the notice; (3) if the remediation period expires and deficiencies are not corrected, Owner may send a termination notice by certified mail, effective thirty (30) days after receipt. In the event of a mid-term termination, Owner agrees to pay for services rendered in lieu of the level billing structure established for the Owner's convenience.",
    ],
  },
  {
    title: 'Standard Warranty',
    paragraphs: [
      "Contractor warrants Juniper-installed irrigation, drainage and lighting for one (1) year; trees and palms for six (6) months; shrubs and ground cover for three (3) months; and sod for thirty (30) days. All products used by Contractor are purchased from professional green industry vendors and manufacturers. Contractor is not responsible for damages due to acts of God or damages by others, including but not limited to freeze damage, tornadoes, hurricanes, strong winds, lightning, excessive or insufficient water, poor existing soil conditions, poor drainage, disease, or pests — such losses are the sole liability of the Owner. Warranty is not valid for relocated materials, materials provided by others, or materials without an automatic irrigation system supplying supplemental water, and is not valid for failure of water or power supply. Juniper maintaining a property, alone, does not constitute a warranty of issues on that property.",
    ],
  },
  {
    title: 'Fees and Costs',
    paragraphs: [
      "In the event of a payment default, Owner shall be responsible for paying the costs Contractor incurs to collect any unpaid balance, including but not limited to attorney's fees and court costs. A past-due, unpaid balance shall accrue interest at the highest lawful rate specified in the applicable state's statutes until paid in full.",
    ],
  },
]

function TermsSections({ sections }: { sections: TermsSection[] }) {
  return (
    <div className="contract-scope">
      {sections.map((section) => (
        <div className="scope-entry" key={section.title}>
          <h3 className="scope-entry-title">{section.title}</h3>
          {section.paragraphs.map((p, i) => (
            <p className="scope-entry-text" key={i}>
              {p}
            </p>
          ))}
        </div>
      ))}
    </div>
  )
}

export function ContractTerms() {
  return (
    <>
      <PrintPage data-testid="page-contract-terms-1" className="contract">
        <h2 className="section-title">Terms &amp; Conditions</h2>
        <TermsSections sections={PAGE_ONE_SECTIONS} />
      </PrintPage>
      <PrintPage data-testid="page-contract-terms-2" className="contract">
        <TermsSections sections={PAGE_TWO_SECTIONS} />
      </PrintPage>
    </>
  )
}

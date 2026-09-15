// ---------------------------------------------------------------------------
// Proposal static content module (Handoff 37 — Slice 2; copy from Handoff 45)
//
// All business-editable copy lives here as typed constants. A copy edit is a
// data change, not a component change. Components import these constants and
// render them — they never embed literal proposal text.
//
// Copy is the approved verbatim text extracted from Coral Bay HOA.pdf (Handoff
// 45 §4). Merge fields are left as `{field_name}` placeholders. Four source
// spellings were corrected per §7.2 (Erosion, Stabilization, Recognition, and
// Sq Ft); the intro letter's ungrammatical sentence is preserved deliberately.
// ---------------------------------------------------------------------------

import type { ProposalSectionKey } from '@/types/proposal'

// ---------------------------------------------------------------------------
// Local interfaces
// ---------------------------------------------------------------------------

/** A labelled bullet list. `label` prints as the orange list opener. */
export interface CopyList {
  label?: string
  /** Optional lede line printed between the label and the list — Start Up
   *  Communication's "Who is typically included in these meetings?" under
   *  Attendees. */
  intro?: string
  /**
   * Override the label's color; omit for the default orange on a plain label,
   * or green on a "?"-ending one. 'orange' only has an effect on a "?"-ending
   * label (a plain label is already orange by default) — Juniper Cares only.
   */
  labelColor?: 'green' | 'orange'
  /** Size a "?"-ending label to match the page's .lede.quote subhead. Arboriculture and Juniper Cares. */
  labelLarge?: boolean
  /** Render items as prose paragraphs instead of a leaf-bulleted list. */
  unbulleted?: boolean
  /**
   * Bullet glyph for the list: the brand leaf mark (default), a plain orange
   * dot, or an orange checkmark on a white disc. `check` is Juniper Sync's
   * "Highlights" sidebar list only, matching the reference page.
   */
  bulletStyle?: 'leaf' | 'dot' | 'check'
  items: CopyListItem[]
}

/** `lead` prints bold before a colon; the reference uses it on Design's bullets. */
export interface CopyListItem {
  lead?: string
  text: string
}

/** A single "Our Services" page blurb. `body` is one paragraph per element. */
export interface ServiceBlurb {
  title: string
  /** Short claim printed above the body in green or orange. Reference: "Certified Arborists". */
  subhead?: string
  /** Second green subtitle printed directly under `subhead`. Irrigation only. */
  subhead2?: string
  body: string[]
  lists?: CopyList[]
}

/**
 * Map of the 10 service section keys to their blurb content.
 * Juniper Cares is NOT a service — it renders as its own standalone section
 * (see JUNIPER_CARES_PAGE_CONTENT / §6), so it is absent from this map.
 */
export type ServicesContentMap = {
  [K in Extract<
    ProposalSectionKey,
    | 'services_design'
    | 'services_maintenance'
    | 'services_installation'
    | 'services_turf'
    | 'services_irrigation'
    | 'services_arboriculture'
    | 'services_storm_response'
    | 'services_enhancements'
    | 'services_aquatics'
    | 'services_safety_training'
  >]: ServiceBlurb
}

/** Generic static page copy with an optional subtitle. */
export interface StaticPageCopy {
  heading: string
  subheading?: string
  body: string[]
  /** Labelled bullet lists — Juniper Cares and Customer Care both use them. */
  lists?: CopyList[]
  /**
   * Small caption printed at the foot of a page's sidebar, under the QR code
   * image (PAGE_PHOTOS.juniperSyncQr). Juniper Sync only — "Scan QR Code for
   * full tour of Juniper Sync" sits below the Highlights list in the
   * reference, not as another bullet.
   */
  sidebarNote?: string
}

/** A single bullet item in the 30-60-90 startup plan. */
export interface StartupPlanBullet {
  text: string
}

/** Static seed bullets for Day Zero and Day 30. Day 60+ are free-text per proposal. */
export interface StartupPlanSeed {
  dayZero: StartupPlanBullet[]
  day30: StartupPlanBullet[]
}

/** Juniper Mapping is two pages; each has its own copy block. */
export interface JuniperMappingContent {
  pageOne: StaticPageCopy
  pageTwo: StaticPageCopy
}

/** Heading for the insurance page (the page itself is just the title + certificate image). */
export interface InsurancePageCopy {
  heading: string
}

// ---------------------------------------------------------------------------
// Intro letter (§4.1)
//
// The rendered intro-letter component currently embeds this text literally.
// It is captured here as typed copy so the salutation, body, and signer merge
// fields become a data edit. Salutation is a named individual with a colon.
// The "…best practices drives us forward" sentence is ungrammatical in the
// source and is preserved verbatim per §7.2 (a copy decision, not a fix).
// ---------------------------------------------------------------------------

export interface IntroLetterCopy {
  salutation: string
  body: string[]
  closing: string
  signature: string[]
}

export const INTRO_LETTER_CONTENT: IntroLetterCopy = {
  salutation: 'Dear {contact first and last name}:',
  body: [
    'Thank you for considering Juniper to be a part of your landscape maintenance contract bidding process for {property}. At Juniper, our team of professionals understands that each project is unique because no two clients are identical. We bring a straightforward, focused analysis to each property’s individual needs. We take pride in our commitment to quality, dependability, and industry best practices drives us forward. This commitment empowers us to meet our clients’ requirements and to serve their expanding needs as our relationship continues to grow.',
    'With over 25 years of experience in servicing communities throughout Florida, Juniper has been providing excellent landscaping services and has skilled team members dedicated to your landscaping initiatives. We understand the importance of maintaining a beautiful and well-maintained landscape, and we take pride in our attention to detail and commitment to delivering exceptional results.',
    'We look forward to having the opportunity to work with you and to discuss the enclosed information. If you have any questions, please contact me at {rep phone} or {rep email}.',
  ],
  closing: 'Thank you,',
  signature: ['{rep name}'],
}

// ---------------------------------------------------------------------------
// Our Services — 10 blurbs keyed by ProposalSectionKey (§4.4).
// Juniper Cares is not here; it is a standalone section (JUNIPER_CARES_PAGE_CONTENT).
// ---------------------------------------------------------------------------

export const SERVICES_CONTENT: ServicesContentMap = {
  services_design: {
    title: 'Design',
    body: [
      'Our expert design team offers full-service landscape architecture to help bring your project to life — from the earliest planning stages to a clear, buildable plan you can rely on.',
    ],
    lists: [
      {
        label: 'What We Offer:',
        labelColor: 'green',
        items: [
          { lead: 'Land Planning:', text: 'zoning, site design, yield analysis, permitting & budgeting' },
          { lead: 'Plan Generation:', text: 'sustainable landscapes, hardscape, irrigation, lighting & water conservation' },
          { lead: 'Visualization:', text: 'conceptual layouts, 3D rendering, plant palettes & high-impact concepts' },
        ],
      },
    ],
  },

  services_maintenance: {
    title: 'Landscape Maintenance',
    subhead:
      'Juniper has been exceeding industry standards in the area of quality and dependability in Florida since 2001.',
    body: [
      'Our landscape maintenance teams work closely with the irrigation and horticultural teams. This combined with regular inspections from our dedicated account managers, helps ensure the quality of work our clients expect.',
    ],
  },

  services_installation: {
    title: 'Landscape Installation',
    subhead: 'Our design and installation teams make an award-winning combination.',
    body: [
      'Juniper’s landscape installation services are built on quality craftsmanship, attention to detail, and a deep understanding of how outdoor environments thrive. From thoughtful design execution to precise installation, we ensure every element enhances both beauty and functionality. Our teams work hard to deliver a quality project on time and on budget, creating durable, long-lasting landscapes that reflect Juniper’s standard of excellence.',
    ],
  },

  services_turf: {
    title: 'Turf Management',
    body: [
      'Our turf management services are designed to keep your lawns healthy, resilient, and consistently attractive throughout the growing season. We provide a proactive program that can include mowing, edging, trimming, seasonal fertilization, soil health and pH management, weed control, integrated pest and disease monitoring, and irrigation checks to support strong root growth. Each site is evaluated and serviced based on turf type, sun/shade conditions, traffic patterns, and seasonal needs helping improve color and density while reducing weeds, bare spots, and preventable stress.',
    ],
  },

  services_irrigation: {
    title: 'Landscape Irrigation',
    subhead: 'State Licensed Irrigation Contractor',
    subhead2: 'What is a certified irrigation specialty contractor’s license?',
    body: [
      'An irrigation specialty contractor’s license is a certified (state-wide) specialty license developed by the Construction Industry Licensing Board to permit contractors to install, maintain, repair, alter, extend, manage, monitor, audit, or, if not prohibited by law, design irrigation systems.',
    ],
    lists: [
      {
        label: 'Water Management',
        items: [
          { text: 'Central control management' },
          { text: 'Converting beds to drip irrigation' },
          { text: 'E/T weather-based controllers' },
          { text: 'Soil moisture sensors' },
          { text: 'Pressure regulated components' },
          { text: 'High efficiency sprinklers' },
        ],
      },
      {
        label: 'Maintenance',
        items: [
          { text: 'Water Management' },
          { text: 'Repairs' },
          { text: 'Water Monitoring' },
          { text: 'Reporting' },
          { text: 'Wet Checks' },
        ],
      },
      {
        label: 'Installation',
        items: [
          { text: 'Infrastructure' },
          { text: 'Pump Stations' },
          { text: 'Central Control' },
          { text: 'Residential' },
          { text: 'Wet Checks' },
          { text: 'Commercial' },
        ],
      },
    ],
  },

  services_arboriculture: {
    title: 'Arboriculture',
    subhead: 'Certified Arborists',
    body: [
      'Juniper has multiple ISA certified Arborists that are available for everything you may need for your tree health care. Preventive maintenance helps keep trees in good health while reducing any insect, disease, or site problems.',
    ],
    lists: [
      {
        label: 'Why hire an Arborist?',
        labelLarge: true,
        unbulleted: true,
        items: [
          {
            text: 'Arborists specialize in the care of individual trees. They are knowledgeable about the needs of trees and are trained and equipped to provide proper care. Hiring an arborist is a decision that should not be taken lightly. Proper tree care is an investment that can lead to substantial returns. Well cared-for trees are attractive and can add considerable value to your property.',
          },
        ],
      },
    ],
  },

  services_storm_response: {
    title: 'Storm Response',
    body: [
      'In preparation for and after a storm, Juniper has additional team members who are critical resources during storm events. They provide not only added manpower but also bring with them the trucks and heavy equipment needed to handle storm cleanup.',
    ],
    lists: [
      {
        label: 'COMPANY RESOURCES',
        items: [
          { text: '3,200+ team members statewide' },
          { text: '35 locations throughout Florida' },
          { text: '25,000 gallons of onsite fuel' },
          { text: '1,300 trucks in our fleet' },
          { text: 'Landscape Designers & Architects' },
          { text: 'Teams throughout Florida' },
          { text: 'Extensive supply of heavy equipment' },
        ],
      },
    ],
  },

  services_enhancements: {
    title: 'Enhancements',
    subhead: 'Enhance Your Community Landscape',
    body: [
      'Whether you’re updating key areas or planning long-term improvements, new plantings and enhancements help keep your community beautiful and maintain property value. Our team identifies priority areas, creates a multi-year enhancement plan, and provides a customized budget estimate with 1, 2, 3, or even 5-year options to fit your goals.',
    ],
    lists: [
      {
        label: 'Services Include:',
        items: [
          { text: 'Landscape Design / Installation' },
          { text: 'Sod Installation' },
          { text: 'Lighting' },
          { text: 'Hardscapes' },
          { text: 'Irrigation' },
          { text: 'Seasonal Installation' },
        ],
      },
      {
        label: 'Plan Smarter, Stress Less:',
        items: [
          { text: 'Tailored designs and budgets' },
          { text: 'Cost-effective solutions' },
          { text: 'Long-term value for your property' },
        ],
      },
    ],
  },

  services_aquatics: {
    title: 'Aquatics',
    subhead: 'For All You Waterfront Needs!',
    body: [
      'Aquatic Weeds restores Florida lakes, ponds, and waterways with fast, chemical-free vegetation removal using specialized equipment. We also offer routine maintenance, EPA-approved herbicide treatments, and install fountain and aeration systems to keep your water clear, healthy, and PH balanced year-round.',
    ],
    lists: [
      {
        label: 'Aquatic Weeds Services Include:',
        items: [
          { text: 'Aquatic Weed Removal - Chemical Free' },
          { text: 'Algae & Aquatic Weed Maintenance Program' },
          // Source spellings "Eroision"/"Stabalization" corrected per §7.2.
          { text: 'Erosion Control & Prevention - Docks, Seawall and Bank Stabilization' },
          { text: 'Excavation, Dredging and Brush Clearing' },
          { text: 'Fountains and Aeration' },
          { text: 'Disaster Cleanup and Restoration' },
          { text: 'Docks and Boat Ramps' },
          { text: 'Land Clearing' },
          { text: 'Mulching' },
        ],
      },
    ],
  },

  services_safety_training: {
    // No "OUR SERVICES" eyebrow on this page; the headline stands alone (§4.4).
    // The eyebrow suppression is a rendering concern for A3 — see handback.
    title: 'Safety & Training',
    body: [
      'We prioritize the safety of our clients and our team members in the highest regard. We have implemented a company-wide safety program that is administered through our safety coordinator and local branch managers.',
    ],
    lists: [
      {
        label: 'Initial Hire Program',
        items: [
          { text: 'Safety rules' },
          { text: 'New hire safety orientation' },
          { text: 'Required and use of PPE' },
          { text: 'Equipment certifications' },
          { text: 'Weekly safety meetings' },
          { text: 'Daily job site reviews' },
          { text: 'Traffic control systems' },
          { text: 'Best practices training' },
          { text: 'Safety rewards/swag based on safety performance' },
          { text: 'Online training tools' },
        ],
      },
    ],
  },

}

// ---------------------------------------------------------------------------
// Service Overview — six capability groups (§4.4 overview page).
//
// Distinct from SERVICES_CONTENT above: that map is the 10 per-service DETAIL
// pages, while this is the single OVERVIEW page that groups Juniper's offerings
// into six capability categories. Each entry carries a stable `key` so a
// component can map over the list and wire a photo per category.
// ---------------------------------------------------------------------------

/** One capability group on the service overview page. `key` is a stable id for photo/render wiring. */
export interface ServiceOverviewCategory {
  key: string
  title: string
  bullets: string[]
}

export const SERVICE_OVERVIEW_CATEGORIES: ServiceOverviewCategory[] = [
  {
    key: 'design',
    title: 'Design',
    bullets: ['Land Planning', 'Plan Generation', 'Visualization'],
  },
  {
    key: 'build',
    title: 'Build',
    bullets: ['Landscape', 'Irrigation', 'Lighting', 'All sod varieties', 'Nursery & Tree Farm'],
  },
  {
    key: 'maintain',
    title: 'Maintain',
    bullets: ['Landscape', 'Irrigation', 'Pest Control', 'Fertilization'],
  },
  {
    key: 'technology',
    title: 'Technology',
    bullets: ['Juniper Sync', 'Juniper Mapping', 'GoCanvas'],
  },
  {
    key: 'storm_response',
    title: 'Storm Response',
    bullets: [
      '3,200+ team members statewide',
      '26 locations throughout Florida',
      '20,000 gallons of onsite fuel',
      'Extensive supply of heavy equipment',
    ],
  },
  {
    key: 'aquatics',
    title: 'Aquatics',
    bullets: [
      'Weed Maintenance',
      'Excavation & Brush Clearing',
      'Fountains, Aeration, Docks, & Seawalls',
    ],
  },
]

// ---------------------------------------------------------------------------
// Start Up Communication — static page (§4.5)
// ---------------------------------------------------------------------------

export const STARTUP_COMMUNICATION_CONTENT: StaticPageCopy = {
  // Eyebrows are stored in natural case; the `.eyebrow` class uppercases them via
  // CSS (matches the LOCAL_EXPERTS_CONTENT precedent). §4.5 renders this "START UP".
  heading: 'Communication',
  subheading: 'Start Up',
  body: [
    'At Juniper, we understand that a well-planned communication strategy is essential for a successful start-up and to delivering superior customer service.',
    'Juniper schedules and hosts recurring 30-minute Virtual Meetings (prior to startup and ongoing).',
  ],
  lists: [
    {
      label: 'Purpose',
      unbulleted: true,
      items: [
        {
          text: 'The intent of the Virtual Meeting is to create and maintain a convenient way for Juniper to provide quick updates, get quality feedback, identify issues, generate ideas, create strong communication and set us all up for success.',
        },
        {
          text: 'These meetings are in addition to any regularly scheduled walk-thrus or onsite meetings between Manager/BOD and Juniper.',
        },
      ],
    },
    {
      label: 'Attendees',
      intro: 'Who is typically included in these meetings?',
      bulletStyle: 'dot',
      items: [
        { text: 'Juniper' },
        { text: 'Account Manager' },
        { text: 'Branch Manager' },
        { text: 'Other Juniper staff depending on current issues' },
        { text: 'Your Association (You Choose)' },
        { text: 'Property Management' },
        { text: 'Interested Key Landscape Committee Members' },
        { text: 'Interested Board Members' },
      ],
    },
    {
      label: 'Agenda',
      bulletStyle: 'dot',
      items: [
        { text: 'Juniper Account Manager & Branch Manager: Operations Update' },
        { text: 'Manager/BOD: Feedback, requests, suggestions, immediate issues/concerns' },
        { text: 'Identify clear next steps' },
      ],
    },
    {
      label: 'Schedule',
      items: [
        { lead: '30 days prior to start date:', text: 'Virtual meeting every other week (20-30 min)' },
        { lead: 'First 90 days after start date:', text: 'Virtual meeting every other week (20-30 min)' },
        { lead: '4th month thru to 6th month:', text: 'Virtual meeting once per month (20-30 min)' },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Customer Care — static page (§4.6)
// ---------------------------------------------------------------------------

export const CUSTOMER_CARE_CONTENT: StaticPageCopy = {
  heading: 'People Make the Difference',
  subheading: 'Customer Care',
  body: [
    'We understand that for many residents, speaking in person with a manager is preferable. For this reason, a manager always accompanies Juniper crews and is available on-site for communication & problem-solving.',
  ],
  lists: [
    {
      label: 'In-House Customer Care Team',
      labelColor: 'green',
      unbulleted: true,
      items: [
        {
          text: 'We believe that providing great customer service is key to providing the best landscape services. To that end, we have created a department dedicated to supporting residents, account managers & field teams.',
        },
        {
          text: 'To assist owners with maintenance and irrigation concerns, Juniper offers homeowners multiple options to connect:',
        },
      ],
    },
  ],
}

/** Contact methods rendered as icon rows beside the In-House Customer Care Team copy. */
export const CUSTOMER_CARE_CONTACT_METHODS: { icon: 'visit' | 'email' | 'call'; lead: string; text: string }[] = [
  { icon: 'visit', lead: 'Visit', text: 'junipercares.com and click on "Community Service Request". Create a ticket by following the simple prompts.' },
  { icon: 'email', lead: 'Email', text: 'the comment or concern to: customercare@juniperlandscaping.com' },
  { icon: 'call', lead: 'Call', text: 'Customer Care at (239) 561-5980 to speak with a representative.' },
]

// ---------------------------------------------------------------------------
// Rooted in Florida (About Us) — static page (§4.2)
// ---------------------------------------------------------------------------

export const ROOTED_IN_FLORIDA_CONTENT: StaticPageCopy = {
  heading: 'Rooted in Florida',
  subheading: 'About Us',
  body: [
    'From the very beginning, we started with the commitment to deliver the best value and on-time projects. This commitment has helped Juniper grow from a small custom landscape operation with just a few employees to multiple locations throughout Florida. Over the last 20 years, a lot has changed, and we take pride in the technology, service, and quality we continue to provide.',
  ],
  lists: [
    {
      label: 'Where we started',
      items: [
        {
          text: 'Juniper was established in 2001 on a small farmhouse in Fort Myers, Florida. This location now serves as our corporate headquarters, although we have expanded by constructing additional buildings throughout the state of Florida.',
        },
      ],
    },
    {
      // "Where we are today" labels the statistics block below (COMPANY_STATS
      // plus the live branch-coverage count appended by the renderer).
      label: 'Where we are today',
      items: [],
    },
  ],
}

/**
 * Company-scale figures shown beside the About Us copy. The office count is not
 * here — it is computed from the same branch-coverage endpoint that drives the
 * table on the next page, so the two can never contradict each other. §4.2's
 * third statistic (26 operating locations throughout Florida) is deliberately
 * NOT hard-coded for the same reason.
 */
export const COMPANY_STATS: { num: string; label: string }[] = [
  { num: '3,200+', label: 'Horticulturally trained employees' },
  { num: '750+', label: 'In our vehicle fleet' },
]

// ---------------------------------------------------------------------------
// Local Landscape Experts — static page
// ---------------------------------------------------------------------------

export const LOCAL_EXPERTS_CONTENT: StaticPageCopy = {
  heading: 'Your Local Landscape Experts',
  subheading: 'About Us',
  body: [
    'Juniper is founded in Florida and our entire leadership team lives in-state. Our Juniper team members are experienced professionals familiar with the local landscape palette.',
  ],
}

// ---------------------------------------------------------------------------
// Juniper Sync — static page (§4.8)
// ---------------------------------------------------------------------------

export const JUNIPER_SYNC_CONTENT: StaticPageCopy = {
  // The reference breaks this title after "Service", not wherever the well's
  // width happens to wrap it — the embedded newline plus .page-title's
  // white-space: pre-line renders that exact break.
  heading: 'Support Service\nBuilt for Associations',
  subheading: 'Juniper Sync',
  body: [
    'We take great pride in Juniper Sync, our proprietary customer service software. We created this system with the goal to make it easy for residents to communicate with our team. Juniper Sync is designed for large, full-service communities to enable residents to easily report any issues that need to be addressed.',
    'Utilize our online work order system to create & track work orders for your property. Managers & residents can easily create an account to use immediately.',
  ],
  lists: [
    {
      label: 'Highlights',
      bulletStyle: 'check',
      items: [
        { text: 'Live Dashboard/ Ticket Summary' },
        { text: 'Ticket Aging' },
        { text: 'Custom Filters' },
        { text: 'Detailed Reporting' },
        { text: 'Community Maps' },
        { text: 'Knowledge Base' },
        // Source spelling "Recogition" corrected per §7.2.
        { text: 'Employee Recognition' },
      ],
    },
    {
      label: 'Juniper Sync Work Order System',
      bulletStyle: 'dot',
      items: [
        { text: 'Residents can view the status and act on all their tickets.' },
        { text: 'Designed to provide the information needed to handle requests quickly.' },
        { text: 'We provide in person training along with videos that can be easily shared with residents.' },
        { text: 'Status updates sent to directly via email & text message.' },
      ],
    },
  ],
  sidebarNote: 'Scan QR Code for full tour of Juniper Sync',
}

// ---------------------------------------------------------------------------
// Juniper Mapping — two static pages (§4.9)
// ---------------------------------------------------------------------------

export const JUNIPER_MAPPING_CONTENT: JuniperMappingContent = {
  pageOne: {
    heading: 'Technology That Makes a Difference',
    subheading: 'Juniper Mapping',
    body: [
      'Juniper Mapping utilizes drone imaging software to create an Orthomosaic image from hundreds and sometimes thousands of high-resolution images. This process allows us to proactively identify potential issues, document improvements, and provide property specific reporting including; plant health, elevation, annotation and any issues.',
    ],
    lists: [
      {
        label: 'Plant Health Assessment',
        items: [
          {
            text: 'Healthy vegetation reflects more of certain types of light than unhealthy vegetation. Juniper Mapping creates a map that highlights differences within your area of interest. This tool allows us to quickly identify areas of concern at start-up to begin treatments and track progress.',
          },
        ],
      },
    ],
  },
  pageTwo: {
    heading: 'Valuable Tools',
    subheading: 'Juniper Mapping',
    body: [],
    lists: [
      {
        label: 'Image Quality Comparison',
        items: [
          {
            text: 'Juniper Mapping provides the community with high resolution photos that provide more detail than Google Earth.',
          },
        ],
      },
      {
        label: 'Ground Elevation',
        items: [
          {
            text: 'Juniper Mapping provides a complete elevation map, allowing us to make better decisions when it comes to the draining and movement of water.',
          },
        ],
      },
      {
        label: 'Area & Line Tool',
        items: [
          {
            text: 'The Area & Line Tools provide the community with accurate information on demand. Line Tool provides the elevation profile of any area flown.',
          },
        ],
      },
      {
        label: 'Location Tool',
        items: [
          {
            text: 'GPS locate/document anything in the community. This is great for irrigation controllers, flus points, filters, valves, & shut off.',
          },
        ],
      },
      {
        label: 'Count Tool',
        items: [{ text: 'Makes creating an inventory of anything easy.' }],
      },
      {
        label: 'Track Improvements Side-By-Side',
        items: [
          {
            text: 'With Juniper Mapping, you can see the quality improvements to the community landscape side-by-side.',
          },
        ],
      },
    ],
  },
}

// ---------------------------------------------------------------------------
// Irrigation Reporting Sample — optional static page appended after the
// Landscape Irrigation service page. Copy is verbatim from a real (redacted)
// Beach Life Community proposal, "Weekly updates and irrigation.pdf" p2.
// ---------------------------------------------------------------------------

export const IRRIGATION_REPORTING_CONTENT: StaticPageCopy = {
  heading: 'Weekly Updates & Irrigation Inspection Schedule Sample Map',
  body: [
    'You never have to wonder what was done, what’s next, or what we found. Real examples of the reporting your community receives:',
  ],
  lists: [
    {
      unbulleted: true,
      items: [
        {
          lead: 'Zone by zone, with photos',
          text: 'each month’s wet-check report documents every zone separately: controller details, repairs needed, parts, faults, and photo evidence of each assessment.',
        },
        {
          lead: 'Every week, in your inbox',
          text: 'management comments, service-by-service progress against your annual agreement, what’s scheduled next, and a live count of open and completed resident tickets.',
        },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// Juniper Cares — standalone static page (separate from the services blurb)
// Mirrors §4.4's JUNIPER CARES entry; used as a standalone proposal page entry.
// ---------------------------------------------------------------------------

export const JUNIPER_CARES_PAGE_CONTENT: StaticPageCopy = {
  heading: 'Juniper Cares',
  body: [
    'At Juniper, we believe our people are our greatest strength. Juniper Cares was created to support employees when life brings unexpected challenges—because no one should have to face hardship alone.',
  ],
  lists: [
    {
      label: 'What Is Juniper Cares?',
      labelColor: 'orange',
      labelLarge: true,
      unbulleted: true,
      items: [
        {
          text: 'Juniper Cares is an employee assistance fund supported by the generosity of our team and company. The program raises and distributes funds to help qualified employees and Business Partner Associates who are experiencing financial hardship due to circumstances beyond their control.',
        },
        {
          text: 'The Juniper Cares fund is designed to provide temporary assistance during difficult times, including but not limited to:',
        },
      ],
    },
    {
      items: [
        { text: 'Serious medical situations or unexpected medical expenses' },
        { text: 'Financial hardship caused by illness or injury' },
        { text: 'Natural disasters such as floods, fires, or severe storms' },
        { text: 'The unexpected death of an immediate family member' },
        { text: 'Other unforeseen emergencies that create significant financial strain.' },
      ],
    },
  ],
}

// ---------------------------------------------------------------------------
// 30-60-90 Start Up Plan — static seed (Day Zero + Day 30 only)
// Day 60 / Day 90 / 120+ / Ongoing are free-text per proposal (StartupPlanInput).
// ---------------------------------------------------------------------------

// NOTE: Day Zero / Day 30 bullets are not part of Handoff 45 §4's approved copy
// deck; they remain the Slice-2 seed pending verification against the live
// 30-60-90 example PDF (page 2). No §4 source exists to replace them here.
export const STARTUP_PLAN_SEED: StartupPlanSeed = {
  dayZero: [
    { text: 'Conduct property walk-through with Account Manager and key client contacts' },
    { text: 'Identify and document any existing damage, deferred maintenance, or safety concerns' },
    { text: 'Confirm service schedule and point-of-contact information' },
    { text: 'Review scope of services and establish communication cadence' },
    { text: 'Set up client account in Juniper Sync portal' },
    { text: 'Orient crew lead to property layout, gate codes, and access requirements' },
    { text: 'Photograph property baseline conditions for shared documentation' },
  ],
  day30: [
    { text: 'Complete first full maintenance cycle and submit work-order report' },
    { text: 'Conduct 30-day check-in meeting with client to review service performance' },
    { text: 'Identify and quote any enhancement opportunities observed during initial visits' },
    { text: 'Confirm irrigation system coverage and schedule — adjust as needed' },
    { text: 'Submit first monthly property health summary through Juniper Sync' },
    { text: 'Confirm pest and disease scouting findings; initiate any recommended treatments' },
  ],
}

/**
 * Intro paragraph printed over the page's hero photo, above the phase cards.
 * Verbatim from the reference ("business docs/30-60-90 plan example.pdf").
 */
export const STARTUP_PLAN_INTRO =
  'This list will give you an overall guide to the initial services Juniper will ' +
  'undertake as we start work with the community. We’ll provide status updates ' +
  'throughout the first 30, 60, and 90 days of service during our Communication ' +
  'Plan meetings.'

// ---------------------------------------------------------------------------
// Insurance page — surrounding copy (certificate metadata served by backend)
// ---------------------------------------------------------------------------

/**
 * Surrounding copy for the licenses & certifications page. The table itself comes
 * from crm.licenses_certifications; `empty` renders in its place while that is bare.
 */
export const LICENSES_PAGE_COPY = {
  heading: 'Licenses & Certifications',
  empty:
    'Current licensing and certification documentation is available on request.',
}

export const INSURANCE_PAGE_COPY: InsurancePageCopy = {
  heading: 'Insurance',
}

// ---------------------------------------------------------------------------
// Dev-only placeholder tripwire
//
// `findTodoStrings` walks any content structure and returns every string value
// matching /TODO/i so we can catch an accidental literal "TODO" in a rendered
// string value before it reaches a client-facing page. It is pure and fully
// unit-testable; the `console.warn` side effect below is gated on
// `import.meta.env.DEV` so it never runs in a production build and never emits a
// visible/client-facing marker.
// ---------------------------------------------------------------------------

const TODO_PATTERN = /TODO/i

/**
 * Recursively walk an object / array / string structure and return every
 * string leaf whose value contains "TODO" (case-insensitive). Non-string
 * leaves (numbers, booleans, null, undefined) are ignored.
 */
export function findTodoStrings(content: unknown): string[] {
  if (typeof content === 'string') {
    return TODO_PATTERN.test(content) ? [content] : []
  }

  if (Array.isArray(content)) {
    return content.flatMap((item) => findTodoStrings(item))
  }

  if (content !== null && typeof content === 'object') {
    return Object.values(content as Record<string, unknown>).flatMap((value) =>
      findTodoStrings(value),
    )
  }

  return []
}

/**
 * Emit one `console.warn` per offending TODO string found in `content`, with
 * enough of the string to locate it. Pure aside from the warn call — callers
 * decide when to invoke it (the module-level invocation below is dev-gated).
 */
export function warnOnTodoStrings(content: unknown, label = 'staticContent'): void {
  for (const hit of findTodoStrings(content)) {
    console.warn(
      `[${label}] placeholder TODO found in rendered string value: "${hit}"`,
    )
  }
}

// Dev-only tripwire: scan this module's own exported content. Never runs in a
// production build (`import.meta.env.DEV` is statically false there), so it is
// tree-shaken out and can never emit a client-facing marker.
if (import.meta.env.DEV) {
  warnOnTodoStrings(
    {
      INTRO_LETTER_CONTENT,
      SERVICES_CONTENT,
      STARTUP_COMMUNICATION_CONTENT,
      CUSTOMER_CARE_CONTENT,
      ROOTED_IN_FLORIDA_CONTENT,
      COMPANY_STATS,
      LOCAL_EXPERTS_CONTENT,
      JUNIPER_SYNC_CONTENT,
      JUNIPER_MAPPING_CONTENT,
      IRRIGATION_REPORTING_CONTENT,
      JUNIPER_CARES_PAGE_CONTENT,
      STARTUP_PLAN_SEED,
      STARTUP_PLAN_INTRO,
      LICENSES_PAGE_COPY,
      INSURANCE_PAGE_COPY,
    },
    'proposal/staticContent',
  )
}

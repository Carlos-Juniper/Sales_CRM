// ---------------------------------------------------------------------------
// Proposal static content module (Handoff 37 — Slice 2)
//
// All business-editable copy lives here as typed constants. A copy edit is a
// data change, not a component change. Components import these constants and
// render them — they never embed literal proposal text.
//
// Placeholder copy is marked with a TODO comment below. Final marketing text
// is pending Caitlyn's content-inventory email (see §9 of the handoff).
// ---------------------------------------------------------------------------

import type { ProposalSectionKey } from '@/types/proposal'

// ---------------------------------------------------------------------------
// Local interfaces
// ---------------------------------------------------------------------------

/** A single "Our Services" page blurb. `body` is one paragraph per element. */
export interface ServiceBlurb {
  title: string
  body: string[]
}

/** Map of all 11 service section keys to their blurb content. */
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
    | 'services_juniper_cares'
  >]: ServiceBlurb
}

/** Generic static page copy with an optional subtitle. */
export interface StaticPageCopy {
  heading: string
  subheading?: string
  body: string[]
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

/** Surrounding copy for the insurance page (certificate itself is served by the backend). */
export interface InsurancePageCopy {
  heading: string
  intro: string[]
  footer: string[]
}

// ---------------------------------------------------------------------------
// Our Services — 11 blurbs keyed by ProposalSectionKey
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const SERVICES_CONTENT: ServicesContentMap = {
  services_design: {
    title: 'Design',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "Juniper Landscaping's design team transforms outdoor spaces through thoughtful planning, creative vision, and deep horticultural expertise. From initial concept sketches to detailed construction documents, our designers work closely with property managers and stakeholders to deliver landscapes that are both beautiful and functional.",
      'Every design project begins with a thorough site analysis — assessing soil, drainage, sun exposure, and the existing plant palette — so that our recommendations are grounded in the specific conditions of your property.',
    ],
  },

  services_maintenance: {
    title: 'Landscape Maintenance',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      'Our landscape maintenance programs are built around the principle that a well-maintained property is a safe, inviting, and professionally presented environment for residents, guests, and the community at large.',
      'Juniper crews follow a structured, seasonal maintenance calendar that covers mowing, edging, pruning, fertilization, and annual color rotations — all coordinated through our Aspire service-management platform for full accountability and real-time reporting.',
    ],
  },

  services_installation: {
    title: 'Landscape Installation',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "From large-scale commercial installations to precision enhancement projects, Juniper's installation crews bring the same attention to detail that earned us a reputation for quality throughout Florida.",
      'We handle every phase of installation in-house — site preparation, grading, hardscape, irrigation rough-in, planting, and final mulch and clean-up — so there is a single point of accountability from groundbreaking to final walk-through.',
    ],
  },

  services_turf: {
    title: 'Turf Management',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "Florida's climate is both an opportunity and a challenge for turf health. Juniper's licensed agronomists develop site-specific turf programs that address weed pressure, disease, insect activity, and nutrient deficiencies through an integrated approach that minimizes inputs while maximizing stand quality.",
      'Our turf management programs include soil testing, fertility planning, selective herbicide applications, and regular scouting reports so that property managers always know what is happening beneath the surface.',
    ],
  },

  services_irrigation: {
    title: 'Landscape Irrigation',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "Water is a precious resource in Florida. Juniper's irrigation division designs, installs, and maintains efficient irrigation systems that deliver the right amount of water to the right zones at the right time — reducing waste, controlling costs, and keeping landscapes healthy through dry seasons.",
      'Our irrigation technicians are licensed and trained on the full range of commercial controller platforms, from traditional timer-based systems to weather-responsive smart controllers that integrate with local ET data.',
    ],
  },

  services_arboriculture: {
    title: 'Arboriculture',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "Trees are a property's most valuable long-term landscape assets. Juniper's arboriculture team — including ISA Certified Arborists — provides comprehensive tree care: structural pruning, crown reduction, hazard assessment, cabling and bracing, deep root fertilization, and, when necessary, safe and efficient removal.",
      'We approach every tree with a preservation mindset, working to protect and extend the health and structural integrity of the canopy while eliminating risk to people and property.',
    ],
  },

  services_storm_response: {
    title: 'Storm Response',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "When a named storm or severe weather event affects your property, Juniper's storm-response crews mobilize quickly to assess damage, clear debris, and restore safe conditions — often before regular business hours resume.",
      'Our storm protocols include pre-event preparation (securing loose plant material, staking vulnerable trees) and a post-event triage system that prioritizes safety hazards, then moves methodically through clean-up and recovery so normal maintenance can resume as quickly as possible.',
    ],
  },

  services_enhancements: {
    title: 'Enhancements',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      'Beyond routine maintenance, Juniper offers a comprehensive menu of enhancement services to keep your property looking its best year-round: seasonal color rotations, holiday décor installation and removal, mulch refreshes, bed reedging, pond and water-feature maintenance, and pressure washing of hardscape surfaces.',
      'Enhancement work is quoted per project and can be scheduled ad hoc or built into an annual enhancement budget — whichever approach best fits your operational planning cycle.',
    ],
  },

  services_aquatics: {
    title: 'Aquatics',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "Lakes, retention ponds, and ornamental water features require specialized care to remain healthy, compliant, and visually appealing. Juniper's aquatics team provides licensed aquatic herbicide treatment, aeration system installation and maintenance, fountains, fish stocking programs, and mowing of lake-bank vegetation.",
      "Our aquatics managers maintain required state licensing and carry the liability coverage needed to work on Florida's regulated water bodies, ensuring your property stays in compliance with FDEP and water management district requirements.",
    ],
  },

  services_safety_training: {
    title: 'Safety & Training',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      "Safety is embedded in everything we do at Juniper. Our crews participate in regular safety training covering equipment operation, chemical handling, traffic control, and emergency response — and every Juniper employee is covered by our comprehensive workers' compensation and general liability policies.",
      'We maintain an active safety committee that reviews incident data, updates field procedures, and ensures that our safety culture keeps pace with our growth.',
    ],
  },

  services_juniper_cares: {
    title: 'Juniper Cares',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      'Juniper Cares is our community-giving and environmental-stewardship program. Through Juniper Cares, we partner with local schools, parks, and nonprofit organizations to beautify shared spaces, fund horticultural scholarships, and support the communities where our employees live and work.',
      'When you choose Juniper, you are choosing a company that invests not only in your property, but in the broader landscape of Florida.',
    ],
  },
}

// ---------------------------------------------------------------------------
// Start Up Communication — static page
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const STARTUP_COMMUNICATION_CONTENT: StaticPageCopy = {
  heading: 'Start Up Communication',
  body: [
    'A smooth start is the foundation of a great long-term partnership. Before your first service visit, your dedicated Account Manager will schedule a property walk-through to confirm scope, identify any immediate concerns, and introduce you to the crew that will be maintaining your property.',
    "You will receive a direct point of contact for day-to-day questions, a schedule of recurring service visits, and access to Juniper's client portal where you can submit service requests, review completed work orders, and track your service history in real time.",
    'Clear, proactive communication is one of the things our clients consistently call out in their feedback. We want you to feel informed and confident from day one.',
  ],
}

// ---------------------------------------------------------------------------
// Customer Care — static page
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const CUSTOMER_CARE_CONTENT: StaticPageCopy = {
  heading: 'Customer Care',
  body: [
    "Our commitment to you does not end once the contract is signed. Juniper's customer care program ensures that every service visit is followed up with a digital work order report, that concerns are acknowledged within one business day, and that your account is reviewed quarterly by your Account Manager and Branch Manager.",
    'We measure our performance against the standards you set — not an internal benchmark. If something is not right, tell us and we will make it right, every time.',
    'Juniper has built its reputation over decades on the relationships we maintain with our clients. Your satisfaction is not a metric to us; it is the measure of our work.',
  ],
}

// ---------------------------------------------------------------------------
// Rooted in Florida (About Us) — static page
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const ROOTED_IN_FLORIDA_CONTENT: StaticPageCopy = {
  heading: 'Rooted in Florida',
  subheading: 'About Us',
  body: [
    "Juniper Landscaping was founded on a simple belief: that Florida's outdoor spaces deserve the same care and expertise that go into the buildings they surround. What began as a single-branch operation has grown into one of the state's most trusted commercial landscape companies — with branches spanning the East Coast, West Coast, and Central Florida regions.",
    'We are a company of horticulturalists, arborists, irrigation engineers, and project managers who take pride in the craft of landscape management. Our team holds dozens of professional certifications and licenses, and we invest continuously in training, equipment, and technology so that our work reflects the latest standards in sustainable and safe landscape practice.',
    'Through every hurricane season, drought, and freeze event, we have stood beside our clients — adapting, responding, and rebuilding. That resilience is in our DNA, and it is the foundation of every proposal we present.',
  ],
}

// ---------------------------------------------------------------------------
// Juniper Sync — static page (optional)
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const JUNIPER_SYNC_CONTENT: StaticPageCopy = {
  heading: 'Juniper Sync',
  subheading: 'Real-Time Service Visibility',
  body: [
    "Juniper Sync is our proprietary client-portal experience, built on top of Aspire's service management platform, giving you a single place to see everything that is happening on your property — service visits completed, upcoming schedules, open work orders, and invoice history.",
    'With Juniper Sync you can submit enhancement requests, attach photos of issues you want us to address, approve quotes, and download completed work-order reports — all from a desktop browser or mobile device.',
    'Transparency builds trust. Juniper Sync is how we deliver that transparency at scale, across every property in your portfolio.',
  ],
}

// ---------------------------------------------------------------------------
// Juniper Mapping — two static pages (optional)
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const JUNIPER_MAPPING_CONTENT: JuniperMappingContent = {
  pageOne: {
    heading: 'Juniper Mapping',
    subheading: 'Precision Starts with the Right Picture',
    body: [
      'Accurate measurements are the foundation of an accurate estimate — and an accurate estimate is the foundation of a fair contract. Juniper uses drone-based aerial mapping to capture high-resolution imagery and precise square footage measurements for every property we service.',
      'Our mapping process eliminates the guesswork that leads to disputes at year-end. What you were quoted is what you have — documented, verifiable, and available to you at any time through Juniper Sync.',
    ],
  },
  pageTwo: {
    heading: 'Juniper Mapping',
    subheading: 'Your Property, Mapped',
    body: [
      // TODO: real copy from Caitlyn's content inventory
      'Each mapped property in our portfolio receives a layered aerial view that separates turf areas, bed areas, hardscape, water features, and tree canopy — the same breakdown that drives our service scopes and pricing.',
      'Property maps are updated whenever a significant change occurs — a new building pad, a hardscape expansion, a bed conversion — so that your contract always reflects current conditions. No surprises. No disputes. Just a clear shared picture of your property.',
    ],
  },
}

// ---------------------------------------------------------------------------
// Juniper Cares — standalone static page (separate from the services blurb)
// Used as a standalone proposal page entry distinct from the services section.
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const JUNIPER_CARES_PAGE_CONTENT: StaticPageCopy = {
  heading: 'Juniper Cares',
  subheading: 'Giving Back to the Communities We Serve',
  body: [
    'At Juniper, we believe that a great landscape company does more than maintain beautiful properties — it helps sustain the communities that give those properties their context and character.',
    'Through the Juniper Cares program, we fund horticultural scholarships at Florida community colleges, partner with Habitat for Humanity on landscaping new-build homes, and organize volunteer days where our crews dedicate time to public parks and schoolyards.',
    'A portion of every Juniper service contract goes directly to Juniper Cares initiatives in the region where that contract is active. When you invest in Juniper, your community benefits too.',
  ],
}

// ---------------------------------------------------------------------------
// 30-60-90 Start Up Plan — static seed (Day Zero + Day 30 only)
// Day 60 / Day 90 / 120+ / Ongoing are free-text per proposal (StartupPlanInput).
// ---------------------------------------------------------------------------

// TODO: verify Day Zero / Day 30 bullets against live 30-60-90 example PDF (page 2)
export const STARTUP_PLAN_SEED: StartupPlanSeed = {
  dayZero: [
    { text: 'Conduct property walk-through with Account Manager and key client contacts' },
    { text: 'Identify and document any existing damage, deferred maintenance, or safety concerns' },
    { text: 'Confirm service schedule and point-of-contact information' },
    { text: 'Review scope of services and establish communication cadence' },
    { text: 'Set up client account in Juniper Sync / Aspire portal' },
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

// ---------------------------------------------------------------------------
// Insurance page — surrounding copy (certificate metadata served by backend)
// ---------------------------------------------------------------------------

// TODO: real copy from Caitlyn's content inventory
export const INSURANCE_PAGE_COPY: InsurancePageCopy = {
  heading: 'Insurance',
  intro: [
    "Juniper Landscaping carries comprehensive insurance coverage to protect your property, your residents, and our employees. Our active policies include general liability, workers' compensation, commercial auto, and umbrella coverage.",
    'Current certificates of insurance are available on request and are provided to all clients as part of the onboarding process. Our certificates are renewed annually and your account team will notify you proactively whenever a certificate is updated.',
  ],
  footer: [
    'If your property management company or HOA board requires additional insured status or a specific certificate holder language, please provide those details to your Account Manager at contract signing.',
  ],
}

// ---------------------------------------------------------------------------
// Page 17 — Customer Care (static)
// ---------------------------------------------------------------------------

import { Globe, Mail, Phone, type LucideIcon } from 'lucide-react'
import {
  CUSTOMER_CARE_CONTENT,
  CUSTOMER_CARE_CONTACT_METHODS,
} from '@/lib/proposal/staticContent'
import { pagePhotoUrl } from '@/lib/proposal/photos'
import { PrintPage, CopyLists } from './shared'

const CONTACT_METHOD_ICONS: Record<'visit' | 'email' | 'call', LucideIcon> = {
  visit: Globe,
  email: Mail,
  call: Phone,
}

export function CustomerCare() {
  const content = CUSTOMER_CARE_CONTENT
  const [lede] = content.body
  return (
    <PrintPage data-testid="page-customer-care">
      <p className="eyebrow">{content.subheading}</p>
      <h1 className="page-title">{content.heading}</h1>
      <p className="lede">{lede}</p>
      <div className="photo-hero" style={{ height: '4.8in' }}>
        <img src={pagePhotoUrl('customerCare')} alt="" />
      </div>
      <div className="customer-care-team">
        <CopyLists lists={content.lists} />
        <div className="contact-methods">
          {CUSTOMER_CARE_CONTACT_METHODS.map((method, i) => {
            const Icon = CONTACT_METHOD_ICONS[method.icon]
            return (
              <div className="contact-method" key={i}>
                <span className="contact-method-icon"><Icon aria-hidden /></span>
                <p><span className="copy-list-item-lead">{method.lead}:</span> {method.text}</p>
              </div>
            )
          })}
        </div>
      </div>
    </PrintPage>
  )
}

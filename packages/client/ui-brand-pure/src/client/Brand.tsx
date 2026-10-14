import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Product name shown beside the mark; this one constant retitles the brand row. */
const BRAND_NAME = 'PureHub'

/** Mark artwork aspect ratio (width / height) of the PureHub vector source. */
const MARK_ASPECT = 250.7827 / 220.0851

interface MarkProps {
  size: number
  className?: string | undefined
}

/** Draw the transparent PureHub vector mark in the surrounding text color. */
function Mark({ size, className }: MarkProps) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="currentColor"
      height={size}
      viewBox="0 0 250.7827 220.0851"
      width={size * MARK_ASPECT}
      style={{
        display: 'block',
        flex: 'none',
      }}
    >
      <path d="M164.6838,102.9564c-27.1001,0-49.1001,22-49,49.1c0-27.1-21.8999-49.1-49-49.1c27.1001,0,49.1001-22,49-49.1C115.5837,80.9564,137.4836,102.9564,164.6838,102.9564z" />
      <path d="M89.9836,68.3564c-5.8999-7.4-16.6001-8.7-24.1001-2.8c7.3999-5.8,8.7002-16.6,2.8999-24c5.7998,7.4,16.5,8.7,24,2.9l.1001-.1C85.3835,50.1564,84.1838,60.9564,89.9836,68.3564z" />
      <path d="M60.5837,84.6564c-3.7998-3.8-10-3.8-13.7998,0c3.7998-3.8,3.7998-10,0-13.8c3.7998,3.8,10,3.8,13.7998,0C56.7834,74.6564,56.7834,80.8564,60.5837,84.6564z" />
      <path d="M170.3835,160.2564c-3.2998-3.3-8.5-3.6-12.2002-.8c-31.7002,24.7-70,44.1-106.7002,45.7c-43.7998,.5-49.1001-34.1-36.2002-68.7c3.8999-11,9.6001-21.8,15.5-31.9c-11.6001,13.7-21.7998,29.5-27.2002,46.9c-9.2002,27.1-1,55.9,28.2998,65.1c18.6001,6,38.7002,3.5,57-1.2c29.3999-7.9,56.5-22.7,80.7002-41.1c4.1001-3.1,4.8999-9,1.7998-13.1C170.9836,160.8564,170.6838,160.5564,170.3835,160.2564z" />
      <path d="M227.8835,6.8564c-35.2998-18.1-83.2998,3.1-113.3999,23.5l2.3999-1.1c20.6001-9.2,42.5-16.9,64.8999-18.6c27.7002-2.8,56.3999,7,53.2998,39.5c-3,27.8-20.1001,52.4-38,73.1c-4.8999,5.5-10.2002,11-15.8999,16.4c-3.7002,3.5-3.8999,9.4-.2998,13.1l.1001,.1c3.6001,3.6,9.3999,3.6,13,.1c28-27.2,54.2002-62.5,56.7002-102.2C251.7834,33.8564,243.6838,15.0564,227.8835,6.8564z" />
    </svg>
  )
}

/**
 * Render the sidebar mark at the size its host surface requests.
 * @param props - Host-supplied mark presentation.
 * @returns the brand mark.
 */
export function BrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <Mark size={size} />
}

/**
 * Render the brand name as text styled with the brand font token.
 * @returns the brand name.
 */
export function BrandName() {
  return (
    <span
      style={{
        fontFamily: 'var(--dsw-font-family-brand)',
        fontSize: 15,
        fontWeight: 600,
        letterSpacing: '-0.01em',
        whiteSpace: 'nowrap',
      }}
    >
      {BRAND_NAME}
    </span>
  )
}

/**
 * Render the blank-session hero mark.
 * @param props - Host-supplied hero presentation.
 * @returns the hero mark.
 */
export function HeroBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <Mark size={size} className={className} />
}

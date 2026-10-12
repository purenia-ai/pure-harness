import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/** Product name shown beside the mark; this one constant retitles the brand row. */
const BRAND_NAME = 'PureHub'

/** Mark artwork aspect ratio (width / height) of the source bitmap. */
const MARK_ASPECT = 40 / 44

/**
 * Mark artwork: white bitmap with the brightness encoded as alpha, so a CSS
 * mask paints it in `currentColor` and it reads on both themes.
 */
const MARK_SRC = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAsCAYAAAAXb/p7AAAACXBIWXMAAAPoAAAD6AG1e1JrAAABwklEQVRYhe2Y4W3EIAyF85tNPEmZpM0iTQZJOkgyCZu8CgmuhIZgDHe0UixZJ10i8mE/GycDAPWXfegNgBsQdwTRXWe4iwTZSBCAGcAEYMOPGQC7u0Y92gwBWB2IcYDWP9zvGsHOrwIkFxkLoRn3TgGkfjagTqUr43MA+bIUq0K3cAijKAXMpU0J3RfQXAs4BRVIDQG9FqcWgNa26P9aWLthuCqvBrSLxICPnQvdG0kAz6qTTh4gjeJ7AKgkgKNLAVs/kBXIKgW80hgFu5dE0WbH21sN4FXkYnsIvaA4Dk26BtDueAkaa8o4x53diLexFJAy1/QFpHHCz63hLe4IWUB/iHN0+RXBbYWp/aU9DuBSmHaT0hEDLqnXITNgluoyGYnIw6H1qnUlAQ+9qMA3xj0LFy4FSAUaUpFzoueN9YwzQFsYn0JAYtzjx34lBdwbz3varZlNJxcQDQEnHK0JoDnr6MKohaZbAW4VVUxRlaJ26k4VCQoX1dE7blXUcoA+zb7DX41YY+IslmaADUjRgzd33vqvBGe2N9AuGzBM99VIZZzmWr7ZFQGGEdXOcyOU6gHYzYfeALgBcUcQ3XWG/1wk30D8eD5ZeUjmAAAAAElFTkSuQmCC'

interface MarkProps {
  size: number
  className?: string | undefined
}

/** Draw the brand mark: the artwork bitmap used as a CSS mask over `currentColor`. */
function Mark({ size, className }: MarkProps) {
  return (
    <span
      aria-hidden="true"
      className={className}
      style={{
        display: 'inline-block',
        width: size * MARK_ASPECT,
        height: size,
        backgroundColor: 'currentColor',
        maskImage: `url("${MARK_SRC}")`,
        maskRepeat: 'no-repeat',
        maskPosition: 'center',
        maskSize: 'contain',
        WebkitMaskImage: `url("${MARK_SRC}")`,
        WebkitMaskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        WebkitMaskSize: 'contain',
      }}
    />
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

import React, { useState } from 'react'
type Props = React.HTMLAttributes<HTMLElement> & {
  as?: 'button' | 'div' | 'span'; baseStyle: React.CSSProperties; hoverStyle?: React.CSSProperties
  title?: string; onClick?: (e: any) => void; onContextMenu?: (e: any) => void; disabled?: boolean; type?: 'button'
}
export function Hoverable({ as = 'div', baseStyle, hoverStyle, children, ...rest }: Props) {
  const [h, setH] = useState(false)
  const Tag = as as any
  return <Tag {...rest} style={{ ...baseStyle, ...(h && hoverStyle ? hoverStyle : {}) }}
    onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}>{children}</Tag>
}

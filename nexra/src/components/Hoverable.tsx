import React, { useState } from 'react'
type Props = Omit<React.HTMLAttributes<HTMLElement>, 'children'> & {
  as?: 'button' | 'div' | 'span'; baseStyle: React.CSSProperties; hoverStyle?: React.CSSProperties
  title?: string; onClick?: (e: any) => void; onContextMenu?: (e: any) => void; disabled?: boolean; type?: 'button'
  children?: React.ReactNode | ((hovered: boolean) => React.ReactNode)
}
export function Hoverable({ as = 'div', baseStyle, hoverStyle, children, ...rest }: Props) {
  const [h, setH] = useState(false)
  const Tag = as as any
  const content = typeof children === 'function' ? (children as (hovered: boolean) => React.ReactNode)(h) : children
  return <Tag {...rest} style={{ ...baseStyle, ...(h && hoverStyle ? hoverStyle : {}) }}
    onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}>{content}</Tag>
}

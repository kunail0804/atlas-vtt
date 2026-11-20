import React from "react"
import { ToolButton } from "../primitives/ToolButton"
import { DropdownMenu } from "../primitives/DropdownMenu"

/** What a tool button shows: its icon and label, and whether its tool is in use. */
export interface ToolGroupFace {
  icon: React.ComponentType<{ className?: string }>
  label: string
  isActive: boolean
}

interface ToolGroupProps {
  /** What the tool button shows; the click's tool is `onSelect`'s business. */
  face: ToolGroupFace
  shortcut: string
  menuLabel: string
  menuOpen: boolean
  onSelect: () => void
  onMenuToggle: () => void
  children: React.ReactNode
}

/** The tool itself, and beside it a chevron opening the tool's options. */
export function ToolGroup({ face, shortcut, menuLabel, menuOpen, onSelect, onMenuToggle, children }: ToolGroupProps): React.ReactElement {
  return (
    <div className="atlas-tool-group">
      <ToolButton icon={face.icon} label={face.label} shortcut={shortcut} isActive={face.isActive} onClick={onSelect} />
      <DropdownMenu
        isOpen={menuOpen}
        onToggle={onMenuToggle}
        position="top"
        align="left"
        label={menuLabel}
        chevronClassName="atlas-tool-group__chevron"
        menuClassName="min-w-[220px] shadow-ob"
      >
        {children}
      </DropdownMenu>
    </div>
  )
}

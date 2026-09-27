import type { ReactNode } from 'react'

// Plain line icons that take the text color, so they sit quietly in the UI
// instead of looking like emoji
function Icon({ size = 20, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="icon">
      {children}
    </svg>
  )
}

export const PaperclipIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </Icon>
)

// a window with a panel down its left side
export const SidebarIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M9 4v16" />
  </Icon>
)

// a pencil on a page
export const NewChatIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M12 4H6a3 3 0 0 0-3 3v11a3 3 0 0 0 3 3h11a3 3 0 0 0 3-3v-6" />
    <path d="M18.4 2.6a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z" />
  </Icon>
)

import type React from 'react'

declare module '@avtools/piano-roll'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'piano-roll-component': React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement>,
        HTMLElement
      >
    }
  }
}

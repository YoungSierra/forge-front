import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': React.HTMLAttributes<HTMLElement> & {
        src?: string
        alt?: string
        'camera-controls'?: string
        'auto-rotate'?: string
        'shadow-intensity'?: string
        'environment-image'?: string
        ar?: string
      }
    }
  }
}

import 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      // `ref` va declarado porque el visor se maneja también por atributo: el giro automático se
      // apaga quitando `auto-rotate` del elemento al primer gesto del usuario, y para eso hace
      // falta el nodo. Sin esta línea TypeScript rechaza el ref en un custom element.
      'model-viewer': React.HTMLAttributes<HTMLElement> & {
        ref?: React.Ref<HTMLElement>
        src?: string
        alt?: string
        'camera-controls'?: string
        'auto-rotate'?: string
        'auto-rotate-delay'?: string
        'interaction-prompt'?: string
        'shadow-intensity'?: string
        'environment-image'?: string
        ar?: string
      }
    }
  }
}

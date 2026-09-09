export interface PreviewStyle {
  id: string
  name: string
  css: string
}

export const defaultStyle: PreviewStyle = { id: 'default', name: 'Asciidoctor', css: '' }

// Raw imports keep document CSS out of the application shell. Adding a style
// only requires a file, followed by the normal build/deployment workflow.
const files = import.meta.glob<string>('./styles/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
})

export function discoverStyles(files: Record<string, string>): PreviewStyle[] {
  return [
    defaultStyle,
    ...Object.entries(files)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([path, css]) => {
        const id = path
          .split('/')
          .pop()!
          .replace(/\.css$/, '')
        if (id === 'default' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id)) {
          throw new Error(`Invalid preview style filename: ${path}`)
        }
        return {
          id,
          name: id
            .split('-')
            .map((word) => word[0]!.toUpperCase() + word.slice(1))
            .join(' '),
          css,
        }
      }),
  ]
}

export const previewStyles = discoverStyles(files)

export function resolveStyle(id: string | null): PreviewStyle {
  return previewStyles.find((style) => style.id === id) ?? defaultStyle
}

export const STYLE_KEY = 'asciiweave.previewStyle.v1'

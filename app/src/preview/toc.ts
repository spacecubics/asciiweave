/** Navigation is shell UI; only plain heading labels leave the sandbox. */
export interface TocHeading {
  id: string
  level: number
  label: string
}

export function createToc(container: HTMLElement, navigate: (id: string) => void) {
  const root = document.createElement('div')
  root.className = 'toc'
  root.hidden = true
  root.innerHTML = `
    <button class="toc-toggle" type="button" aria-label="Table of contents"
      aria-expanded="false" aria-controls="toc-panel">☰</button>
    <div class="toc-rail" role="group" aria-label="Heading navigation"></div>
    <nav id="toc-panel" class="toc-panel" aria-label="Table of contents" hidden>
      <div class="toc-header"><strong>Table of Contents</strong>
        <button type="button" class="toc-pin" aria-label="Pin table of contents"
          aria-pressed="false">Pin</button>
      </div>
      <ol class="toc-list"></ol>
    </nav>`
  container.prepend(root)
  const toggle = root.querySelector<HTMLButtonElement>('.toc-toggle')!
  const panel = root.querySelector<HTMLElement>('.toc-panel')!
  const pin = root.querySelector<HTMLButtonElement>('.toc-pin')!
  const list = root.querySelector<HTMLOListElement>('.toc-list')!
  const rail = root.querySelector<HTMLElement>('.toc-rail')!
  let pinned = false
  let active = ''
  let links: HTMLAnchorElement[] = []
  let marks: HTMLElement[] = []

  const open = (value: boolean) => {
    panel.hidden = !value
    container.classList.toggle('toc-open', value && !root.hidden)
    toggle.setAttribute('aria-expanded', String(value))
  }
  const setPinned = (value: boolean) => {
    pinned = value
    pin.setAttribute('aria-pressed', String(value))
    pin.textContent = value ? 'Unpin' : 'Pin'
  }
  root.addEventListener('focusout', (event) => {
    if (!pinned && !root.contains(event.relatedTarget as Node | null)) open(false)
  })
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setPinned(false)
      open(false)
      toggle.focus()
    }
  })
  toggle.addEventListener('click', () => {
    if (pinned) {
      setPinned(false)
      open(false)
      return
    }
    open(panel.hasAttribute('hidden'))
  })
  pin.addEventListener('click', () => {
    setPinned(!pinned)
    open(pinned)
    if (!pinned) toggle.focus()
  })
  return {
    setHeadings(headings: TocHeading[]) {
      root.hidden = headings.length === 0
      container.classList.toggle('toc-open', !panel.hidden && !root.hidden)
      links = []
      marks = []
      active = ''
      list.replaceChildren()
      rail.replaceChildren()
      const minimum = Math.min(...headings.map((heading) => heading.level))
      for (const heading of headings) {
        const item = document.createElement('li')
        const link = document.createElement('a')
        link.href = `#${encodeURIComponent(heading.id)}`
        link.textContent = heading.label
        link.dataset.headingId = heading.id
        link.style.paddingInlineStart = `${12 + (heading.level - minimum) * 12}px`
        link.addEventListener('click', (event) => {
          event.preventDefault()
          navigate(heading.id)
        })
        item.append(link)
        list.append(item)
        links.push(link)
        const mark = document.createElement('button')
        mark.type = 'button'
        mark.setAttribute('aria-label', heading.label)
        mark.title = heading.label
        mark.style.setProperty(
          '--mark-width',
          `${Math.max(4, 16 - (heading.level - minimum) * 3)}px`,
        )
        mark.addEventListener('click', () => navigate(heading.id))
        rail.append(mark)
        marks.push(mark)
      }
    },
    setActive(id: string) {
      if (id === active) return
      active = id
      links.forEach((link, index) => {
        const current = link.dataset.headingId === id
        if (current) link.setAttribute('aria-current', 'location')
        else link.removeAttribute('aria-current')
        const mark = marks[index]!
        mark.classList.toggle('toc-current', current)
        if (current) mark.setAttribute('aria-current', 'location')
        else mark.removeAttribute('aria-current')
        if (current) rail.scrollTop = mark.offsetTop - rail.offsetTop - rail.clientHeight / 2
        if (current && !panel.hidden) {
          const top = link.offsetTop - list.offsetTop
          if (
            top < list.scrollTop ||
            top + link.offsetHeight > list.scrollTop + list.clientHeight
          ) {
            list.scrollTop = top - list.clientHeight / 2
          }
        }
      })
    },
    dispose() {
      container.classList.remove('toc-open')
      root.remove()
    },
  }
}

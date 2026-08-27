import type { WebsocketProvider } from 'y-websocket'
import './style.css'
import {
  loadLocalUser,
  presenceList,
  storeUserName,
  withColorLight,
  type UserInfo,
} from './collaboration/presence'
import { connectCollaboration } from './collaboration/provider'
import { createDocument, fetchDocument, saveDocument } from './documents/api'
import { createAutosaver } from './documents/save'
import { createLocalDocument, type LocalDocument } from './documents/ydoc'
import { createEditor } from './editor/editor'
import { createPreview } from './preview/preview'

declare global {
  interface Window {
    // Test hook: lets integration tests apply programmatic Yjs
    // transactions, control the connection, and verify convergence.
    __asciiweave?: Pick<LocalDocument, 'ydoc' | 'ytext'> & { provider: WebsocketProvider }
  }
}

const root = document.getElementById('app')
if (!root) {
  throw new Error('missing #app element')
}

const docMatch = /^\/doc\/([A-Za-z0-9_-]+)$/.exec(location.pathname)
if (docMatch?.[1]) {
  void showEditor(root, docMatch[1])
} else {
  showLanding(root)
}

function showLanding(container: HTMLElement): void {
  container.innerHTML = `
    <main class="landing">
      <h1>asciiweave</h1>
      <p>Collaborative AsciiDoc editing. Create a document and share its URL.</p>
      <button id="new-document" type="button">New document</button>
      <p id="landing-error" class="error" hidden></p>
    </main>
  `
  const button = container.querySelector<HTMLButtonElement>('#new-document')
  const error = container.querySelector<HTMLElement>('#landing-error')
  button?.addEventListener('click', () => {
    button.disabled = true
    createDocument()
      .then((id) => {
        location.href = `/doc/${id}`
      })
      .catch(() => {
        button.disabled = false
        if (error) {
          error.textContent = 'Could not create a document. Please try again.'
          error.hidden = false
        }
      })
  })
}

async function showEditor(container: HTMLElement, id: string): Promise<void> {
  let doc
  try {
    doc = await fetchDocument(id)
  } catch {
    container.innerHTML = `<main class="landing"><p class="error">Failed to load the document. Please reload.</p></main>`
    return
  }
  if (!doc) {
    container.innerHTML = `
      <main class="landing">
        <h1>Document not found</h1>
        <p>No document exists at this URL.</p>
        <p><a href="/">Create a new document</a></p>
      </main>
    `
    return
  }

  container.innerHTML = `
    <header class="topbar">
      <a class="brand" href="/">asciiweave</a>
      <div class="presence">
        <span id="user-list" class="user-list" aria-label="Connected users"></span>
        <input id="user-name" class="user-name" maxlength="24" aria-label="Your display name" />
      </div>
      <span id="save-state" class="save-state" data-state="saved">Saved</span>
    </header>
    <main class="panes">
      <section id="source-pane" class="pane" aria-label="AsciiDoc source"></section>
      <section id="preview-pane" class="pane" aria-label="Rendered preview"></section>
    </main>
  `
  const sourcePane = container.querySelector<HTMLElement>('#source-pane')
  const previewPane = container.querySelector<HTMLElement>('#preview-pane')
  const saveState = container.querySelector<HTMLElement>('#save-state')
  const userList = container.querySelector<HTMLElement>('#user-list')
  const userName = container.querySelector<HTMLInputElement>('#user-name')
  if (!sourcePane || !previewPane || !saveState || !userList || !userName) {
    return
  }

  const preview = createPreview(previewPane)
  const autosaver = createAutosaver(
    (source) => saveDocument(id, source),
    (state) => {
      saveState.dataset.state = state
      saveState.textContent =
        state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : 'Save failed (retrying)'
    },
  )

  // The Y.Text is the live canonical source, synchronized with other
  // browsers on the same document URL. Preview and autosave follow it
  // through its observer, so they do not care whether a change came from
  // CodeMirror, a programmatic transaction, or a remote collaborator.
  // Each browser renders its own preview locally; HTML is never shared.
  const local = createLocalDocument()
  const provider = connectCollaboration(local.ydoc, id)
  local.onSourceChange((source) => {
    preview.update(source)
    autosaver.update(source)
  })

  // Presence is ephemeral Yjs Awareness state: name, color, cursor, and
  // online status never become part of the document or its persistence.
  let user = loadLocalUser(localStorage)
  provider.awareness.setLocalStateField('user', user)
  userName.value = user.name
  userName.addEventListener('change', () => {
    const name = userName.value.trim() || user.name
    userName.value = name
    user = withColorLight(name, user.color)
    storeUserName(localStorage, name)
    provider.awareness.setLocalStateField('user', user)
  })

  const renderPresence = () => {
    const states = provider.awareness.getStates() as Map<number, { user?: Partial<UserInfo> }>
    const entries = presenceList(states, provider.awareness.clientID)
    userList.replaceChildren(
      ...entries.map((entry) => {
        const chip = document.createElement('span')
        chip.className = 'user-chip'
        chip.style.setProperty('--user-color', entry.color)
        chip.textContent = entry.name
        if (entry.isLocal) {
          chip.classList.add('user-chip-local')
          chip.title = `${entry.name} (you)`
        } else {
          chip.title = entry.name
        }
        return chip
      }),
    )
  }
  provider.awareness.on('change', renderPresence)
  renderPresence()

  createEditor(sourcePane, local.ytext, local.undoManager, provider.awareness)
  preview.renderNow(local.ytext.toString())
  window.__asciiweave = { ydoc: local.ydoc, ytext: local.ytext, provider }

  // Best-effort flush of unsaved edits when the tab is closed or hidden.
  window.addEventListener('pagehide', () => {
    const pending = autosaver.pendingSource()
    if (pending !== null) {
      void saveDocument(id, pending, { keepalive: true }).catch(() => {})
    }
  })
}

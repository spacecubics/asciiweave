export interface DocumentData {
  id: string
  source: string
  created_at: string
  updated_at: string
}

export async function createDocument(): Promise<string> {
  const res = await fetch('/api/documents', { method: 'POST' })
  if (!res.ok) {
    throw new Error(`failed to create document: ${res.status}`)
  }
  const body = (await res.json()) as { id: string }
  return body.id
}

export async function fetchDocument(id: string): Promise<DocumentData | null> {
  const res = await fetch(`/api/documents/${encodeURIComponent(id)}`)
  if (res.status === 404) {
    return null
  }
  if (!res.ok) {
    throw new Error(`failed to load document: ${res.status}`)
  }
  return (await res.json()) as DocumentData
}

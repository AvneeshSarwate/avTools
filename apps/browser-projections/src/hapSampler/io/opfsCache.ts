import { FileHandleByteSource } from './byteSource'

const OPFS_TEMP_DIRECTORY = 'hap-sampler-temp'
const QUOTA_MARGIN_BYTES = 512 * 1024 * 1024
const OPFS_SESSION_ID =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
const OPFS_SESSION_FILE_PREFIX = `${OPFS_SESSION_ID}-`

type IterableFileSystemDirectoryHandle = FileSystemDirectoryHandle & {
  keys(): AsyncIterableIterator<string>
}

export type OpfsCacheEntry = {
  kind: 'opfs'
  directoryName: string
  fileName: string
  size: number
}

export type OpfsImportProgress = {
  copiedBytes: number
  totalBytes: number
}

export function isOpfsAvailable() {
  return typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function'
}

function isNotFoundError(error: unknown) {
  return error instanceof DOMException && error.name === 'NotFoundError'
}

function safeFileName(name: string) {
  return name.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(-96) || 'video.happack'
}

function createTempFileName(file: File) {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${OPFS_SESSION_FILE_PREFIX}${Date.now()}-${id}-${safeFileName(file.name)}`
}

async function getTempDirectory(options?: FileSystemGetDirectoryOptions) {
  const root = await navigator.storage.getDirectory()
  return await root.getDirectoryHandle(OPFS_TEMP_DIRECTORY, options)
}

export async function removeOpfsCacheEntry(entry: OpfsCacheEntry) {
  try {
    const directory = await getTempDirectory()
    await directory.removeEntry(entry.fileName)
  } catch (error) {
    if (!isNotFoundError(error)) throw error
  }
}

export async function cleanupStaleOpfsCacheEntries(activeFileName?: string) {
  let directory: FileSystemDirectoryHandle
  try {
    directory = await getTempDirectory()
  } catch (error) {
    if (isNotFoundError(error)) return
    throw error
  }

  const iterableDirectory = directory as IterableFileSystemDirectoryHandle
  if (typeof iterableDirectory.keys !== 'function') return

  for await (const name of iterableDirectory.keys()) {
    if (name === activeFileName) continue
    if (name.startsWith(OPFS_SESSION_FILE_PREFIX)) continue
    await directory.removeEntry(name, { recursive: true })
  }
}

export async function importFileToOpfs(
  file: File,
  onProgress?: (progress: OpfsImportProgress) => void
): Promise<{ entry: OpfsCacheEntry; source: FileHandleByteSource }> {
  if (!isOpfsAvailable()) {
    throw new Error('OPFS is not available in this browser/context.')
  }

  const estimate = await navigator.storage.estimate()
  if (typeof estimate.quota === 'number' && typeof estimate.usage === 'number') {
    const remaining = estimate.quota - estimate.usage
    const required =
      file.size + Math.min(QUOTA_MARGIN_BYTES, Math.max(64 * 1024 * 1024, file.size * 0.05))
    if (remaining < required) {
      throw new Error(
        `Not enough OPFS quota. Need about ${(required / 1_073_741_824).toFixed(2)} GiB available; browser reports ${(remaining / 1_073_741_824).toFixed(2)} GiB.`
      )
    }
  }

  const directory = await getTempDirectory({ create: true })
  const fileName = createTempFileName(file)
  const handle = await directory.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  const reader = file.stream().getReader()
  let copiedBytes = 0
  let closed = false

  const entry: OpfsCacheEntry = {
    kind: 'opfs',
    directoryName: OPFS_TEMP_DIRECTORY,
    fileName,
    size: file.size
  }

  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      await writable.write(chunk.value)
      copiedBytes += chunk.value.byteLength
      onProgress?.({ copiedBytes, totalBytes: file.size })
    }

    await writable.close()
    closed = true
    return { entry, source: await FileHandleByteSource.create(handle) }
  } catch (error) {
    try {
      reader.releaseLock()
    } catch {
      // Ignore cleanup errors from an already-closed stream reader.
    }
    try {
      if (!closed) await writable.abort(error)
    } catch {
      // Ignore cleanup errors; the caller gets the original failure.
    }
    await removeOpfsCacheEntry(entry).catch(() => undefined)
    throw error
  }
}

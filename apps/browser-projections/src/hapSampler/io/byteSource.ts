export interface ByteSource {
  readonly size: number
  readRange(offset: number, length: number): Promise<ArrayBuffer>
}

function assertReadRange(sourceSize: number, offset: number, length: number) {
  if (offset < 0 || length < 0 || offset + length > sourceSize) {
    throw new Error(`Read range is outside file bounds: offset=${offset}, length=${length}`)
  }
}

export class FileByteSource implements ByteSource {
  constructor(private readonly file: File) {}

  get size() {
    return this.file.size
  }

  async readRange(offset: number, length: number): Promise<ArrayBuffer> {
    assertReadRange(this.file.size, offset, length)
    return await this.file.slice(offset, offset + length).arrayBuffer()
  }
}

export class FileHandleByteSource implements ByteSource {
  private constructor(
    private readonly handle: FileSystemFileHandle,
    readonly size: number
  ) {}

  static async create(handle: FileSystemFileHandle): Promise<FileHandleByteSource> {
    const file = await handle.getFile()
    return new FileHandleByteSource(handle, file.size)
  }

  async readRange(offset: number, length: number): Promise<ArrayBuffer> {
    assertReadRange(this.size, offset, length)
    const file = await this.handle.getFile()
    return await file.slice(offset, offset + length).arrayBuffer()
  }
}

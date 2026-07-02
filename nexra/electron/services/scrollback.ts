export class ScrollbackBuffer {
  private chunks: string[] = []
  private totalBytes = 0

  constructor(private readonly capBytes: number = 5 * 1024 * 1024) {}

  push(data: string): void {
    this.chunks.push(data)
    this.totalBytes += Buffer.byteLength(data, 'utf8')
    while (this.totalBytes > this.capBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()!
      this.totalBytes -= Buffer.byteLength(removed, 'utf8')
    }
  }

  read(): string {
    return this.chunks.join('')
  }
}

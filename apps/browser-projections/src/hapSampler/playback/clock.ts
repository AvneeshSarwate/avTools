export class PlaybackClock {
  private playingValue = false
  private playStartTimeMs = 0
  private playStartFrame = 0
  private pausedFrameValue = 0

  constructor(
    private readonly fps: number,
    private readonly frameCount: number,
    private loopValue: boolean,
  ) {}

  get playing() {
    return this.playingValue
  }

  get pausedFrame() {
    return this.pausedFrameValue
  }

  setLoop(loop: boolean) {
    this.loopValue = loop
  }

  play(fromFrame = this.pausedFrameValue) {
    this.playingValue = true
    this.playStartFrame = this.clampFrame(fromFrame)
    this.playStartTimeMs = performance.now()
  }

  pause(now = performance.now()) {
    this.pausedFrameValue = this.currentFrame(now)
    this.playingValue = false
  }

  seek(frame: number) {
    const next = this.clampFrame(frame)
    this.pausedFrameValue = next
    if (this.playingValue) {
      this.playStartFrame = next
      this.playStartTimeMs = performance.now()
    }
  }

  currentFrame(now = performance.now()): number {
    if (!this.playingValue) return this.pausedFrameValue
    const elapsedSeconds = (now - this.playStartTimeMs) / 1000
    const rawFrame = this.playStartFrame + Math.floor(elapsedSeconds * this.fps)
    if (this.loopValue) return ((rawFrame % this.frameCount) + this.frameCount) % this.frameCount
    return Math.min(this.frameCount - 1, Math.max(0, rawFrame))
  }

  private clampFrame(frame: number) {
    return Math.min(this.frameCount - 1, Math.max(0, Math.round(frame)))
  }
}

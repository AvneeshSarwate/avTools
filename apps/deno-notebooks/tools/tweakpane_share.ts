import qrcodeGenerator from "npm:qrcode-generator@^1.4.4"

export interface TweakpaneShareInfo {
  sessionId: string
  loopbackUrl: string
  lanUrl: string | null
  qrSvg: string | null
}

interface QrCodeLike {
  addData(text: string): void
  make(): void
  createSvgTag(options?: Record<string, unknown>): string
}

type QrFactory = (typeNumber: number, errorCorrectionLevel: string) => QrCodeLike

export function buildShareInfo(
  sessionId: string,
  loopbackUrl: string,
  lanUrl: string | null,
): TweakpaneShareInfo {
  return {
    sessionId,
    loopbackUrl,
    lanUrl,
    qrSvg: lanUrl ? createQrSvg(lanUrl) : null,
  }
}

export function createQrSvg(text: string): string {
  const createQrCode = qrcodeGenerator as unknown as QrFactory
  const qr = createQrCode(0, "M")
  qr.addData(text)
  qr.make()

  return qr.createSvgTag({
    cellSize: 5,
    margin: 2,
    scalable: true,
  })
}

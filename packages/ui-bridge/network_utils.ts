export function getPreferredLanAddress(): string | null {
  const interfaces = Deno.networkInterfaces()
  const candidates = interfaces.filter((entry) =>
    entry.family === "IPv4" &&
    !entry.address.startsWith("127.") &&
    !entry.address.startsWith("169.254.") &&
    !entry.name.startsWith("utun") &&
    !entry.name.startsWith("awdl") &&
    !entry.name.startsWith("llw")
  )

  if (candidates.length === 0) {
    return null
  }

  const preferred = candidates.sort((a, b) => {
    return rankInterfaceName(a.name) - rankInterfaceName(b.name)
  })

  return preferred[0]?.address ?? null
}

function rankInterfaceName(name: string): number {
  if (name === "en0") return 0
  if (name === "en1") return 1
  if (name.startsWith("en")) return 2
  if (name.startsWith("eth")) return 3
  if (name.startsWith("wlan")) return 4
  return 10
}

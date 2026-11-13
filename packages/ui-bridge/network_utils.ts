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

// Windows names adapters by role ("Ethernet", "Wi-Fi") and adds virtual ones
// for WSL/Hyper-V ("vEthernet (WSL)"), VMs and Bluetooth that a phone on the
// LAN can't reach.
const VIRTUAL_ADAPTER = /^vEthernet|VirtualBox|VMware|Hyper-V|Bluetooth|Tailscale|ZeroTier/i

function rankInterfaceName(name: string): number {
  if (name === "en0") return 0
  if (name === "en1") return 1
  if (name.startsWith("en")) return 2
  if (name.startsWith("eth")) return 3
  if (name.startsWith("wlan")) return 4
  if (VIRTUAL_ADAPTER.test(name)) return 20
  if (/^Ethernet/.test(name)) return 5
  if (/^(Wi-?Fi|WLAN)/i.test(name)) return 6
  return 10
}

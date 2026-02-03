// Example: Using OSC in your Deno notebook
// Import the OSC helper
// Note: In notebooks, you can use "@/tools/osc.ts" thanks to the import map
import { sendOSC, sendToSC, createOSCClient, createOSCServer } from "@/tools/osc.ts";

// ============================================
// Example 1: Quick send (one-off messages)
// ============================================

// Send to SuperCollider (default port 57120)
sendToSC("/note", 60, 0.5, 1.0);

// Send to any host/port
sendOSC("/test", [1, 2, 3], "127.0.0.1", 9000);

// ============================================
// Example 2: Persistent client (better for multiple messages)
// ============================================

const client = createOSCClient("127.0.0.1", 57120);

// Send multiple messages efficiently
client.send("/note", 60, 0.5, 1.0);
client.send("/note", 64, 0.5, 1.0);
client.send("/note", 67, 0.5, 1.0);

// Close when done
client.close();

// ============================================
// Example 3: Receiving OSC messages
// ============================================

// const server = createOSCServer(57121);

// server.on("message", (msg: any) => {
//   console.log("Received OSC message:", msg);
// });

// To close the server later:
// server.close();

// ============================================
// Example 4: Livecoding pattern - send notes in a loop
// ============================================

async function playPattern() {
  const client = createOSCClient("127.0.0.1", 57120);
  const notes = [60, 62, 64, 65, 67];

  for (const note of notes) {
    client.send("/note", note, 0.5, 0.5);
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  client.close();
}

// Uncomment to run:
// await playPattern();

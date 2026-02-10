// run with: deno run --unstable --allow-net  deno_notebook_stuff/deno_osc_test.ts

// Import the OSC library and use the local declaration file for basic typing.
import { osc } from '../src/io/osc.js';

type OscPacketWriter = {
  writePacket: (packet: { address: string; args: unknown[] | unknown }) => Uint8Array;
};

// Define the OSC message
const message: { address: string; args: Array<string | number> } = {
  address: "/testAddr",
  args: ["string1", 10, 1.5]
};

// Define the target IP and port
const TARGET_IP = "127.0.0.1";  // localhost
const TARGET_PORT = 57120;  // Common port for SuperCollider, adjust as needed

async function sendOSCMessage() {
  // Encode the OSC message
  const encodedMessage = (osc as OscPacketWriter).writePacket(message);
  console.log(encodedMessage);

  // Create a UDP connection using Deno.listenDatagram
  const socket = Deno.listenDatagram({
    hostname: "0.0.0.0", // Listen on all available network interfaces
    port: 0, // Use an ephemeral port
    transport: "udp",
  });

  try {
    // Send the encoded OSC message
    const bytesSent = await socket.send(encodedMessage, {transport: "udp", hostname: TARGET_IP, port: TARGET_PORT });
    console.log(`Sent ${bytesSent} bytes to ${TARGET_IP}:${TARGET_PORT}`);
  } catch (error) {
    console.error("Failed to send message:", error);
  } finally {
    // Close the socket
    socket.close();
  }
}

// Run the function
sendOSCMessage();

import * as osc from "node-osc";

export interface OSCClient {
  send: (address: string, ...args: any[]) => void;
  close: () => void;
}

export interface OSCServer {
  on: (event: string, callback: (msg: any) => void) => void;
  close: () => void;
}

/**
 * Create an OSC client for sending messages
 * @param host - Target host (e.g., "127.0.0.1")
 * @param port - Target port (e.g., 57120)
 * @returns OSC client instance
 */
export function createOSCClient(host: string = "127.0.0.1", port: number = 57120): OSCClient {
  const client = new osc.Client(host, port);

  return {
    send: (address: string, ...args: any[]) => {
      client.send(address, ...args);
    },
    close: () => {
      client.close();
    }
  };
}

/**
 * Create an OSC server for receiving messages
 * @param port - Port to listen on (e.g., 57121)
 * @returns OSC server instance
 */
export function createOSCServer(port: number = 57121): OSCServer {
  const server = new osc.Server(port, "0.0.0.0");

  return {
    on: (event: string, callback: (msg: any) => void) => {
      server.on(event, callback);
    },
    close: () => {
      server.close();
    }
  };
}

/**
 * Send a single OSC message (creates and closes client automatically)
 * @param address - OSC address (e.g., "/note")
 * @param args - OSC message arguments
 * @param host - Target host (default: "127.0.0.1")
 * @param port - Target port (default: 57120)
 */
export function sendOSC(
  address: string,
  args: any[] = [],
  host: string = "127.0.0.1",
  port: number = 57120
): void {
  const client = new osc.Client(host, port);
  client.send(address, ...args, () => {
    client.close();
  });
}

/**
 * Convenience function for sending OSC to SuperCollider (default port 57120)
 */
export function sendToSC(address: string, ...args: any[]): void {
  sendOSC(address, args, "127.0.0.1", 57120);
}

/**
 * Example usage:
 *
 * // Quick send (creates and closes client)
 * sendOSC("/note", [60, 0.5, 1.0], "127.0.0.1", 57120);
 * sendToSC("/note", 60, 0.5, 1.0);
 *
 * // Persistent client (better for multiple messages)
 * const client = createOSCClient("127.0.0.1", 57120);
 * client.send("/note", 60, 0.5, 1.0);
 * client.send("/note", 64, 0.5, 1.0);
 * client.close();
 *
 * // Receive messages
 * const server = createOSCServer(57121);
 * server.on("message", (msg) => {
 *   console.log("Received OSC:", msg);
 * });
 */

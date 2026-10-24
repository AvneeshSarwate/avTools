import type { ChopHost } from '@avtools/native-webgpu/td-chop';

// Raw UDP example; Output Channels: port bytes messages
// Echoes each datagram to its sender, without OSC decoding.
export async function setup(host: ChopHost) {
  const socket = await host.udp.open();
  let messages = 0;
  host.outputs.set('port', socket.localAddress.port);

  socket.onMessage((bytes, remote) => {
    host.outputs.set('bytes', bytes.length);
    host.outputs.set('messages', ++messages);
    socket.send(bytes, remote).catch(console.warn);
  });

  socket.onError((error) => console.warn(error.message));
}

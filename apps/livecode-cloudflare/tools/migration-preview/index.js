const names = new Set(['claude', 'codex', 'ssh']);
const allowed = (key) => [...names].some((name) =>
  key.startsWith(`livecode/${name}/`) ||
  key.startsWith(`livecode/credential-checkpoints/${name}/checkpoints/`));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/list') {
      const name = url.searchParams.get('name');
      if (!names.has(name)) return new Response('Invalid prefix', { status: 400 });
      const cursor = url.searchParams.get('cursor') || undefined;
      const result = await env.LIVECODE_STATE.list({
        prefix: `livecode/${name}/`, limit: 1000, ...(cursor ? { cursor } : {}),
      });
      return Response.json({
        objects: result.objects.map(({ key, size }) => ({ key, size })),
        truncated: result.truncated,
        cursor: result.cursor,
      });
    }
    if (request.method === 'GET' && url.pathname === '/checkpoint') {
      const name = url.searchParams.get('name');
      if (!names.has(name)) return new Response('Invalid name', { status: 400 });
      const object = await env.LIVECODE_STATE.get(
        `livecode/credential-checkpoints/${name}/checkpoints/current.json`,
      );
      return Response.json({ exists: Boolean(object) });
    }
    if (request.method === 'POST' && url.pathname === '/batch') {
      const { keys } = await request.json();
      if (!Array.isArray(keys) || keys.length === 0 || keys.length > 40 ||
          keys.some((key) => typeof key !== 'string' || !allowed(key))) {
        return new Response('Invalid batch', { status: 400 });
      }
      const objects = await Promise.all(keys.map(async (key) => {
        const object = await env.LIVECODE_STATE.get(key);
        if (!object) throw new Error(`Missing R2 object: ${key}`);
        return { key, size: object.size, data: Buffer.from(await object.arrayBuffer()).toString('base64') };
      }));
      return Response.json({ objects });
    }
    if (request.method === 'GET' && url.pathname === '/object') {
      const key = url.searchParams.get('key');
      if (!key || !allowed(key)) return new Response('Invalid key', { status: 400 });
      const object = await env.LIVECODE_STATE.get(key);
      if (!object) return new Response('Missing', { status: 404 });
      return new Response(object.body, {
        headers: { 'Content-Length': String(object.size), 'Cache-Control': 'no-store' },
      });
    }
    return new Response('Not found', { status: 404 });
  },
};

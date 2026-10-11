import { createNodeHost } from './host.mjs';
const args = process.argv.slice(2);
const path = args.find(arg => !arg.startsWith('--'));
if (!path) throw new Error('Usage: node cli.mjs sketch.mjs [--preview]');
const host = await createNodeHost({ preview: args.includes('--preview') });
let done = false;
async function close() { if (!done) { done = true; clearInterval(timer); await host.close(); } }
process.once('SIGINT', close); process.once('SIGTERM', close);
const timer = setInterval(() => {
  const state = host.engine.moduleRunRecords().sketch?.state;
  if (state === 'error') process.exitCode = 1;
  if (state === 'error' || state === 'stopped') void close();
}, 100);
try { await host.launch(path); } catch (error) { await close(); throw error; }

// Attach to an explicitly enabled local Node inspector for a finite CPU sample.
// node --max-old-space-size=512 experiments/issue-143-inspect-profile.mjs /tmp/profile.json
import { writeFile } from 'node:fs/promises';
const [{ webSocketDebuggerUrl }] = await (
  await fetch('http://127.0.0.1:9229/json/list')
).json();
const socket = new globalThis.WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let nextId = 0;
const pending = new Map();
socket.onmessage = ({ data }) => {
  const result = JSON.parse(data);
  if (pending.has(result.id)) {
    pending.get(result.id)(result);
    pending.delete(result.id);
  }
};
const send = (method) =>
  new Promise((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    socket.send(JSON.stringify({ id, method }));
  });
try {
  await send('Profiler.enable');
  await send('Profiler.start');
  await new Promise((resolve) => setTimeout(resolve, 10000));
  const {
    result: { profile },
  } = await send('Profiler.stop');
  await writeFile(process.argv[2], JSON.stringify(profile));
  const samples = new Map();
  for (const id of profile.samples) {
    samples.set(id, (samples.get(id) || 0) + 1);
  }
  console.log(
    JSON.stringify(
      profile.nodes
        .map(({ id, callFrame }) => ({
          function: callFrame.functionName,
          file: callFrame.url,
          line: callFrame.lineNumber + 1,
          samples: samples.get(id) || 0,
        }))
        .sort((a, b) => b.samples - a.samples)
        .slice(0, 15),
      null,
      2
    )
  );
} finally {
  socket.close();
}

// Real installed SDK, offline and finite. Capture this process's stdout and
// stderr externally; a silent logger should leave only the final safe status.
import assert from 'node:assert/strict';
import { createMtcuteClient } from '../src/telegram-user.js';
const events = [];
const client = await createMtcuteClient({
  apiId: 1,
  apiHash: '0'.repeat(32),
  logger: Object.fromEntries(
    ['debug', 'warn', 'error'].map((level) => [
      level,
      (_message, event) => events.push({ level, ...event }),
    ])
  ),
});
const watchdog = setTimeout(() => {
  throw new Error('SDK close control exceeded five seconds.');
}, 5000);
try {
  client.log.prefix = '[USER 987654321]';
  client.log
    .create('updates')
    .warn(
      'error fetching common difference: %e',
      new Error('Session is reset')
    );
  assert.equal(events[0].category, 'session-loss');
  await client.destroy();
  assert(!JSON.stringify(events).includes('987654321'));
  console.log(
    JSON.stringify({
      realSdk: true,
      shutdownComplete: true,
      exportedIdentity: false,
    })
  );
} finally {
  clearTimeout(watchdog);
}

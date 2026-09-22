export function secretPrompt({
  input = process.stdin,
  label,
  output = process.stderr,
}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    throw new Error(
      `${label} requires a TTY or non-interactive environment injection.`
    );
  }
  output.write(`${label}: `);
  return new Promise((resolve, reject) => {
    let value = '';
    const rawBefore = input.isRaw;
    const cleanup = () => {
      input.off('data', onData);
      input.setRawMode(rawBefore);
      input.pause();
      output.write('\n');
    };
    const onData = (chunk) => {
      for (const character of String(chunk)) {
        if (character === '\r' || character === '\n') {
          cleanup();
          resolve(value);
          return;
        }
        if (character === '\u0003') {
          cleanup();
          const error = new Error('Authentication input cancelled.');
          error.name = 'AbortError';
          reject(error);
          return;
        }
        if (character === '\u007f') {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    input.on('data', onData);
  });
}

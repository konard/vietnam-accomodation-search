// Shared by manual QA providers without loading a Telegram SDK.
export async function withDeadline(action, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(action),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out during ${label}.`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

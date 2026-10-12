// SDK errors use data properties. Never execute custom getters/coercions when
// validating a known shape, and bound traversal of inherited Error fields.
export function telegramErrorField(error, key) {
  try {
    let object = error;
    for (let depth = 0; object && depth < 4; depth += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(object, key);
      if (descriptor) {
        return descriptor.value;
      }
      object = Object.getPrototypeOf(object);
    }
  } catch {
    // Malformed/custom error objects are not diagnostic evidence.
  }
  return undefined;
}

export function sdkFloodWaitSeconds(error) {
  const seconds = telegramErrorField(error, 'seconds');
  if (
    telegramErrorField(error, 'code') !== 420 ||
    !Number.isInteger(seconds) ||
    seconds < 0 ||
    seconds > 999999
  ) {
    return undefined;
  }
  const type = telegramErrorField(
    telegramErrorField(error, 'constructor'),
    'name'
  );
  const text = telegramErrorField(error, 'text');
  const recognized =
    (type === 'FloodWaitError' &&
      telegramErrorField(error, 'name') === 'FloodWaitError' &&
      telegramErrorField(error, 'errorMessage') === 'FLOOD') ||
    (type === 'RpcError' &&
      typeof text === 'string' &&
      /^FLOOD_(?:PREMIUM_)?WAIT_%d$/u.test(text));
  return recognized ? seconds : undefined;
}

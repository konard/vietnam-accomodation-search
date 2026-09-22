/**
 * Adds two numbers.
 *
 * Kept in a dependency-free module so the legacy browser example can use the
 * package fixture without pulling the server-side search graph into Vite.
 */
export const add = (a, b) => a + b;

/** Multiplies two numbers. */
export const multiply = (a, b) => a * b;

/** Delays execution for the requested number of milliseconds. */
export const delay = (ms) =>
  new Promise((resolve) => globalThis.setTimeout(resolve, ms));

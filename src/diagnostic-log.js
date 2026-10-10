import { levels, makeLog } from 'log-lazy';
import { redactTraceValue } from './trace.js';

// Published log-lazy 1.0.4 supplies lazy levels/sinks. Redaction and source
// privacy remain application policy; unpublished processor APIs are unused.
export function createDiagnosticLogger({
  sink = console,
  level = levels.production | levels.info,
  context,
} = {}) {
  const log = Object.fromEntries(
    [
      'fatal',
      'error',
      'warn',
      'info',
      'debug',
      'verbose',
      'trace',
      'silly',
    ].map((name) => [
      name,
      (...args) => {
        const method = sink[name] || sink.log || sink.error;
        const values = context ? [context, ...args] : args;
        method?.call(sink, ...values.map((value) => redactTraceValue(value)));
      },
    ])
  );
  return makeLog({ level, log });
}

export const diagnosticLogger = createDiagnosticLogger();

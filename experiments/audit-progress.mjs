// Ordinals refer to a retained public cohort, never to a new discovery order.
export function parseSourceSelection(value, maximum = 40) {
  if (value === undefined) {
    return Array.from({ length: maximum }, (_, index) => index + 1);
  }
  const selected = new Set();
  for (const part of value.split(',')) {
    const match = part.match(/^(\d+)(?:-(\d+))?$/u);
    const start = Number(match?.[1]);
    const end = Number(match?.[2] || match?.[1]);
    if (!match || start < 1 || end < start || end > maximum) {
      throw new RangeError(
        `Invalid --sources range: ${part}; use unique ordinals 1-${maximum}.`
      );
    }
    for (let ordinal = start; ordinal <= end; ordinal += 1) {
      if (selected.has(ordinal)) {
        throw new RangeError(`Duplicate --sources ordinal: ${ordinal}.`);
      }
      selected.add(ordinal);
    }
  }
  return [...selected].sort((a, b) => a - b);
}

function unionDuration(spans) {
  let total = 0;
  let end = -Infinity;
  for (const [start, stop] of [...spans].sort((a, b) => a[0] - b[0])) {
    total += Math.max(0, stop - Math.max(start, end));
    end = Math.max(end, stop);
  }
  return total;
}

// Store includes parallel clink jobs and parse includes OCR. Report exclusive
// wall time: union overlapping projection spans before subtracting them.
export function createSourceTimings(now = () => globalThis.performance.now()) {
  const phases = Object.fromEntries(
    ['fetch', 'ocr', 'parse', 'store', 'project'].map((phase) => [phase, []])
  );
  return {
    async measure(phase, operation) {
      const start = now();
      try {
        return await operation();
      } finally {
        phases[phase].push([start, now()]);
      }
    },
    summary() {
      const result = Object.fromEntries(
        Object.entries(phases).map(([phase, spans]) => [
          phase,
          unionDuration(spans),
        ])
      );
      result.parse = Math.max(0, result.parse - result.ocr);
      result.store = Math.max(0, result.store - result.project);
      result.total = Object.values(result).reduce(
        (sum, value) => sum + value,
        0
      );
      return result;
    },
  };
}

export function pendingSourceAudit(alias) {
  return {
    alias,
    accommodationRequests: 0,
    mediaOnlyCandidates: 0,
    messagesScanned: 0,
    missingDetails: {},
    offersWithAllExpectedFields: 0,
    parserOffers: 0,
    relevantOffers: 0,
    terminalMaterials: {},
    segments: {},
    traces: {},
    unaccountedMaterials: 0,
    unresolvedMediaOnly: 0,
    completion: {
      pass: false,
      state: 'pending',
      reason: 'source-not-yet-audited',
    },
  };
}

export function completedAudit(checkpoint) {
  if (!checkpoint?.complete) {
    return undefined;
  }
  return (
    checkpoint.audit || {
      ...pendingSourceAudit(checkpoint.id),
      ...checkpoint.metrics,
      messagesScanned: checkpoint.messagesScanned || 0,
      completion: {
        pass: true,
        state: checkpoint.state || 'complete',
        reason: 'retained-complete-checkpoint',
      },
    }
  );
}

export function mergeSourceAudits(sources, checkpoints, auditPass) {
  const byAlias = new Map(
    checkpoints.map((checkpoint) => [checkpoint.id, checkpoint])
  );
  return sources.map(({ username }) => {
    const checkpoint = byAlias.get(username);
    if (checkpoint?.auditPass && checkpoint.auditPass !== auditPass) {
      return pendingSourceAudit(username);
    }
    return (
      checkpoint?.audit ||
      completedAudit(checkpoint) ||
      pendingSourceAudit(username)
    );
  });
}

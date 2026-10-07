function normalized(value) {
  return String(value ?? '')
    .normalize('NFC')
    .toLocaleLowerCase('en')
    .trim()
    .replace(/\s+/gu, '-');
}

function add(constraints, namespace, value) {
  const identifier = normalized(value);
  if (identifier) {
    const values = constraints.get(namespace) || new Set();
    values.add(identifier);
    constraints.set(namespace, values);
  }
}

export function offerIdentityConstraints(offer, keys) {
  const constraints = new Map();
  const variants = offer.variants?.length ? offer.variants : [offer];
  const sourcePrefixes = [
    offer.sourceId,
    ...(offer.sourceIds || []),
    ...variants.map((variant) => variant.sourceId),
  ]
    .filter(Boolean)
    .map((sourceId) => `source-property:${normalized(sourceId)}:`)
    .sort((left, right) => right.length - left.length);
  // Learned keys retain identities even after the bounded variants rotate out.
  for (const key of keys) {
    if (key.startsWith('source-property:') || key.startsWith('external:')) {
      // A property ID may itself contain a colon. Known source namespaces
      // locate its boundary without assigning part of the ID to the source.
      const prefix = sourcePrefixes.find((value) => key.startsWith(value));
      const boundary = prefix ? prefix.length - 1 : key.lastIndexOf(':');
      add(constraints, key.slice(0, boundary), key.slice(boundary + 1));
    }
  }
  for (const variant of variants) {
    for (const field of ['floor', 'unit', 'unitNumber', 'apartmentNumber']) {
      add(constraints, `unit:${field}`, variant.attributes?.[field]);
    }
  }
  return constraints;
}

export function mergeIdentityConstraints(target, incoming) {
  for (const [namespace, values] of incoming) {
    target.set(
      namespace,
      new Set([...(target.get(namespace) || []), ...values])
    );
  }
}

export function conflictingIdentityGroups(groups) {
  const common = new Map();
  for (const constraints of groups) {
    for (const [namespace, values] of constraints) {
      const previous = common.get(namespace);
      const intersection = previous
        ? new Set([...previous].filter((value) => values.has(value)))
        : values;
      if (!intersection.size) {
        return true;
      }
      common.set(namespace, intersection);
    }
  }
  return false;
}

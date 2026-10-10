// Projection loss is explicit; remove surviving references to evicted entities.
const REFERENCE =
  /\.(?:eventId|transportId|offerId|sourceMessage)(?:\.value)?$/u;

export function pruneGraphReferences(records) {
  let retained = records;
  for (;;) {
    const entities = new Set(
      retained
        .filter(({ type }) => type !== 'semantic-link')
        .map(({ id }) => id)
    );
    const invalid = new Set(
      retained
        .filter(
          (record) =>
            record.type === 'semantic-link' &&
            (!entities.has(record.subject) ||
              (REFERENCE.test(record.predicate) &&
                typeof record.object === 'string' &&
                !entities.has(record.object) &&
                !entities.has(`offer:${record.object}`)))
        )
        .map(({ subject }) => subject)
    );
    if (!invalid.size) {
      return retained;
    }
    retained = retained.filter(
      (record) => !invalid.has(record.id) && !invalid.has(record.subject)
    );
  }
}

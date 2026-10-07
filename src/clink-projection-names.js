import { Link, formatLinks } from 'links-notation';

// clink represents a named reference as character links. Repeated long field
// paths greatly enlarge its uniqueness scans. A reversible per-shard name
// table uses clink's native numeric addresses; canonical text and exports retain
// the original names and source bodies.
export function compactProjectionNames(links) {
  const names = new Map();
  const visit = (link) => {
    if (typeof link.id === 'string' && !names.has(link.id)) {
      names.set(link.id, String(names.size + 1));
    }
    link.values?.forEach(visit);
  };
  links.forEach(visit);
  if (![...names.keys()].some((name) => name.length > 64)) {
    return undefined;
  }
  const rewrite = (link) =>
    new Link(names.get(link.id) ?? link.id, link.values?.map(rewrite));
  return {
    aliases: [...names.keys()],
    notation: formatLinks(links.map(rewrite)),
  };
}

export function expandProjectionNames(links, aliases) {
  const expand = (link) => {
    if (typeof link.id !== 'string') {
      return new Link(link.id, link.values?.map(expand));
    }
    const index = /^[1-9]\d*$/u.test(link.id) ? Number(link.id) - 1 : -1;
    if (!Number.isSafeInteger(index) || index < 0 || index >= aliases.length) {
      throw Object.assign(
        new Error('clink exported an unknown compact name.'),
        { code: 'storage-verification-failed' }
      );
    }
    return new Link(aliases[index], link.values?.map(expand));
  };
  return formatLinks(links.map(expand));
}

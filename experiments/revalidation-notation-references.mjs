#!/usr/bin/env node

// Self-authored reference fidelity probe; accepts another installed module.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const { Link, Parser, formatLinks } = await import(
  pathToFileURL(
    resolve(process.argv[2] || 'node_modules/links-notation/dist/index.js')
  ).href
);
const cases = [
  ['ordinary', 'ordinary reference'],
  ['both-quote-kinds', `He said "it's ready"`],
  ['all-quote-kinds', 'He said "it\'s `ready`"'],
  ['multiline-whitespace', ' \tNha Trang\n"both\'s" \n'],
  ['backslash-percent-colon', 'a\\b%20:'],
];
const rows = cases.map(([name, id]) => {
  try {
    const parsed = new Parser().parse(
      formatLinks([new Link(id, [new Link('fixture')])])
    );
    return { name, pass: parsed.length === 1 && parsed[0].id === id };
  } catch (error) {
    return { name, pass: false, error: error.constructor.name };
  }
});
console.log(JSON.stringify({ mode: 'self-authored-reference-probe', rows }));
process.exitCode = rows.every((row) => row.pass) ? 0 : 1;

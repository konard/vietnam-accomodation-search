// Checks whether links-notation reads back a reference that contains both
// quote kinds after Link.escapeReference writes it.
import { Link, Parser } from 'links-notation';

const name = `a'b"c`;
const text = `(${Link.escapeReference(name)}: x)`;
let readBack;
try {
  readBack = new Parser().parse(text)[0]?.id;
} catch (error) {
  readBack = `error: ${error.message}`;
}
console.log(JSON.stringify({ roundTrips: readBack === name, text, readBack }));

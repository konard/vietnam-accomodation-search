// Collects Telegram preview sources through the app's own collector with
// debug logging and prints when each page request starts and loads.
// Usage: DATA_DIRECTORY=$(mktemp -d) node experiments/issue-96-telegram-source.mjs telegram:danang_arend [more ids]
// Given a number N as the only argument, the first N default Telegram sources run.
import {
  createApplication,
  DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
  DEFAULT_TELEGRAM_SOURCES,
} from '../src/index.js';

const ids = process.argv.slice(2);
const started = Date.now();
const stamp = () => ((Date.now() - started) / 1000).toFixed(1);
const logger = {
  debug: (message, error) =>
    console.error(stamp(), message, error?.message || ''),
};
const application = createApplication({ environment: process.env, logger });
const { collector } = application;
const navigate = collector.navigate.bind(collector);
collector.navigate = async (commander, url, options) => {
  console.error(stamp(), 'queued', url);
  try {
    await navigate(commander, url, options);
    console.error(stamp(), 'loaded', url);
  } catch (error) {
    console.error(stamp(), 'failed', url, error.message);
    throw error;
  }
};
const all = [
  ...DEFAULT_TELEGRAM_SOURCES,
  ...DEFAULT_NHA_TRANG_TELEGRAM_SOURCES,
];
const sources = /^\d+$/u.test(ids[0] || '')
  ? all.slice(0, Number(ids[0]))
  : all.filter(({ id }) => ids.includes(id));
const report = await collector.collectWithReport(sources, '');
console.log(
  JSON.stringify({ elapsedMs: Date.now() - started, ...report.summary })
);

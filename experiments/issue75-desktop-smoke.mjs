// Smoke the packaged desktop with its sandbox and CSP intact. Run under Xvfb
// on Linux; no external page, Telegram account, or credential is accessed.
import { _electron as electron } from 'playwright';
import { resolve } from 'node:path';
const executablePath = resolve(
  'examples/universal-app/out/linux-unpacked/universal-example-app'
);
const application = await electron.launch({
  chromiumSandbox: true,
  executablePath,
  timeout: 30_000,
  env: { ...process.env, ELECTRON_RENDERER_URL: '' },
});
try {
  const window = await application.firstWindow();
  await window.getByText('Addition', { exact: true }).waitFor();
  const evidence = await application.evaluate(({ BrowserWindow }) => {
    const preferences =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      version: process.versions.electron,
      contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration,
      sandbox: preferences.sandbox,
    };
  });
  if (
    !evidence.sandbox ||
    !evidence.contextIsolation ||
    evidence.nodeIntegration
  ) {
    throw new Error('Desktop security preferences changed.');
  }
  console.log(JSON.stringify(evidence));
} finally {
  await application.close();
}

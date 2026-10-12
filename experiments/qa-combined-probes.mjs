// Installed only in the uniquely marked manual two-account runtime subprocess.
import assert from 'node:assert/strict';
import { durableWrite } from '../src/link-cli-mirror.js';
import { withDeadline } from './qa-deadline.mjs';

export function installCombinedProbes({ marker, owner, path }) {
  globalThis[Symbol.for('vac.qa.capabilityBoundary')] = (bot, { user }) => {
    assert(user, 'Scoped combined probes require the native runtime.');
    bot.use(async (context, next) => {
      if (
        String(context.chat?.id) !== String(owner) ||
        context.message?.text !== `/qa_transport_${marker}`
      ) {
        return next();
      }
      const proof = {
        version: 1,
        marker,
        independentActor: false,
        crossAccountAcceptance: false,
        botApiIngress: true,
        nativeSelfUpdate: false,
      };
      await durableWrite(path, JSON.stringify(proof));
      let subscription;
      let completed = false;
      try {
        await withDeadline(
          async () => {
            const signal = AbortSignal.timeout(15000);
            const botIdentity = await bot.api.getMe();
            const identity = await user.identity();
            assert.equal(
              String(identity.id),
              String(owner),
              'Native owner changed'
            );
            proof.nativeIdentity = true;
            const source = {
              id: `telegram:peer:${botIdentity.id}`,
              peerId: botIdentity.id,
            };
            const token = `native-probe:${marker}`;
            subscription = await user.liveUpdates(
              (event) => {
                if (event.message?.text?.includes(token)) {
                  proof.nativeSelfUpdate = true;
                }
              },
              { sources: [source], signal }
            );
            signal.throwIfAborted();
            const receipt = await user.send(
              Number(botIdentity.id),
              `${token}\n${marker}`
            );
            proof.nativeEgress = Number.isSafeInteger(receipt.id);
            for await (const message of await user.history(source, {
              since: new Date(Date.now() - 60000),
              signal,
            })) {
              if (message.text.includes(token)) {
                proof.nativeHistory = true;
                break;
              }
            }
            signal.throwIfAborted();
            await durableWrite(path, JSON.stringify(proof));
            await context.reply('Scoped transport probe recorded.');
            completed = true;
            proof.botApiEgress = true;
            await durableWrite(path, JSON.stringify(proof));
          },
          15000,
          'scoped transport probes'
        );
      } finally {
        await subscription?.stop();
        if (!completed) {
          await user.destroy();
        }
      }
    });
  };
  return () => delete globalThis[Symbol.for('vac.qa.capabilityBoundary')];
}

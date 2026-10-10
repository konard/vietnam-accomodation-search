// Private-chat QA send tracking and paged independent cleanup verification.
// No credential, original message body or numeric identity is logged.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const idOf = (message) => Number(message?.message_id ?? message?.id ?? 0);
const textOf = (message) =>
  String(message?.message ?? message?.text ?? message?.caption ?? '');
const exists = (message) =>
  !['MessageEmpty', 'MessageService'].includes(message?.className);

export class QaOwnedMessages {
  constructor({ marker, baseline = 0, journal }) {
    assert(/^qa-[a-z0-9-]{8,100}$/u.test(marker), 'Unique QA marker required.');
    this.marker = marker;
    this.baseline = baseline;
    this.journal = journal;
    this.ids = new Set();
    // Bot API chat-local IDs and the MTProto driver's account-global IDs
    // are different namespaces. Never use Bot API IDs for driver deletion.
    this.botIds = new Set();
    this.writes = Promise.resolve();
  }

  async save() {
    if (this.journal) {
      const content = JSON.stringify({
        marker: this.marker,
        baseline: this.baseline,
        ids: [...this.ids],
        botIds: [...this.botIds],
      });
      this.writes = this.writes.then(() =>
        writeFile(this.journal, content, { mode: 0o600 })
      );
      await this.writes;
    }
  }

  async record(messages) {
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      if (idOf(message) > 0) {
        this.ids.add(idOf(message));
      }
    }
    await this.save();
  }

  owns(message) {
    return (
      exists(message) &&
      idOf(message) > this.baseline &&
      (this.ids.has(idOf(message)) || textOf(message).includes(this.marker))
    );
  }

  install(api, owner) {
    api.config.use(async (previous, method, payload, signal) => {
      let outgoing = payload;
      if (method.startsWith('send')) {
        assert.equal(
          String(payload.chat_id),
          String(owner),
          'QA owner-only send'
        );
        outgoing = { ...payload };
        if ('text' in payload) {
          outgoing.text = `${this.marker}\n${payload.text}`;
        } else if (Array.isArray(payload.media)) {
          outgoing.media = payload.media.map((media) => ({
            ...media,
            caption: `${this.marker}\n${media.caption || ''}`,
          }));
        } else {
          outgoing.caption = `${this.marker}\n${payload.caption || ''}`;
        }
        // Persist the recovery marker before a potentially ambiguous send.
        await this.save();
      }
      const response = await previous(method, outgoing, signal);
      if (method.startsWith('send') && response.ok) {
        for (const message of Array.isArray(response.result)
          ? response.result
          : [response.result]) {
          if (idOf(message) > 0) {
            this.botIds.add(idOf(message));
          }
        }
        await this.save();
      }
      return response;
    });
  }

  async cleanup({ read, remove, attempts = 3 }) {
    let deleted = 0;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const found = (await read()).filter((message) => this.owns(message));
      if (!found.length) {
        // A successful send can be absent from history only if already deleted;
        // the independent, fully paged reader is the acceptance oracle.
        return { pass: true, deleted, leftovers: 0 };
      }
      await this.record(found);
      for (let index = 0; index < found.length; index += 100) {
        const ids = found.slice(index, index + 100).map(idOf);
        try {
          await remove(ids);
          deleted += ids.length;
        } catch {
          // Retry after independent readback, not after trusting an ACK.
        }
      }
    }
    const leftovers = (await read()).filter((message) =>
      this.owns(message)
    ).length;
    return { pass: leftovers === 0, deleted, leftovers };
  }

  static async restore(journal) {
    const saved = JSON.parse(await readFile(journal, 'utf8'));
    const ledger = new QaOwnedMessages({ ...saved, journal });
    saved.ids.forEach((id) => ledger.ids.add(id));
    (saved.botIds || []).forEach((id) => ledger.botIds.add(id));
    return ledger;
  }
}

export async function readQaHistory(client, target, baseline = 0) {
  const messages = [];
  let offsetId = 0;
  while (true) {
    const page = [
      ...(await client.getMessages(target, {
        limit: 100,
        minId: baseline,
        offsetId,
      })),
    ];
    if (!page.length) {
      return messages;
    }
    messages.push(...page.filter((message) => idOf(message) > baseline));
    const next = Math.min(...page.map(idOf).filter((id) => id > 0));
    if (!Number.isFinite(next) || (offsetId && next >= offsetId)) {
      throw new Error('QA history pagination did not advance.');
    }
    if (next <= baseline) {
      return messages;
    }
    offsetId = next;
  }
}

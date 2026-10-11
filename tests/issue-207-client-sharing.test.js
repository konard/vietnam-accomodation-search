import assert from 'node:assert/strict';
import { it } from 'test-anywhere';
import { MtcuteTelegramProvider } from '../src/telegram-mtcute.js';
import { TelegramAvailabilityService } from '../src/telegram-user.js';
import { TelegramAuthService } from '../src/telegram-auth.js';
import { createApplication } from '../src/application.js';

const emitter = () => ({
  listeners: new Set(),
  add(fn) {
    this.listeners.add(fn);
  },
  remove(fn) {
    this.listeners.delete(fn);
  },
  async emit(message) {
    await Promise.all([...this.listeners].map((fn) => fn(message)));
  },
});

function fixture(configure = () => {}) {
  const clients = [];
  let active;
  const clientFactory = async () => {
    const client = {
      onNewMessage: emitter(),
      onEditMessage: emitter(),
      onDeleteMessage: emitter(),
      async start() {
        active = this;
      },
      async importSession() {
        active = this;
      },
      async sendText() {
        active = this;
        this.sentCount = (this.sentCount || 0) + 1;
        return { id: 13 };
      },
      async getMe() {
        return { id: 99 };
      },
      async resolvePeer() {
        active = this;
        return { _: 'inputPeerChannel', channelId: 7 };
      },
      async destroy() {
        this.destroyed = true;
      },
    };
    configure(client, clients.length);
    clients.push(client);
    return client;
  };
  const create = (options = {}) =>
    new MtcuteTelegramProvider({
      apiId: 12,
      apiHash: 'self-authored',
      session: 'self-authored-session',
      clientFactory,
      ...options,
    });
  const emit = () =>
    active.onNewMessage.emit({
      id: 8,
      chat: { id: -1000000000007 },
      text: 'self-authored event',
    });
  return { clients, create, emit, clientFactory };
}

it('keeps live routing on one transport when same-session secondary providers connect and close', async () => {
  const { clients, create, emit } = fixture();
  const primary = create();
  const secondary = create();
  const events = [];
  const sources = [{ id: 'telegram:fixture' }];
  try {
    await primary.liveUpdates((event) => events.push(event), { sources });
    await secondary.identity();
    await secondary.resolveEntity('@self_authored');
    await emit();
    assert.equal(
      events.length,
      1,
      'overlapping secondary must not take the active event stream'
    );
    assert.equal(clients.length, 1);
    await secondary.destroy();
    assert.equal(clients[0].destroyed, undefined);
    await emit();
    assert.equal(events.length, 2);
  } finally {
    await Promise.all([primary.destroy(), secondary.destroy()]);
  }
  assert.equal(clients[0].destroyed, true);
  assert.equal(clients[0].onNewMessage.listeners.size, 0);
});

it('shares standalone availability, identity validation and revocation with a native listener', async () => {
  const { clients, create, emit, clientFactory } = fixture((client) => {
    client.logOut = async () => {};
  });
  const primary = create();
  const settings = {
    apiId: 12,
    apiHash: 'self-authored',
    session: 'self-authored-session',
    clientFactory,
  };
  const availability = new TelegramAvailabilityService({
    ...settings,
    store: {
      listOffers: async () => [
        { id: 'fixture', contacts: { telegram: ['self_authored'] } },
      ],
    },
  });
  const auth = new TelegramAuthService({ ...settings, expectedUserId: 99 });
  let received = 0;
  try {
    await primary.liveUpdates(
      () => {
        received += 1;
      },
      { sources: [{ id: 'telegram:fixture' }] }
    );
    await availability.check('fixture');
    await auth.validate();
    await emit();
    assert.equal(received, 1);
    assert.equal(clients.length, 1);
    assert.equal(clients[0].destroyed, undefined);
    await auth.logout();
    assert.equal(clients.length, 1);
  } finally {
    await primary.destroy();
  }
  assert.equal(clients[0].destroyed, true);
});

it('starts native update processing when validation opens the shared transport before ingestion', async () => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const { clients, create, emit, clientFactory } = fixture((client) => {
    let identityReads = 0;
    let updatesStarted = false;
    const originalEmit = client.onNewMessage.emit;
    client.onNewMessage.emit = (message) =>
      updatesStarted
        ? originalEmit.call(client.onNewMessage, message)
        : undefined;
    client.startUpdatesLoop = async () => {
      updatesStarted = true;
    };
    client.getMe = async () => {
      if (++identityReads === 2) {
        entered();
        await gate;
      }
      return { id: 99 };
    };
  });
  const auth = new TelegramAuthService({
    apiId: 12,
    apiHash: 'self-authored',
    session: 'self-authored-session',
    clientFactory,
    expectedUserId: 99,
  });
  const validating = auth.validate();
  const provider = create();
  let received = 0;
  try {
    await ready;
    await provider.liveUpdates(
      () => {
        received += 1;
      },
      { sources: [{ id: 'telegram:fixture' }] }
    );
    await emit();
    assert.equal(
      received,
      1,
      'an authenticated transport must also process updates'
    );
    assert.equal(clients.length, 1);
  } finally {
    finish();
    await validating;
    await provider.destroy();
  }
  assert.equal(clients[0].destroyed, true);
});

it('joins listener registration before destruction and leaves no late listeners', async () => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const { clients, create } = fixture((client) => {
    client.resolvePeer = async () => {
      entered();
      await gate;
      return { _: 'inputPeerChannel', channelId: 7 };
    };
  });
  const provider = create();
  const registration = provider.liveUpdates(() => {}, {
    sources: [{ id: 'telegram:fixture' }],
  });
  await ready;
  const closing = provider.destroy();
  finish();
  await Promise.all([registration, closing]);
  assert.equal(clients[0].destroyed, true);
  assert.equal(clients[0].onNewMessage.listeners.size, 0);
});

it('retries a quiesced failed opening but blocks a transport whose cleanup failed', async () => {
  for (const failCleanup of [false, true]) {
    const { clients, create } = fixture((client, index) => {
      if (index === 0) {
        client.start = async () => {
          throw new Error('self-authored connection failure');
        };
        if (failCleanup) {
          client.destroy = async () => {
            throw new Error('self-authored teardown failure');
          };
        }
      }
    });
    const primary = create();
    const secondary = create();
    try {
      await assert.rejects(primary.identity());
      if (failCleanup) {
        await assert.rejects(secondary.identity(), {
          code: 'TELEGRAM_CLIENT_CLEANUP_FAILED',
        });
        assert.equal(clients.length, 1);
      } else {
        await secondary.identity();
        assert.equal(clients.length, 2);
        assert.equal(clients[0].destroyed, true);
      }
    } finally {
      await Promise.all([primary.destroy(), secondary.destroy()]);
    }
  }
});

it('does not replace a transport after final lease teardown fails', async () => {
  const { clients, create } = fixture((client) => {
    client.destroy = async () => {
      throw new Error('self-authored final teardown failure');
    };
  });
  const first = create();
  await first.identity();
  await assert.rejects(first.destroy(), /final teardown failure/u);
  const second = create();
  await assert.rejects(second.identity(), /final teardown failure/u);
  assert.equal(clients.length, 1);
  await second.destroy();
});

it('joins successful teardown before reconnecting providers and registering new listeners', async () => {
  let finish;
  const gate = new Promise((resolve) => {
    finish = resolve;
  });
  let entered;
  const ready = new Promise((resolve) => {
    entered = resolve;
  });
  const { clients, create, emit } = fixture((client, index) => {
    if (index === 0) {
      client.destroy = async () => {
        entered();
        await gate;
        client.destroyed = true;
      };
    }
  });
  const first = create();
  const second = create();
  await first.identity();
  const closing = first.destroy();
  await ready;
  const reconnecting = Promise.all([first.identity(), second.identity()]);
  let received = 0;
  const registration = first.liveUpdates(
    () => {
      received += 1;
    },
    {
      sources: [{ id: 'telegram:fixture' }],
    }
  );
  assert.equal(clients.length, 1);
  finish();
  try {
    await Promise.all([closing, reconnecting, registration]);
    assert.equal(clients.length, 2);
    assert.equal(clients[0].destroyed, true);
    await emit();
    assert.equal(received, 1);
  } finally {
    await Promise.all([first.destroy(), second.destroy()]);
  }
  assert.equal(clients[1].destroyed, true);
  assert.equal(clients[1].onNewMessage.listeners.size, 0);
});

it('preserves identity mismatch and teardown errors when releasing a rejected lease', async () => {
  const { create } = fixture((client) => {
    client.destroy = async () => {
      throw new Error('self-authored cleanup failure');
    };
  });
  const provider = create({ expectedUserId: 100 });
  await assert.rejects(provider.identity(), (error) => {
    assert(error instanceof AggregateError);
    assert.match(error.errors[0].message, /identity mismatch/u);
    assert.match(error.errors[1].message, /cleanup failure/u);
    assert.equal(error.cause, error.errors[1]);
    return true;
  });
  await provider.destroy();
});

it('wires application ingestion and standalone availability to the injected shared factory', async () => {
  const { clients, clientFactory } = fixture((client, index) => {
    if (index > 0) {
      client.getMe = async () => ({ id: 100 });
    }
  });
  const credentials = {
    apiId: 12,
    apiHash: 'self-authored',
    session: 'self-authored-session',
  };
  const application = createApplication({
    environment: { TELEGRAM_EXPECTED_USER_ID: '99' },
    mtcuteClientFactory: clientFactory,
    store: {
      listOffers: async () => [
        { id: 'fixture', contacts: { telegram: ['self_authored'] } },
      ],
    },
    mediaCache: { retries: {} },
    collector: {},
    registry: {},
  });
  const ingestion = application.createTelegramIngestionService(credentials);
  const availability = application.createAvailabilityService(credentials);
  try {
    await ingestion.provider.identity();
    await availability.check('fixture');
    await availability.check('fixture');
    assert.equal(clients.length, 1);
    assert.equal(clients[0].sentCount, 2);
    assert.equal(clients[0].destroyed, undefined);
    const wrongPin = application.createAvailabilityService({
      ...credentials,
      apiId: 13,
    });
    await assert.rejects(wrongPin.check('fixture'), /identity mismatch/u);
  } finally {
    await ingestion.provider.destroy();
  }
  assert.equal(clients[0].destroyed, true);
});

it('deduplicates concurrent connection acquisition and validates every owner pin', async () => {
  const { clients, create } = fixture();
  const first = create({ expectedUserId: 99 });
  const second = create({ expectedUserId: 99 });
  const mismatch = create({ expectedUserId: 100 });
  try {
    await Promise.all([first.identity(), second.identity()]);
    assert.equal(clients.length, 1);
    await assert.rejects(mismatch.identity(), /identity mismatch/u);
    assert.equal(clients[0].destroyed, undefined);
    await first.destroy();
    assert.equal(clients[0].destroyed, undefined);
    await second.destroy();
    assert.equal(clients[0].destroyed, true);
    await first.identity();
    assert.equal(clients.length, 2);
  } finally {
    await Promise.all([first.destroy(), second.destroy(), mismatch.destroy()]);
  }
});

it('removes only the closing provider listeners and never pools distinct sessions', async () => {
  const { clients, create, emit } = fixture();
  const first = create();
  const second = create();
  const different = create({ session: 'different-self-authored-session' });
  let received = 0;
  try {
    const sources = [{ id: 'telegram:fixture' }];
    await first.liveUpdates(() => {}, { sources });
    await second.liveUpdates(
      () => {
        received += 1;
      },
      { sources }
    );
    await first.destroy();
    await emit();
    assert.equal(received, 1);
    assert.equal(clients[0].onNewMessage.listeners.size, 1);
    await different.identity();
    assert.equal(clients.length, 2);
  } finally {
    await Promise.all([first.destroy(), second.destroy(), different.destroy()]);
  }
});

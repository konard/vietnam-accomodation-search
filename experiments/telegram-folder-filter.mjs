// Telegram API folder IDs 0 and 1 mean active and archived. Custom filters
// combine explicit peers with client-side category and exclusion rules.
// eslint-disable-next-line complexity -- Identity must distinguish all Telegram peer constructor shapes.
function identity(peer) {
  const type = String(
    peer?._ || peer?.className || peer?.constructor?.name || ''
  ).toLowerCase();
  const kind =
    peer?.channelId !== undefined || /channel/u.test(type)
      ? 'channel'
      : peer?.chatId !== undefined || /chat/u.test(type)
        ? 'chat'
        : 'user';
  return `${kind}:${peer?.channelId ?? peer?.chatId ?? peer?.userId ?? peer?.id}`;
}
// eslint-disable-next-line complexity -- One predicate follows Telegram's explicit inclusion and exclusion precedence.
export function folderContainsDialog(filter, dialog) {
  const entity = dialog.entity;
  const key = identity(entity);
  if ((filter.excludePeers || []).some((peer) => identity(peer) === key)) {
    return false;
  }
  if (
    [...(filter.pinnedPeers || []), ...(filter.includePeers || [])].some(
      (peer) => identity(peer) === key
    )
  ) {
    return true;
  }
  const type = String(
    entity?._ || entity?.className || entity?.constructor?.name || ''
  ).toLowerCase();
  const group = /chat/u.test(type) || entity?.megagroup;
  const selected = group
    ? filter.groups
    : /channel/u.test(type)
      ? filter.broadcasts
      : entity?.bot
        ? filter.bots
        : entity?.contact
          ? filter.contacts
          : filter.nonContacts;
  const muted =
    dialog.isMuted ||
    Number(
      dialog.notifySettings?.muteUntil ||
        dialog.dialog?.notifySettings?.muteUntil ||
        0
    ) >
      Date.now() / 1000;
  const read =
    Number(dialog.unreadCount ?? dialog.dialog?.unreadCount ?? 0) === 0;
  const archived = (dialog.folderId ?? dialog.dialog?.folderId) === 1;
  return Boolean(
    selected &&
    !(filter.excludeMuted && muted) &&
    !(filter.excludeRead && read) &&
    !(filter.excludeArchived && archived)
  );
}
export function folderUsesCategories(filter) {
  return ['groups', 'broadcasts', 'bots', 'contacts', 'nonContacts'].some(
    (key) => filter[key]
  );
}

/**
 * Show Telegram typing indicator while async work runs.
 * @param {import('telegraf').Telegram} telegram
 * @param {number} chatId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTyping(telegram, chatId, fn) {
  if (telegram && chatId) {
    await telegram.sendChatAction(chatId, 'typing').catch(() => {});
  }
  return fn();
}

module.exports = { withTyping };

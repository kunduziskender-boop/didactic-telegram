const store = require('../store');
const { generateSupportReply, resetSupportChat, getFallback, canRouteToSupport } = require('../services/support');
const { withTyping } = require('../services/typing');

async function replyMarkdownSafe(ctx, text) {
  try {
    await ctx.reply(text, { parse_mode: 'Markdown' });
  } catch {
    await ctx.reply(text.replace(/\*\*/g, ''));
  }
}

async function handleReset(ctx) {
  const telegramId = ctx.from.id;
  store.ensureUser(telegramId);
  resetSupportChat(telegramId);
  await replyMarkdownSafe(ctx, getFallback('reset_ok'));
}

/**
 * @returns {Promise<boolean>} true if message was handled
 */
async function handleSupportMessage(ctx) {
  const text = ctx.message?.text?.trim();
  if (!text || text.startsWith('/')) return false;

  const telegramId = ctx.from.id;
  if (!canRouteToSupport(telegramId)) return false;

  store.ensureUser(telegramId);

  const result = await withTyping(ctx.telegram, ctx.chat.id, () => generateSupportReply(
    telegramId,
    text,
  ));

  await replyMarkdownSafe(ctx, result.text);
  return true;
}

module.exports = {
  handleReset,
  handleSupportMessage,
  resetSupportChat,
};

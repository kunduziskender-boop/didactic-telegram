const fs = require('fs');

function isVoiceForbidden(err) {
  const desc = err?.response?.description || err?.message || '';
  return desc.includes('VOICE_MESSAGES_FORBIDDEN');
}

function openStream(filePath) {
  return { source: fs.createReadStream(filePath) };
}

/**
 * Send TTS mp3 as voice note; fall back to audio file if Telegram blocks voice messages.
 * @returns {'voice'|'audio'|null}
 */
async function sendCorrectedAudio(ctx, filePath, options = {}) {
  const { caption, title = 'Corrected answer' } = options;

  try {
    await ctx.replyWithVoice(openStream(filePath));
    return 'voice';
  } catch (err) {
    if (!isVoiceForbidden(err)) throw err;
  }

  try {
    const extra = caption ? { caption } : undefined;
    await ctx.replyWithAudio({ ...openStream(filePath), title }, extra);
    return 'audio';
  } catch (err) {
    console.error('Audio fallback failed:', err.message);
    if (caption) await ctx.reply(caption);
    return null;
  }
}

/**
 * @param {import('telegraf').Telegram} telegram
 * @returns {'voice'|'audio'|null}
 */
async function sendCorrectedAudioToUser(telegram, chatId, filePath, options = {}) {
  const { title = 'Daily task' } = options;

  try {
    await telegram.sendVoice(chatId, openStream(filePath));
    return 'voice';
  } catch (err) {
    if (!isVoiceForbidden(err)) throw err;
  }

  try {
    await telegram.sendAudio(chatId, { ...openStream(filePath), title });
    return 'audio';
  } catch (err) {
    console.error('Task audio fallback failed:', err.message);
    return null;
  }
}

module.exports = {
  sendCorrectedAudio,
  sendCorrectedAudioToUser,
  isVoiceForbidden,
};

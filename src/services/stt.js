const fs = require('fs');
const { toFile } = require('openai/uploads');
const path = require('path');
const config = require('../config');
const { getOpenAIClient, isRecoverableAiError, isQuotaError } = require('./openaiClient');

/**
 * @param {string} audioPath
 * @returns {Promise<{ text: string, demo: boolean, voiceOnly?: boolean, fallbackReason?: string }>}
 */
async function transcribe(audioPath) {
  if (config.demoMode) {
    return { text: '', demo: true, voiceOnly: true, fallbackReason: 'demo' };
  }

  if (!config.sttEnabled) {
    console.log('Whisper skipped — STT disabled (set WHISPER_ENABLED=true in .env)');
    return { text: '', demo: true, voiceOnly: true, fallbackReason: 'no_stt' };
  }

  const openai = getOpenAIClient();
  if (!openai) {
    return { text: '', demo: true, voiceOnly: true, fallbackReason: 'no_stt' };
  }

  try {
    const ext = path.extname(audioPath) || '.ogg';
    const file = await toFile(fs.createReadStream(audioPath), `response${ext}`);

    const result = await openai.audio.transcriptions.create({
      file,
      model: 'whisper-1',
      language: 'en',
    });
    return { text: result.text.trim(), demo: false };
  } catch (err) {
    console.error('Whisper error:', err.message);
    if (isRecoverableAiError(err)) {
      return {
        text: '',
        demo: true,
        voiceOnly: true,
        fallbackReason: isQuotaError(err) ? 'quota' : 'connection',
      };
    }
    throw err;
  }
}

module.exports = { transcribe };

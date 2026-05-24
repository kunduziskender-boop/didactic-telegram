const fs = require('fs');
const path = require('path');
const config = require('../config');
const { getTtsInstructions } = require('../data/englishLocale');
const { getOpenAIClient, isRecoverableAiError } = require('./openaiClient');
const { ensureDir } = require('./audio');

/**
 * @param {string} text
 * @param {string} outputPath
 */
async function synthesize(text, outputPath) {
  ensureDir(path.dirname(outputPath));

  if (config.demoMode || !text || !config.ttsEnabled) {
    return null;
  }

  if (config.elevenLabsApiKey) {
    try {
      const res = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
        method: 'POST',
        headers: {
          'xi-api-key': config.elevenLabsApiKey,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
        }),
      });
      if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(outputPath, buffer);
      return outputPath;
    } catch (err) {
      console.error('ElevenLabs TTS error:', err.message);
      return null;
    }
  }

  const openai = getOpenAIClient();
  if (!openai) return null;

  try {
    const speechParams = {
      model: config.openaiTtsModel,
      voice: config.openaiTtsVoice,
      input: text,
    };
    const instructions = getTtsInstructions(config.englishVariant);
    if (instructions && config.openaiTtsModel.includes('mini-tts')) {
      speechParams.instructions = instructions;
    }
    const mp3 = await openai.audio.speech.create(speechParams);
    const buffer = Buffer.from(await mp3.arrayBuffer());
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  } catch (err) {
    console.error('OpenAI TTS error:', err.message);
    if (isRecoverableAiError(err)) return null;
    throw err;
  }
}

module.exports = { synthesize };

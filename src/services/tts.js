const fs = require('fs');
const path = require('path');
const config = require('../config');
const {
  getTtsInstructions,
  isSteerableTtsModel,
  prepareSpeechText,
} = require('../data/englishLocale');
const { getOpenAIClient, isRecoverableAiError } = require('./openaiClient');
const { ensureDir } = require('./audio');

let ttsModelWarningShown = false;

function resolveTtsModel(requestedModel) {
  if (isSteerableTtsModel(requestedModel)) return requestedModel;

  if (config.englishVariant === 'british' && !ttsModelWarningShown) {
    console.warn(
      `TTS: ${requestedModel} не поддерживает британский акцент (instructions). `
      + 'Использую gpt-4o-mini-tts. Задай OPENAI_TTS_MODEL=gpt-4o-mini-tts в .env.',
    );
    ttsModelWarningShown = true;
  }

  return isSteerableTtsModel(requestedModel) ? requestedModel : 'gpt-4o-mini-tts';
}

/**
 * @param {string} text
 * @param {string} outputPath
 */
async function synthesize(text, outputPath) {
  ensureDir(path.dirname(outputPath));

  if (config.demoMode || !text || !config.ttsEnabled) {
    return null;
  }

  const speechText = prepareSpeechText(text, config.englishVariant);

  if (config.elevenLabsApiKey) {
    try {
      const res = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': config.elevenLabsApiKey,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg',
          },
          body: JSON.stringify({
            text: speechText,
            model_id: 'eleven_multilingual_v2',
            language_code: config.englishVariant === 'british' ? 'en' : 'en',
          }),
        },
      );
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
    const model = resolveTtsModel(config.openaiTtsModel);
    const speechParams = {
      model,
      voice: config.openaiTtsVoice,
      input: speechText,
    };

    const instructions = getTtsInstructions(config.englishVariant);
    if (instructions && isSteerableTtsModel(model)) {
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

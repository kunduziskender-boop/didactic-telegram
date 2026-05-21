require('dotenv').config();
const path = require('path');

const hasDeepSeek = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY?.trim());
const useOpenAiEnv = process.env.USE_OPENAI?.trim().toLowerCase();

const whisperEnv = process.env.WHISPER_ENABLED?.trim().toLowerCase();

// Whisper (STT) отдельно от TTS: DeepSeek для текста, OpenAI только для распознавания голоса
const sttEnabled = hasOpenAiKey && (
  useOpenAiEnv === 'true'
  || whisperEnv === 'true'
);
const ttsEnabled = hasOpenAiKey && useOpenAiEnv === 'true';

const config = {
  botToken: process.env.BOT_TOKEN,
  openaiApiKey: process.env.OPENAI_API_KEY || '',
  openaiBaseUrl: process.env.OPENAI_BASE_URL || '',
  httpsProxy: process.env.HTTPS_PROXY || process.env.HTTP_PROXY || '',
  demoMode: process.env.DEMO_MODE === 'true',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY || '',
  audioRoot: path.resolve(process.env.AUDIO_ROOT || './data/audio'),
  databaseUrl: process.env.DATABASE_URL || './data/bot.db',
  timezone: process.env.DEFAULT_TIMEZONE || 'Europe/Moscow',
  morningDrillHour: Number(process.env.MORNING_DRILL_HOUR ?? 9),
  morningDrillMinute: Number(process.env.MORNING_DRILL_MINUTE ?? 0),
  eveningReminderHour: Number(process.env.EVENING_REMINDER_HOUR ?? 20),
  eveningReminderMinute: Number(process.env.EVENING_REMINDER_MINUTE ?? 0),
  sttEnabled,
  ttsEnabled,
  openaiEnabled: sttEnabled || ttsEnabled,
};

if (!config.botToken) {
  throw new Error('BOT_TOKEN is required in .env');
}

module.exports = config;
const { Telegraf } = require('telegraf');
const { message } = require('telegraf/filters');
const config = require('./config');
const { getEnglishLocaleLabel } = require('./data/englishLocale');
const { CB } = require('./keyboards');
const { handleStart, handleChangeLevel, handleLevelCallback, handleTopicCallback } = require('./handlers/onboarding');
const { handleDrillCommand, handleCallback, handleVoice, handleDrillText, extractVoiceFile } = require('./handlers/drill');
const { handleStats, handleHelp, handleWeeklyTest, handlePhrases } = require('./handlers/commands');
const { handleWordsCommand, handleVocabCallback } = require('./handlers/vocab');
const { handleTalkCommand, handleTalkCallback, handleDialogueMessage, handleDialogueVoice } = require('./handlers/dialogue');
const { handleReset, handleSupportMessage } = require('./handlers/support');
const { startScheduler } = require('./scheduler/jobs');
const { registerBotCommands } = require('./bot/commands');

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 5)) {
    console.error(`Node.js ${process.versions.node} — нужен 22.5 или новее.`);
    console.error('Скачай LTS: https://nodejs.org');
    process.exit(1);
  }
}

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

function createBot() {
  const bot = new Telegraf(config.botToken);

  bot.start(handleStart);
  bot.command('reset', handleReset);
  bot.command('level', handleChangeLevel);
  bot.command('drill', handleDrillCommand);
  bot.command('stats', handleStats);
  bot.command('phrases', handlePhrases);
  bot.command('words', handleWordsCommand);
  bot.command('talk', handleTalkCommand);
  bot.command('help', handleHelp);
  bot.command('weekly', handleWeeklyTest);

  bot.action(new RegExp(`^${CB.LEVEL}`), handleLevelCallback);
  bot.action(new RegExp(`^${CB.TOPIC}`), handleTopicCallback);

  bot.action(
    new RegExp(`^(${CB.READY}|${CB.SKIP}|${CB.REMIND_NOW}|${CB.SHADOW}|${CB.DONE}|${CB.SKIP_SHADOW}|${CB.SKIP_FOLLOWUP}|${CB.SKIP_TEXT_CHECK})$`),
    handleCallback,
  );

  bot.action(/^vocab:/, handleVocabCallback);
  bot.action(/^talk:/, handleTalkCallback);

  bot.on(message('voice'), async (ctx) => {
    const voiceFile = extractVoiceFile(ctx);
    if (voiceFile && await handleDialogueVoice(ctx, voiceFile)) return;
    return handleVoice(ctx);
  });
  bot.on(message('audio'), async (ctx) => {
    const voiceFile = extractVoiceFile(ctx);
    if (voiceFile && await handleDialogueVoice(ctx, voiceFile)) return;
    return handleVoice(ctx);
  });
  bot.on(message('text'), async (ctx) => {
    const text = ctx.message?.text?.trim();
    if (await handleDialogueMessage(ctx, text)) return;
    if (await handleDrillText(ctx)) return;
    if (await handleSupportMessage(ctx)) return;
  });

  bot.catch((err, ctx) => {
    console.error('Bot error:', err);
    ctx.reply('Произошла ошибка. Попробуй ещё раз или /help').catch(() => {});
  });

  return bot;
}

async function main() {
  checkNodeVersion();

  const bot = createBot();
  startScheduler(bot);

  console.log('AI mode:', config.demoMode
    ? 'DEMO'
    : [
      config.openaiLlmEnabled ? `OpenAI LLM (${config.llmModel})` : null,
      config.deepseekLlmEnabled ? 'DeepSeek LLM' : null,
      config.sttEnabled ? 'Whisper STT' : null,
      config.ttsEnabled
        ? `OpenAI TTS (${config.openaiTtsModel}/${config.openaiTtsVoice}, ${getEnglishLocaleLabel(config.englishVariant)})`
        : null,
    ].filter(Boolean).join(' + ') || 'no AI keys');

  console.log('Connecting to Telegram...');
  try {
    const me = await withTimeout(
      bot.telegram.getMe(),
      30000,
      'Telegram API не отвечает 30 сек. Проверь интернет или включи VPN.',
    );
    console.log(`Telegram OK: @${me.username}`);

    await registerBotCommands(bot);
    console.log('Bot commands registered');

    await bot.launch({ dropPendingUpdates: true });
  } catch (err) {
    if (String(err.message).includes('409')) {
      console.error('');
      console.error('409 Conflict — бот УЖЕ запущен в другом окне терминала.');
      console.error('Закрой другой npm start и попробуй снова.');
      console.error('');
    } else if (String(err.message).includes('401')) {
      console.error('');
      console.error('401 Unauthorized — неверный BOT_TOKEN в .env');
      console.error('Получи новый токен у @BotFather');
      console.error('');
    }
    throw err;
  }

  console.log('Bot is running. Press Ctrl+C to stop.');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start bot:', err.message || err);
  process.exit(1);
});
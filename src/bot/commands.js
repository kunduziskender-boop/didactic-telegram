/** Команды бота — отображаются в меню Telegram (кнопка «/»). */
const BOT_COMMANDS = [
  { command: 'start', description: 'Начать и выбрать уровень' },
  { command: 'level', description: 'Сменить уровень и тему' },
  { command: 'drill', description: 'Получить задание дня' },
  { command: 'talk', description: 'Role-play диалог по ситуации' },
  { command: 'phrases', description: 'Фразы из прошлых drill' },
  { command: 'words', description: 'Повторить слова в контексте' },
  { command: 'stats', description: 'Стрик и статистика' },
  { command: 'weekly', description: 'Обзор ошибок за неделю' },
  { command: 'help', description: 'Справка по боту' },
];

/**
 * @param {import('telegraf').Telegraf} bot
 */
async function registerBotCommands(bot) {
  await bot.telegram.setMyCommands(BOT_COMMANDS);
}

module.exports = { BOT_COMMANDS, registerBotCommands };

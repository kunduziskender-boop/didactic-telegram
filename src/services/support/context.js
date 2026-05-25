const config = require('../../config');
const { getEnglishLocaleLabel } = require('../../data/englishLocale');

function getProductContext() {
  const locale = getEnglishLocaleLabel(config.englishVariant);
  return `
ПРОДУКТ: Fluency Coach Bot (@DailyGabBot) — ежедневная практика разговорного английского в Telegram.
Язык практики: ${locale}.

КОМАНДЫ:
/start — онбординг / главное меню
/reset — сброс истории чата с support-ассистентом
/drill — задание дня (Prepare → голос/текст → feedback → follow-up → Shadow)
/talk — role-play диалог (4 реплики): кафе, отель, аэропорт, собеседование
/level — сменить уровень (A1–C1) и тему (бизнес, IT, путешествия, быт)
/phrases — сохранённые фразы из drill
/words — слова в контексте + интервальное повторение
/stats — стрик и статистика
/weekly — обзор типичных ошибок за неделю
/help — полная справка

ГОЛОС:
• Запись 5–15 секунд, громко, по теме
• Текстовый ответ точнее, чем голос (Whisper иногда ошибается)
• Если распознавание ненадёжно — бот не оценивает ответ как «неправильный»

ОГРАНИЧЕНИЯ:
• Support не проверяет английскую грамматику — для этого /drill или /talk
• Нет оплаты, звонков, свободного чата на любую тему
• Нет доступа к данным пользователя (стрик, ошибки) — направляй на /stats, /weekly
`.trim();
}

module.exports = { getProductContext };

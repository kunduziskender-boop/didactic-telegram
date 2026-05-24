const { Markup } = require('telegraf');
const { LEVELS, TOPICS } = require('../data/constants');

const CB = {
  LEVEL: 'lvl:',
  TOPIC: 'top:',
  READY: 'drill:ready',
  SKIP: 'drill:skip',
  REMIND_NOW: 'drill:remind_now',
  SHADOW: 'drill:shadow',
  DONE: 'drill:done',
  SKIP_SHADOW: 'drill:skip_shadow',
  SKIP_FOLLOWUP: 'drill:skip_followup',
  SKIP_TEXT_CHECK: 'drill:skip_text_check',
  VOCAB_SHOW: 'vocab:show',
  VOCAB_SKIP: 'vocab:skip',
  VOCAB_STOP: 'vocab:stop',
  VOCAB_RATE_AGAIN: 'vocab:rate:0',
  VOCAB_RATE_HARD: 'vocab:rate:1',
  VOCAB_RATE_GOOD: 'vocab:rate:2',
  TALK_RANDOM: 'talk:random',
  TALK_END: 'talk:end',
};

function levelKeyboard() {
  return Markup.inlineKeyboard(
    LEVELS.map((lvl) => Markup.button.callback(lvl, `${CB.LEVEL}${lvl}`)),
    { columns: 2 },
  );
}

function topicKeyboard() {
  return Markup.inlineKeyboard(
    TOPICS.map((t) => Markup.button.callback(t.label, `${CB.TOPIC}${t.id}`)),
    { columns: 2 },
  );
}

function taskDeliveredKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Готов', CB.READY),
    Markup.button.callback('⏭ Пропустить', CB.SKIP),
  ]);
}

function reminderKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('▶️ Выполнить сейчас', CB.REMIND_NOW),
    Markup.button.callback('⏭ Пропустить', CB.SKIP),
  ]);
}

function awaitingVoiceKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('⏭ Пропустить', CB.SKIP),
  ]);
}

function textCheckKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('⏭ Пропустить проверку', CB.SKIP_TEXT_CHECK),
  ]);
}

function followUpKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('⏭ Пропустить follow-up', CB.SKIP_FOLLOWUP),
  ]);
}

function correctionKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('🎧 Shadow', CB.SHADOW),
    Markup.button.callback('✅ Готово', CB.DONE),
  ]);
}

function shadowKeyboard() {
  return Markup.inlineKeyboard([
    Markup.button.callback('✅ Готово', CB.DONE),
  ]);
}

function vocabQuestionKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('👁 Показать ответ', CB.VOCAB_SHOW),
      Markup.button.callback('⏭ Пропустить', CB.VOCAB_SKIP),
    ],
    [Markup.button.callback('🛑 Стоп', CB.VOCAB_STOP)],
  ]);
}

function vocabAnswerKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback('😓 Забыл', CB.VOCAB_RATE_AGAIN),
      Markup.button.callback('🤔 Сложно', CB.VOCAB_RATE_HARD),
      Markup.button.callback('✅ Помню', CB.VOCAB_RATE_GOOD),
    ],
    [Markup.button.callback('🛑 Стоп', CB.VOCAB_STOP)],
  ]);
}

function dialogueScenarioKeyboard(scenarios) {
  const rows = scenarios.map((s) => [
    Markup.button.callback(s.titleRu, `talk:sc:${s.id}`),
  ]);
  rows.push([Markup.button.callback('🎲 Случайная ситуация', CB.TALK_RANDOM)]);
  return Markup.inlineKeyboard(rows);
}

function dialogueActiveKeyboard() {
  return Markup.inlineKeyboard([
    [Markup.button.callback('🛑 Завершить диалог', CB.TALK_END)],
  ]);
}

module.exports = {
  CB,
  levelKeyboard,
  topicKeyboard,
  taskDeliveredKeyboard,
  reminderKeyboard,
  awaitingVoiceKeyboard,
  followUpKeyboard,
  textCheckKeyboard,
  correctionKeyboard,
  shadowKeyboard,
  vocabQuestionKeyboard,
  vocabAnswerKeyboard,
  dialogueScenarioKeyboard,
  dialogueActiveKeyboard,
};

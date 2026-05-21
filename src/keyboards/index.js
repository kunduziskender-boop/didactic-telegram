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
};

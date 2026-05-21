const cron = require('node-cron');
const config = require('../config');
const store = require('../store');
const { sendDailyTask } = require('../services/drill');
const { generateWeeklyExercise } = require('../services/llm');
const { reminderKeyboard } = require('../keyboards');
const { DrillStates, getState } = require('../fsm/manager');

/**
 * @param {import('telegraf').Telegraf} bot
 */
function startScheduler(bot) {
  const morningCron = `${config.morningDrillMinute} ${config.morningDrillHour} * * *`;
  const eveningCron = `${config.eveningReminderMinute} ${config.eveningReminderHour} * * *`;

  cron.schedule(morningCron, () => sendMorningDrills(bot), {
    timezone: config.timezone,
  });

  cron.schedule(eveningCron, () => sendEveningReminders(bot), {
    timezone: config.timezone,
  });

  cron.schedule('0 10 * * 0', () => sendWeeklyReviews(bot), {
    timezone: config.timezone,
  });

  console.log(
    `Scheduler started (${config.timezone}): `
    + `morning ${config.morningDrillHour}:${String(config.morningDrillMinute).padStart(2, '0')}, `
    + `reminder ${config.eveningReminderHour}:${String(config.eveningReminderMinute).padStart(2, '0')}, `
    + 'weekly Sun 10:00',
  );
}

async function sendMorningDrills(bot) {
  for (const user of store.getActiveUsers()) {
    try {
      await sendDailyTask(bot.telegram, user.telegramId, {});
    } catch (err) {
      console.error(`Morning drill failed for ${user.telegramId}:`, err.message);
    }
  }
}

async function sendEveningReminders(bot) {
  for (const user of store.getUsersNeedingReminder()) {
    try {
      const session = store.getTodaySession(user.telegramId);
      if (session?.reminderSentAt) continue;

      if (session) {
        store.updateTodaySession(user.telegramId, { reminderSentAt: new Date() });
      }

      await bot.telegram.sendMessage(
        user.telegramId,
        '🔔 Мягкое напоминание: сегодняшнее задание ещё ждёт тебя! Успеешь до конца дня?',
        reminderKeyboard(),
      );
    } catch (err) {
      console.error(`Reminder failed for ${user.telegramId}:`, err.message);
    }
  }
}

async function sendWeeklyReviews(bot) {
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 7);

  for (const user of store.getActiveUsers()) {
    try {
      const errors = store.getErrorsSince(user.telegramId, weekStart);
      const counts = {};
      for (const e of errors) {
        counts[e.ruleTag] = (counts[e.ruleTag] || 0) + 1;
      }

      const topErrors = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([rule_tag, count]) => ({ rule_tag, count }));

      if (topErrors.length === 0) {
        await bot.telegram.sendMessage(
          user.telegramId,
          '📅 Weekly Error Review\n\nЗа неделю ошибок не зафиксировано. Отличная неделя!',
        );
        continue;
      }

      const { summary, miniExercise } = await generateWeeklyExercise(topErrors);
      store.saveWeeklyReview(user.telegramId, {
        weekStart: weekStart.toISOString().slice(0, 10),
        topErrors,
        miniExercise,
      });

      const state = getState(user.telegramId);
      const suffix = state !== DrillStates.IDLE
        ? '\n\n_(Обзор отправлен параллельно — текущее задание можно продолжить.)_'
        : '';

      await bot.telegram.sendMessage(
        user.telegramId,
        `📅 **Weekly Error Review**\n\n${summary || topErrors.map((e) => `• ${e.rule_tag}: ${e.count}x`).join('\n')}\n\n`
        + `📝 **Мини-упражнение:**\n${miniExercise || '—'}${suffix}`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      console.error(`Weekly review failed for ${user.telegramId}:`, err.message);
    }
  }
}

module.exports = { startScheduler };

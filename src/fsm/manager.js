const store = require('../store');
const { OnboardingStates, DrillStates } = require('./states');

function getState(telegramId) {
  return store.getFsmState(telegramId);
}

function setState(telegramId, state) {
  store.setFsmState(telegramId, state);
}

function isOnboarding(state) {
  return state === OnboardingStates.LEVEL || state === OnboardingStates.TOPIC;
}

function isDrillActive(state) {
  return [
    DrillStates.TASK_DELIVERED,
    DrillStates.AWAITING_VOICE,
    DrillStates.PROCESSING,
    DrillStates.AWAITING_FOLLOWUP,
    DrillStates.CORRECTION_SHOWN,
    DrillStates.SHADOW_ACTIVE,
  ].includes(state);
}

function resetToIdle(telegramId) {
  setState(telegramId, DrillStates.IDLE);
}

function canAcceptVoice(telegramId, state) {
  if (state === DrillStates.PROCESSING) return false;
  if (
    state === DrillStates.AWAITING_VOICE
    || state === DrillStates.AWAITING_FOLLOWUP
    || state === DrillStates.TASK_DELIVERED
  ) return true;
  if (store.hasOpenDrillSession(telegramId)) return true;
  return false;
}

module.exports = {
  OnboardingStates,
  DrillStates,
  getState,
  setState,
  isOnboarding,
  isDrillActive,
  resetToIdle,
  canAcceptVoice,
};

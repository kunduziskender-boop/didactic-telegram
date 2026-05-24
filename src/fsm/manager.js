const store = require('../store');
const { OnboardingStates, DrillStates, DialogueStates } = require('./states');

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
  if (state === DrillStates.CORRECTION_SHOWN || state === DrillStates.SHADOW_ACTIVE) {
    return false;
  }
  if (state === DialogueStates.ACTIVE) return true;
  if (state === DialogueStates.PROCESSING) return false;
  if (
    state === DrillStates.AWAITING_VOICE
    || state === DrillStates.AWAITING_FOLLOWUP
    || state === DrillStates.TASK_DELIVERED
  ) return true;
  if (store.hasOpenDrillSession(telegramId)) return true;
  return false;
}

function isDialogueActive(state) {
  return state === DialogueStates.ACTIVE || state === DialogueStates.PROCESSING;
}

module.exports = {
  OnboardingStates,
  DrillStates,
  DialogueStates,
  getState,
  setState,
  isOnboarding,
  isDrillActive,
  isDialogueActive,
  resetToIdle,
  canAcceptVoice,
};

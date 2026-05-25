const { getState, isDrillActive, isDialogueActive } = require('../../fsm/manager');
const { DrillStates } = require('../../fsm/states');

function canRouteToSupport(telegramId) {
  const state = getState(telegramId);

  if (isDialogueActive(state)) return false;

  if (
    state === DrillStates.AWAITING_VOICE
    || state === DrillStates.AWAITING_FOLLOWUP
    || state === DrillStates.PROCESSING
  ) {
    return false;
  }

  if (isDrillActive(state)) {
    return state === DrillStates.TASK_DELIVERED
      || state === DrillStates.CORRECTION_SHOWN
      || state === DrillStates.SHADOW_ACTIVE;
  }

  return true;
}

module.exports = { canRouteToSupport };

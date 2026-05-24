const OnboardingStates = {
  LEVEL: 'onboarding_level',
  TOPIC: 'onboarding_topic',
};

const DrillStates = {
  IDLE: 'idle',
  TASK_DELIVERED: 'task_delivered',
  AWAITING_VOICE: 'awaiting_voice',
  PROCESSING: 'processing',
  AWAITING_FOLLOWUP: 'awaiting_followup',
  CORRECTION_SHOWN: 'correction_shown',
  SHADOW_ACTIVE: 'shadow_active',
};

const DialogueStates = {
  ACTIVE: 'dialogue_active',
  PROCESSING: 'dialogue_processing',
};

module.exports = { OnboardingStates, DrillStates, DialogueStates };

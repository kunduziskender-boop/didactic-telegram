const OpenAI = require('openai');
const config = require('../../config');
const { getOpenAIClient } = require('../openaiClient');

let deepseekClient = null;

function getDeepSeekClient() {
  if (!config.deepseekApiKey || config.demoMode) return null;
  if (!deepseekClient) {
    deepseekClient = new OpenAI({
      apiKey: config.deepseekApiKey,
      baseURL: config.deepseekBaseUrl,
    });
  }
  return deepseekClient;
}

function getSupportLlmClient() {
  if (config.demoMode) return null;
  if (config.openaiLlmEnabled) {
    const openai = getOpenAIClient();
    if (openai) return openai;
  }
  if (config.deepseekLlmEnabled) {
    return getDeepSeekClient();
  }
  if (config.openaiApiKey) {
    return getOpenAIClient();
  }
  return getDeepSeekClient();
}

function getSupportModel() {
  if (config.openaiLlmEnabled || config.openaiApiKey) {
    return config.llmModel;
  }
  if (config.deepseekLlmEnabled) return 'deepseek-chat';
  return config.llmModel;
}

module.exports = { getSupportLlmClient, getSupportModel };

const OpenAI = require('openai');
const config = require('../config');

let openaiClient = null;

function isConnectionError(err) {
  const msg = `${err?.message || ''} ${err?.cause?.message || ''}`.toLowerCase();
  return msg.includes('connection error')
    || msg.includes('econnrefused')
    || msg.includes('etimedout')
    || msg.includes('enotfound')
    || msg.includes('fetch failed')
    || msg.includes('network')
    || err?.code === 'ECONNREFUSED'
    || err?.code === 'ETIMEDOUT';
}

function isQuotaError(err) {
  const msg = `${err?.message || ''} ${err?.status || err?.statusCode || ''}`.toLowerCase();
  return err?.status === 429
    || err?.statusCode === 429
    || msg.includes('429')
    || msg.includes('quota')
    || msg.includes('billing')
    || msg.includes('insufficient_quota');
}

/** OpenAI недоступен — можно перейти на demo/DeepSeek */
function isRecoverableAiError(err) {
  return isConnectionError(err) || isQuotaError(err);
}

function buildCustomFetch(proxyUrl) {
  if (!proxyUrl) return undefined;
  try {
    const { ProxyAgent, fetch: undiciFetch } = require('undici');
    const dispatcher = new ProxyAgent(proxyUrl);
    return (url, init) => undiciFetch(url, { ...init, dispatcher });
  } catch (err) {
    console.warn('Proxy setup failed:', err.message);
    return undefined;
  }
}

function getOpenAIClient() {
  if (!config.openaiApiKey || config.demoMode) return null;
  if (!config.openaiLlmEnabled && !config.sttEnabled && !config.ttsEnabled) return null;
  if (openaiClient) return openaiClient;

  const options = { apiKey: config.openaiApiKey };
  if (config.openaiBaseUrl) options.baseURL = config.openaiBaseUrl;

  const customFetch = buildCustomFetch(config.httpsProxy);
  if (customFetch) {
    options.fetch = customFetch;
    console.log('OpenAI client using proxy');
  }

  openaiClient = new OpenAI(options);
  return openaiClient;
}

module.exports = { getOpenAIClient, isConnectionError, isQuotaError, isRecoverableAiError };

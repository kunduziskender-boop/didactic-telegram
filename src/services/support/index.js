const { generateSupportReply, resetSupportChat } = require('./assistant');
const { getFallback } = require('./fallback');
const { canRouteToSupport } = require('./routing');

module.exports = {
  generateSupportReply,
  resetSupportChat,
  getFallback,
  canRouteToSupport,
};

require('dotenv').config();
const store = require('../src/store');
const u = store.ensureUser(999);
store.updateUser(999, { level: 'A2', topic: 'daily', onboardingCompleted: true });
const task = store.selectTaskForUser(999);
console.log('task:', task?.id, task?.promptEn?.slice(0, 40));
console.log('OK');

const SCENARIOS = [
  {
    id: 'cafe_order',
    levels: ['A1', 'A2'],
    topics: ['daily', 'travel', 'any'],
    titleRu: '☕ В кафе',
    settingRu: 'Ты — клиент, заказываешь напиток.',
    userRole: 'customer',
    botRole: 'barista',
    openingEn: 'Hi! Welcome to Sunny Café. What can I get for you?',
    openingRu: 'Бариста спрашивает, что ты хочешь заказать.',
    firstReplyEn: "I'd like a cappuccino, please.",
    firstReplyRu: 'Я бы хотел(а) капучино, пожалуйста.',
  },
  {
    id: 'hotel_checkin',
    levels: ['A2', 'B1'],
    topics: ['travel', 'any'],
    titleRu: '🏨 Регистрация в отеле',
    settingRu: 'Ты приехал(а) в отель и подходишь к стойке reception.',
    userRole: 'guest',
    botRole: 'receptionist',
    openingEn: 'Good evening! Have you got a reservation with us?',
    openingRu: 'Администратор спрашивает про бронь.',
    firstReplyEn: 'Yes, I have a reservation under my name.',
    firstReplyRu: 'Да, у меня бронь на моё имя.',
  },
  {
    id: 'job_interview',
    levels: ['B1', 'B2', 'C1'],
    topics: ['business', 'it', 'any'],
    titleRu: '💼 Собеседование',
    settingRu: 'Короткое интервью на работу — ты рассказываешь о себе.',
    userRole: 'candidate',
    botRole: 'interviewer',
    openingEn: 'Thanks for coming in. Could you tell me a little about yourself?',
    openingRu: 'Интервьюер просит коротко представиться.',
    firstReplyEn: "I'm a developer with two years of experience.",
    firstReplyRu: 'Я разработчик с двухлетним опытом.',
  },
  {
    id: 'airport_gate',
    levels: ['A2', 'B1'],
    topics: ['travel', 'any'],
    titleRu: '✈️ В аэропорту',
    settingRu: 'Ты у гейта и спрашиваешь про рейс.',
    userRole: 'passenger',
    botRole: 'airport staff',
    openingEn: 'Hello! How can I help you at the gate today?',
    openingRu: 'Сотрудник аэропорта готов помочь.',
    firstReplyEn: 'Excuse me, is this the gate for flight BA123?',
    firstReplyRu: 'Извините, это выход на рейс BA123?',
  },
  {
    id: 'doctor_visit',
    levels: ['A2', 'B1'],
    topics: ['daily', 'any'],
    titleRu: '🩺 У врача',
    settingRu: 'Ты описываешь симптомы врачу.',
    userRole: 'patient',
    botRole: 'doctor',
    openingEn: 'Hi, I am Dr. Lee. What brings you in today?',
    openingRu: 'Врач спрашивает, что беспокоит.',
    firstReplyEn: 'I have a headache and a sore throat.',
    firstReplyRu: 'У меня головная боль и больное горло.',
  },
  {
    id: 'team_standup',
    levels: ['B1', 'B2', 'C1'],
    topics: ['it', 'business', 'any'],
    titleRu: '👩‍💻 IT stand-up',
    settingRu: 'Утренний stand-up: ты рассказываешь, что делал(а) вчера.',
    userRole: 'developer',
    botRole: 'team lead',
    openingEn: 'Morning! What did you work on yesterday, and any blockers today?',
    openingRu: 'Тимлид спрашивает про вчерашние задачи.',
    firstReplyEn: 'Yesterday I fixed a bug in the login page.',
    firstReplyRu: 'Вчера я исправил(а) баг на странице входа.',
  },
  {
    id: 'shop_clothes',
    levels: ['A1', 'A2'],
    topics: ['daily', 'any'],
    titleRu: '🛍️ Магазин одежды',
    settingRu: 'Ты ищешь подходящий размер.',
    userRole: 'shopper',
    botRole: 'shop assistant',
    openingEn: 'Hi there! Are you looking for anything specific today?',
    openingRu: 'Продавец спрашивает, что ищешь.',
    firstReplyEn: "I'm looking for a blue T-shirt, size medium.",
    firstReplyRu: 'Ищу синюю футболку, размер M.',
  },
  {
    id: 'restaurant_dinner',
    levels: ['A2', 'B1'],
    topics: ['daily', 'travel', 'any'],
    titleRu: '🍽️ В ресторане',
    settingRu: 'Ты бронируешь столик или заказываешь ужин.',
    userRole: 'diner',
    botRole: 'waiter',
    openingEn: 'Good evening! Table for how many, please?',
    openingRu: 'Официант спрашивает, на сколько человек стол.',
    firstReplyEn: 'A table for two, please.',
    firstReplyRu: 'Столик на двоих, пожалуйста.',
  },
];

function pickScenarios(level, topic, limit = 4) {
  const topicId = topic || 'any';
  const matched = SCENARIOS.filter((s) => {
    const levelOk = s.levels.includes(level);
    const topicOk = s.topics.includes(topicId) || s.topics.includes('any');
    return levelOk && topicOk;
  });
  const pool = matched.length ? matched : SCENARIOS.filter((s) => s.levels.includes(level));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, limit);
}

function getScenarioById(id) {
  return SCENARIOS.find((s) => s.id === id) || null;
}

module.exports = { SCENARIOS, pickScenarios, getScenarioById };

/** Initial task catalog — inserted into DB on first run (and new tasks on update). */
const SEED_TASKS = [
  {
    level: 'A1',
    topic: 'daily',
    promptEn: 'What is your name? Where are you from?',
    promptRu: 'Как тебя зовут? Откуда ты?',
  },
  {
    level: 'A1',
    topic: 'daily',
    promptEn: 'What do you like to do in your free time?',
    promptRu: 'Что тебе нравится делать в свободное время?',
  },
  {
    level: 'A1',
    topic: 'daily',
    promptEn: 'What is the weather like today? Do you like this weather?',
    promptRu: 'Какая сегодня погода? Тебе нравится такая погода?',
  },
  {
    level: 'A1',
    topic: 'daily',
    promptEn: 'Describe your family. How many people are in your family?',
    promptRu: 'Расскажи о своей семье. Сколько человек в твоей семье?',
  },
  {
    level: 'A1',
    topic: 'travel',
    promptEn: 'Where do you want to travel? Why?',
    promptRu: 'Куда ты хочешь поехать? Почему?',
  },
  {
    level: 'A1',
    topic: 'business',
    promptEn: 'What is your job? Do you like it?',
    promptRu: 'Кем ты работаешь? Тебе нравится твоя работа?',
  },
  {
    level: 'A2',
    topic: 'daily',
    promptEn: 'Tell me about your morning routine. What do you usually do after you wake up?',
    promptRu: 'Расскажи о своём утреннем распорядке. Что ты обычно делаешь после пробуждения?',
  },
  {
    level: 'A2',
    topic: 'daily',
    promptEn: 'What are your plans for the weekend? Who will you spend time with?',
    promptRu: 'Какие у тебя планы на выходные? С кем ты проведёшь время?',
  },
  {
    level: 'A2',
    topic: 'daily',
    promptEn: 'Describe your favorite meal. When do you usually eat it and why do you like it?',
    promptRu: 'Опиши своё любимое блюдо. Когда ты его ешь и почему оно тебе нравится?',
  },
  {
    level: 'A2',
    topic: 'daily',
    promptEn: 'Talk about your city or town. What is interesting there?',
    promptRu: 'Расскажи о своём городе. Что там интересного?',
  },
  {
    level: 'A2',
    topic: 'travel',
    promptEn: 'Describe your last trip. Where did you go and what did you like most?',
    promptRu: 'Опиши своё последнее путешествие. Куда ты ездил и что понравилось больше всего?',
  },
  {
    level: 'B1',
    topic: 'business',
    promptEn: 'Describe a typical workday. What tasks do you handle and how do you prioritize them?',
    promptRu: 'Опиши типичный рабочий день. Какие задачи ты выполняешь и как расставляешь приоритеты?',
  },
  {
    level: 'B1',
    topic: 'it',
    promptEn: 'Explain a technical problem you solved recently. What was the issue and how did you fix it?',
    promptRu: 'Объясни техническую проблему, которую ты недавно решил. В чём была сложность и как ты её исправил?',
  },
  {
    level: 'B1',
    topic: 'daily',
    promptEn: 'Talk about a hobby you enjoy. Why did you start it and how often do you practice?',
    promptRu: 'Расскажи о хобби, которым ты занимаешься. Почему ты начал и как часто практикуешься?',
  },
  {
    level: 'B1',
    topic: 'daily',
    promptEn: 'Describe a book or film you recently enjoyed. What was it about and why did you like it?',
    promptRu: 'Опиши книгу или фильм, которые тебе недавно понравились. О чём они и почему тебе зашли?',
  },
  {
    level: 'B1',
    topic: 'daily',
    promptEn: 'How do you usually relax after a busy day? Explain your routine.',
    promptRu: 'Как ты обычно отдыхаешь после напряжённого дня? Опиши свой ритуал.',
  },
  {
    level: 'B2',
    topic: 'business',
    promptEn: 'Discuss a challenge you faced at work. How did you approach it and what was the outcome?',
    promptRu: 'Расскажи о рабочей проблеме. Как ты к ней подошёл и каков был результат?',
  },
  {
    level: 'B2',
    topic: 'it',
    promptEn: 'Compare two technologies you use. What are the trade-offs between them?',
    promptRu: 'Сравни две технологии, которыми ты пользуешься. Какие у них плюсы и минусы?',
  },
  {
    level: 'B2',
    topic: 'travel',
    promptEn: 'Describe a cultural difference you noticed while traveling. How did it change your perspective?',
    promptRu: 'Опиши культурное отличие, которое ты заметил в путешествии. Как это изменило твой взгляд?',
  },
  {
    level: 'C1',
    topic: 'business',
    promptEn: 'Argue for or against remote work as the default model. Support your view with concrete examples.',
    promptRu: 'Выскажись за или против удалённой работы как основной модели. Подкрепи аргументами.',
  },
  {
    level: 'C1',
    topic: 'it',
    promptEn: 'Explain how you would design a scalable system for a growing user base. Cover key architectural decisions.',
    promptRu: 'Объясни, как бы ты спроектировал масштабируемую систему для растущей аудитории.',
  },
];

module.exports = { SEED_TASKS };

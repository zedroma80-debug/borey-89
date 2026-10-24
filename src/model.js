export const roles = ['Охранник', 'Медик', 'Электрик', 'Механик'];
export const symptoms = ['Озноб', 'Дрожь в руках', 'Головная боль', 'Нарушения сна', 'Провалы в памяти', 'Тошнота', 'Дезориентация', 'Нарушения восприятия'];
const items = [
  ['Табельный пистолет', 'Фонарь', 'Связка ключей'],
  ['Медицинская сумка', 'Фонарик', 'Блокнот'],
  ['Набор инструментов', 'Изолента', 'Фонарь'],
  ['Гаечный ключ', 'Рабочие перчатки', 'Фонарь'],
];
export function makeCharacter(slot) {
  return { health: 4, stress: 0, items: [...items[slot]], name: '', notes: '', tasks: '', symptoms: [] };
}
export const limits = { health: 4, stress: 6 };
const textLimits = { name: 200, notes: 2000, tasks: 1500 };
export function validateCharacter(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = ['health', 'stress', 'items', 'name', 'notes', 'tasks', 'symptoms'];
  if (Object.keys(value).length !== keys.length || Object.keys(value).some(k => !keys.includes(k))) return false;
  return ['health', 'stress'].every(k => Number.isInteger(value[k]) && value[k] >= 0 && value[k] <= limits[k])
    && Object.entries(textLimits).every(([k, max]) => typeof value[k] === 'string' && value[k].length <= max)
    && Array.isArray(value.items) && value.items.length <= 40 && value.items.every(s => typeof s === 'string' && s.trim().length > 0 && s.length <= 90)
    && Array.isArray(value.symptoms) && value.symptoms.length <= symptoms.length && new Set(value.symptoms).size === value.symptoms.length && value.symptoms.every(s => symptoms.includes(s));
}

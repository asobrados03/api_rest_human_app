const DAY_ALIAS_ORDER = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_TOKEN_TO_ALIAS = {
    sun: 'sun', sunday: 'sun', dom: 'sun', domingo: 'sun', '0': 'sun', '00': 'sun', '7': 'sun', '07': 'sun',
    mon: 'mon', monday: 'mon', lun: 'mon', lunes: 'mon', '1': 'mon', '01': 'mon',
    tue: 'tue', tuesday: 'tue', mar: 'tue', martes: 'tue', '2': 'tue', '02': 'tue',
    wed: 'wed', wednesday: 'wed', mie: 'wed', mier: 'wed', miercoles: 'wed', miércoles: 'wed', '3': 'wed', '03': 'wed',
    thu: 'thu', thursday: 'thu', jue: 'thu', jueves: 'thu', '4': 'thu', '04': 'thu',
    fri: 'fri', friday: 'fri', vie: 'fri', viernes: 'fri', '5': 'fri', '05': 'fri',
    sat: 'sat', saturday: 'sat', sab: 'sat', sabado: 'sat', sábado: 'sat', '6': 'sat', '06': 'sat',
};

export const stripDiacritics = (value = '') => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export const parseDayAliases = (value) => {
    const raw = stripDiacritics(String(value ?? '')).trim();
    if (!raw) return new Set();
    const parts = raw.split(/[^0-9a-zA-Z]+/).filter(Boolean);
    const out = new Set();
    for (const part of parts) {
        const normalized = stripDiacritics(part).toLowerCase();
        if (['all', 'todos', 'diario', 'daily', 'any'].includes(normalized)) return new Set();
        const alias = DAY_TOKEN_TO_ALIAS[normalized];
        if (alias) out.add(alias);
    }
    return out;
};

export const matchesDayAlias = (aliasSet, alias) => !aliasSet || aliasSet.size === 0 || aliasSet.has(alias);

export const getDayAliasForDate = (dateInput) => {
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return 'mon';
    const idx = date.getUTCDay();
    return DAY_ALIAS_ORDER[idx];
};
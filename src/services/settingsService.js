import { query } from '../config/db.js';

export const DEFAULT_SETTINGS = {
  brandName: 'Victory Simulator',
  heroSubtitle: 'Elegí tu simulador, seleccioná fecha y bloque horario con disponibilidad verificada al instante y asegurá tu turno sin esperas.',
  whatsappNumber: '5491100000000',
  whatsappBirthdayText: 'Hola Victory Simulator! Quiero consultar para reservar un cumpleaños o evento privado.',
  showBirthdaysSection: true,
  showPrices: true,
  pricingMode: 'per_zone', // 'per_zone' | 'per_player' | 'flat'
  currency: 'ARS',
  basePricePerHour: 15000,
  extraPlayerPricePerHour: 4000,
  groupDiscountThreshold: 3,
  groupDiscountPercent: 15,
  multiHourDiscountPercent: 10,
  allowedDurations: [60, 120, 180, 240],
  maxDaysAhead: 90,
  resetBufferMinutes: 0,
  zonePrices: {}, // { [zoneId]: number }
  schedule: {
    0: { open: true, start: 12, end: 23 },  // Domingo
    1: { open: true, start: 14, end: 23 },  // Lunes
    2: { open: true, start: 14, end: 23 },  // Martes
    3: { open: true, start: 14, end: 23 },  // Miércoles
    4: { open: true, start: 14, end: 23 },  // Jueves
    5: { open: true, start: 12, end: 24 },  // Viernes
    6: { open: true, start: 10, end: 24 },  // Sábado
  },
};

function sanitizeSettings(raw) {
  const merged = {
    ...DEFAULT_SETTINGS,
    ...(raw && typeof raw === 'object' ? raw : {}),
  };

  const basePricePerHour = Math.max(0, Number(merged.basePricePerHour) || 0);
  const extraPlayerPricePerHour = Math.max(0, Number(merged.extraPlayerPricePerHour) || 0);
  const groupDiscountThreshold = Math.min(20, Math.max(2, parseInt(merged.groupDiscountThreshold, 10) || 3));
  const groupDiscountPercent = Math.min(80, Math.max(0, Number(merged.groupDiscountPercent) || 0));
  const multiHourDiscountPercent = Math.min(80, Math.max(0, Number(merged.multiHourDiscountPercent) || 0));
  const resetBufferMinutes = [0, 15, 30].includes(parseInt(merged.resetBufferMinutes, 10))
    ? parseInt(merged.resetBufferMinutes, 10)
    : 0;

  const zonePrices = {};
  if (merged.zonePrices && typeof merged.zonePrices === 'object') {
    for (const [k, v] of Object.entries(merged.zonePrices)) {
      const id = parseInt(k, 10);
      const price = Number(v);
      if (Number.isInteger(id) && id > 0 && Number.isFinite(price) && price >= 0) {
        zonePrices[String(id)] = price;
      }
    }
  }

  const schedule = {};
  for (let d = 0; d <= 6; d++) {
    const defDay = DEFAULT_SETTINGS.schedule[d];
    const inDay = merged.schedule && merged.schedule[d] ? merged.schedule[d] : defDay;
    const start = Math.min(23, Math.max(0, parseInt(inDay.start, 10) || defDay.start));
    const end = Math.min(24, Math.max(start + 1, parseInt(inDay.end, 10) || defDay.end));
    schedule[d] = {
      open: Boolean(inDay.open),
      start,
      end,
    };
  }

  const pricingMode = ['per_zone', 'per_player', 'flat'].includes(merged.pricingMode)
    ? merged.pricingMode
    : 'per_zone';

  const rawDurations = Array.isArray(merged.allowedDurations)
    ? merged.allowedDurations
    : String(merged.allowedDurations || '60,120,180,240')
        .split(',')
        .map((n) => parseInt(n.trim(), 10));
  const allowedDurations = [...new Set(rawDurations.filter((n) => Number.isInteger(n) && n >= 30 && n <= 480))]
    .sort((a, b) => a - b);

  const maxDaysAhead = Math.min(365, Math.max(1, parseInt(merged.maxDaysAhead, 10) || 90));
  const whatsappNumber = String(merged.whatsappNumber || DEFAULT_SETTINGS.whatsappNumber)
    .replace(/[^\d]/g, '')
    .slice(0, 20) || DEFAULT_SETTINGS.whatsappNumber;

  return {
    brandName: String(merged.brandName || DEFAULT_SETTINGS.brandName).trim().slice(0, 60),
    heroSubtitle: String(merged.heroSubtitle || DEFAULT_SETTINGS.heroSubtitle).trim().slice(0, 240),
    whatsappNumber,
    whatsappBirthdayText: String(merged.whatsappBirthdayText || DEFAULT_SETTINGS.whatsappBirthdayText).trim().slice(0, 240),
    showBirthdaysSection: merged.showBirthdaysSection !== false,
    showPrices: merged.showPrices !== false,
    pricingMode,
    currency: typeof merged.currency === 'string' && merged.currency.trim() ? merged.currency.trim().slice(0, 6) : 'ARS',
    basePricePerHour,
    extraPlayerPricePerHour,
    groupDiscountThreshold,
    groupDiscountPercent,
    multiHourDiscountPercent,
    allowedDurations: allowedDurations.length > 0 ? allowedDurations : [60, 120, 180, 240],
    maxDaysAhead,
    resetBufferMinutes,
    zonePrices,
    schedule,
  };
}

export async function getBusinessSettings() {
  try {
    const res = await query('SELECT value FROM config WHERE key = $1', ['business_settings']);
    if (!res.rows[0]?.value) {
      return sanitizeSettings(DEFAULT_SETTINGS);
    }
    const parsed = JSON.parse(res.rows[0].value);
    return sanitizeSettings(parsed);
  } catch {
    return sanitizeSettings(DEFAULT_SETTINGS);
  }
}

export async function updateBusinessSettings(input) {
  const current = await getBusinessSettings();
  const next = sanitizeSettings({
    ...current,
    ...input,
    schedule: input?.schedule ? { ...current.schedule, ...input.schedule } : current.schedule,
    zonePrices: input?.zonePrices !== undefined ? input.zonePrices : current.zonePrices,
  });

  await query(
    `INSERT INTO config (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    ['business_settings', JSON.stringify(next)]
  );

  return next;
}

export function calculateReservationPrice(settings, { zoneId, durationMinutes, players = 1 }) {
  const hours = Math.max(0.5, Number(durationMinutes || 60) / 60);
  const numPlayers = Math.max(1, parseInt(players, 10) || 1);

  const customZonePrice = settings.zonePrices?.[String(zoneId)];
  const hourlyBase =
    customZonePrice !== undefined && Number.isFinite(Number(customZonePrice))
      ? Number(customZonePrice)
      : Number(settings.basePricePerHour || 0);

  const extraPlayers = Math.max(0, numPlayers - 1);
  let baseSubtotal = 0;
  if (settings.pricingMode === 'per_player') {
    baseSubtotal = Math.round(hourlyBase * numPlayers * hours);
  } else if (settings.pricingMode === 'flat') {
    baseSubtotal = Math.round(hourlyBase * hours);
  } else {
    const hourlyExtras = extraPlayers * Number(settings.extraPlayerPricePerHour || 0);
    baseSubtotal = Math.round((hourlyBase + hourlyExtras) * hours);
  }

  let discountPercent = 0;
  const appliedRules = [];

  if (numPlayers >= settings.groupDiscountThreshold && settings.groupDiscountPercent > 0) {
    discountPercent += settings.groupDiscountPercent;
    appliedRules.push(`${settings.groupDiscountPercent}% OFF Grupo (${numPlayers}+ pil.)`);
  }

  if (hours >= 2 && settings.multiHourDiscountPercent > 0) {
    discountPercent += settings.multiHourDiscountPercent;
    appliedRules.push(`${settings.multiHourDiscountPercent}% OFF +2h`);
  }

  discountPercent = Math.min(80, discountPercent);
  const discountAmount = Math.round((baseSubtotal * discountPercent) / 100);
  const total = Math.max(0, baseSubtotal - discountAmount);
  const perPlayer = Math.round(total / numPlayers);

  return {
    currency: settings.currency || 'ARS',
    hourlyBase,
    hours,
    players: numPlayers,
    baseSubtotal,
    discountPercent,
    discountAmount,
    total,
    perPlayer,
    appliedRules,
  };
}

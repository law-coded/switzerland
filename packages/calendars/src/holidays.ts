/**
 * Timezone-safe ISO calendar date utilities (YYYY-MM-DD).
 * All arithmetic uses UTC midnight timestamps to prevent DST/local-TZ drift.
 */

export function parseIsoDate(iso: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) {
    throw new Error(`Invalid ISO date "${iso}" (expected YYYY-MM-DD)`);
  }
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    throw new Error(`Calendar date does not exist: "${iso}"`);
  }
  return d;
}

export function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = parseIsoDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return formatIsoDate(d);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = parseIsoDate(fromIso).getTime();
  const b = parseIsoDate(toIso).getTime();
  return Math.round((b - a) / 86_400_000);
}

export function dayOfWeek(iso: string): number {
  // 0 = Sunday, 6 = Saturday
  return parseIsoDate(iso).getUTCDay();
}

export function isWeekend(iso: string): boolean {
  const dow = dayOfWeek(iso);
  return dow === 0 || dow === 6;
}

export function daysInMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

export function endOfMonth(iso: string): string {
  const d = parseIsoDate(iso);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return formatIsoDate(new Date(Date.UTC(y, m - 1, daysInMonth(y, m))));
}

/**
 * Adds calendar months following Art. 142 Abs. 2 ZPO / Art. 77 OR:
 * same day number in the target month, or last day of month if target month is shorter.
 */
export function addMonthsLegal(iso: string, months: number): string {
  const d = parseIsoDate(iso);
  const startYear = d.getUTCFullYear();
  const startMonth = d.getUTCMonth(); // 0-based
  const startDay = d.getUTCDate();

  const totalMonths = startYear * 12 + startMonth + months;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth0 = ((totalMonths % 12) + 12) % 12;
  const maxDay = daysInMonth(targetYear, targetMonth0 + 1);
  const clampedDay = Math.min(startDay, maxDay);

  return formatIsoDate(new Date(Date.UTC(targetYear, targetMonth0, clampedDay)));
}

/**
 * Anonymous Gregorian Computus for Easter Sunday (exact for all Gregorian years).
 */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return formatIsoDate(new Date(Date.UTC(year, month - 1, day)));
}

function nthWeekdayOfMonth(year: number, month1Based: number, weekday: number, nth: number): string {
  const first = new Date(Date.UTC(year, month1Based - 1, 1));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (nth - 1) * 7;
  return formatIsoDate(new Date(Date.UTC(year, month1Based - 1, day)));
}

export interface HolidayEntry {
  date: string;
  name: Record<string, string>;
  jurisdiction: string;
  statutoryBasis?: string;
}

/**
 * Official statutory public holidays relevant to legal deadlines across
 * Switzerland (federal + major cantons) and core European/UK jurisdictions.
 */
export function getPublicHolidays(year: number, jurisdiction: string): HolidayEntry[] {
  const easter = easterSunday(year);
  const goodFriday = addDays(easter, -2);
  const easterMonday = addDays(easter, 1);
  const ascension = addDays(easter, 39);
  const whitMonday = addDays(easter, 50);
  const corpusChristi = addDays(easter, 60);

  const j = jurisdiction.toUpperCase();
  const list: HolidayEntry[] = [];

  const push = (date: string, de: string, fr: string, it: string, en: string, jur: string, basis?: string) => {
    list.push({ date, name: { de, fr, it, en }, jurisdiction: jur, statutoryBasis: basis });
  };

  if (j === "CH" || j.startsWith("CH-")) {
    // Federal National Day (Art. 110 Abs. 3 BV) + pan-Swiss core holidays
    push(`${year}-01-01`, "Neujahrstag", "Nouvel An", "Capodanno", "New Year's Day", "CH", "Art. 20a ArG");
    push(ascension, "Auffahrt", "Ascension", "Ascensione", "Ascension Day", "CH");
    push(`${year}-08-01`, "Bundesfeiertag", "Fête nationale", "Festa nazionale", "Swiss National Day", "CH", "Art. 110 Abs. 3 BV");
    push(`${year}-12-25`, "Weihnachten", "Noël", "Natale", "Christmas Day", "CH");

    if (j === "CH-ZH") {
      push(`${year}-01-02`, "Berchtoldstag", "Saint-Berchtold", "San Bertoldo", "St. Berchtold's Day", "CH-ZH", "ZH Praxis / LS 822.4");
      push(goodFriday, "Karfreitag", "Vendredi-Saint", "Venerdì Santo", "Good Friday", "CH-ZH", "ZH Ruhetagsgesetz LS 822.4");
      push(easterMonday, "Ostermontag", "Lundi de Pâques", "Lunedì di Pasqua", "Easter Monday", "CH-ZH", "ZH Ruhetagsgesetz LS 822.4");
      push(`${year}-05-01`, "Tag der Arbeit", "Fête du Travail", "Festa del Lavoro", "Labour Day", "CH-ZH", "ZH Ruhetagsgesetz LS 822.4");
      push(whitMonday, "Pfingstmontag", "Lundi de Pentecôte", "Lunedì di Pentecoste", "Whit Monday", "CH-ZH", "ZH Ruhetagsgesetz LS 822.4");
      push(`${year}-12-26`, "Stephanstag", "Saint-Étienne", "Santo Stefano", "St. Stephen's Day", "CH-ZH", "ZH Ruhetagsgesetz LS 822.4");
    } else if (j === "CH-GE") {
      push(goodFriday, "Karfreitag", "Vendredi-Saint", "Venerdì Santo", "Good Friday", "CH-GE", "GE LJF J 1 45");
      push(easterMonday, "Ostermontag", "Lundi de Pâques", "Lunedì di Pasqua", "Easter Monday", "CH-GE", "GE LJF J 1 45");
      push(whitMonday, "Pfingstmontag", "Lundi de Pentecôte", "Lunedì di Pentecoste", "Whit Monday", "CH-GE", "GE LJF J 1 45");
      // Jeûne genevois: Thursday following the first Sunday of September
      const firstSundaySept = nthWeekdayOfMonth(year, 9, 0, 1);
      const jeuneGenevois = addDays(firstSundaySept, 4);
      push(jeuneGenevois, "Genfer Bettag", "Jeûne genevois", "Digiuno ginevrino", "Geneva Fast", "CH-GE", "GE LJF J 1 45");
      push(`${year}-12-31`, "Restauration der Republik", "Restauration de la République", "Restaurazione della Repubblica", "Restoration Day", "CH-GE", "GE LJF J 1 45");
    } else if (j === "CH-TI") {
      // Ticino: Epifania, San Giuseppe, Corpus Domini, SS. Pietro e Paolo, Assunzione, Ognissanti, Immacolata, Santo Stefano (note: Good Friday is NOT an official TI holiday)
      push(`${year}-01-06`, "Heilige Drei Könige", "Épiphanie", "Epifania", "Epiphany", "CH-TI", "TI Legge sui giorni festivi");
      push(`${year}-03-19`, "Josefstag", "Saint-Joseph", "San Giuseppe", "St. Joseph's Day", "CH-TI", "TI Legge sui giorni festivi");
      push(easterMonday, "Ostermontag", "Lundi de Pâques", "Lunedì di Pasqua", "Easter Monday", "CH-TI", "TI Legge sui giorni festivi");
      push(whitMonday, "Pfingstmontag", "Lundi de Pentecôte", "Lunedì di Pentecoste", "Whit Monday", "CH-TI", "TI Legge sui giorni festivi");
      push(corpusChristi, "Fronleichnam", "Fête-Dieu", "Corpus Domini", "Corpus Christi", "CH-TI", "TI Legge sui giorni festivi");
      push(`${year}-06-29`, "Peter und Paul", "Saints Pierre et Paul", "SS. Pietro e Paolo", "Saints Peter and Paul", "CH-TI", "TI Legge sui giorni festivi");
      push(`${year}-08-15`, "Mariä Himmelfahrt", "Assomption", "Assunzione", "Assumption Day", "CH-TI", "TI Legge sui giorni festivi");
      push(`${year}-11-01`, "Allerheiligen", "Toussaint", "Ognissanti", "All Saints' Day", "CH-TI", "TI Legge sui giorni festivi");
      push(`${year}-12-08`, "Mariä Empfängnis", "Immaculée Conception", "Immacolata Concezione", "Immaculate Conception", "CH-TI", "TI Legge sui giorni festivi");
      push(`${year}-12-26`, "Stephanstag", "Saint-Étienne", "Santo Stefano", "St. Stephen's Day", "CH-TI", "TI Legge sui giorni festivi");
    } else if (j === "CH-BE" || j === "CH-VD" || j === "CH-BS" || j === "CH") {
      push(`${year}-01-02`, "Berchtoldstag", "Saint-Berchtold", "San Bertoldo", "St. Berchtold's Day", j);
      push(goodFriday, "Karfreitag", "Vendredi-Saint", "Venerdì Santo", "Good Friday", j);
      push(easterMonday, "Ostermontag", "Lundi de Pâques", "Lunedì di Pasqua", "Easter Monday", j);
      push(whitMonday, "Pfingstmontag", "Lundi de Pentecôte", "Lunedì di Pentecoste", "Whit Monday", j);
      if (j === "CH-VD") {
        // Lundi du Jeûne fédéral: Monday after 3rd Sunday of September
        const thirdSundaySept = nthWeekdayOfMonth(year, 9, 0, 3);
        push(addDays(thirdSundaySept, 1), "Eidg. Dank-, Buss- und Bettag (Montag)", "Lundi du Jeûne fédéral", "Lunedì del Digiuno federale", "Federal Fast Monday", "CH-VD");
      }
      if (j === "CH-BS") {
        push(`${year}-05-01`, "Tag der Arbeit", "Fête du Travail", "Festa del Lavoro", "Labour Day", "CH-BS");
      }
      if (j !== "CH-VD") {
        push(`${year}-12-26`, "Stephanstag", "Saint-Étienne", "Santo Stefano", "St. Stephen's Day", j);
      }
    }
  } else if (j === "DE" || j.startsWith("DE-")) {
    push(`${year}-01-01`, "Neujahr", "Nouvel An", "Capodanno", "New Year's Day", "DE");
    push(goodFriday, "Karfreitag", "Vendredi-Saint", "Venerdì Santo", "Good Friday", "DE");
    push(easterMonday, "Ostermontag", "Lundi de Pâques", "Lunedì di Pasqua", "Easter Monday", "DE");
    push(`${year}-05-01`, "Tag der Arbeit", "Fête du Travail", "Festa del Lavoro", "Labour Day", "DE");
    push(ascension, "Christi Himmelfahrt", "Ascension", "Ascensione", "Ascension Day", "DE");
    push(whitMonday, "Pfingstmontag", "Lundi de Pentecôte", "Lunedì di Pentecoste", "Whit Monday", "DE");
    push(`${year}-10-03`, "Tag der Deutschen Einheit", "Jour de l'Unité allemande", "Giorno dell'Unità tedesca", "German Unity Day", "DE");
    push(`${year}-12-25`, "1. Weihnachtstag", "Noël", "Natale", "Christmas Day", "DE");
    push(`${year}-12-26`, "2. Weihnachtstag", "Saint-Étienne", "Santo Stefano", "Boxing Day", "DE");
  } else if (j === "UK" || j.startsWith("UK-")) {
    push(`${year}-01-01`, "Neujahr", "Nouvel An", "Capodanno", "New Year's Day", j);
    push(goodFriday, "Karfreitag", "Vendredi-Saint", "Venerdì Santo", "Good Friday", j);
    if (j !== "UK-SCT") {
      push(easterMonday, "Ostermontag", "Lundi de Pâques", "Lunedì di Pasqua", "Easter Monday", j);
    }
    push(`${year}-12-25`, "Weihnachten", "Noël", "Natale", "Christmas Day", j);
    push(`${year}-12-26`, "Stephanstag", "Lendemain de Noël", "Santo Stefano", "Boxing Day", j);
  } else {
    // EU / EEA baseline fixed holidays (Regulation (EEC, Euratom) No 1182/71 baseline)
    push(`${year}-01-01`, "Neujahr", "Nouvel An", "Capodanno", "New Year's Day", j);
    push(goodFriday, "Karfreitag", "Vendredi-Saint", "Venerdì Santo", "Good Friday", j);
    push(easterMonday, "Ostermontag", "Lundi de Pâques", "Lunedì di Pasqua", "Easter Monday", j);
    push(`${year}-05-01`, "Tag der Arbeit", "Fête du Travail", "Festa del Lavoro", "Labour Day", j);
    push(`${year}-12-25`, "Weihnachten", "Noël", "Natale", "Christmas Day", j);
    push(`${year}-12-26`, "Stephanstag", "Saint-Étienne", "Santo Stefano", "Boxing Day", j);
  }

  return list;
}

export function findHoliday(iso: string, jurisdiction: string): HolidayEntry | undefined {
  const year = parseIsoDate(iso).getUTCFullYear();
  return getPublicHolidays(year, jurisdiction).find((h) => h.date === iso);
}

export function isNonWorkingDay(iso: string, jurisdiction: string): { nonWorking: boolean; reason?: HolidayEntry | "weekend" } {
  if (isWeekend(iso)) {
    return { nonWorking: true, reason: "weekend" };
  }
  const h = findHoliday(iso, jurisdiction);
  if (h) {
    return { nonWorking: true, reason: h };
  }
  return { nonWorking: false };
}

export function nextBusinessDay(iso: string, jurisdiction: string): { date: string; rolledDays: number; reasons: string[] } {
  let cur = iso;
  let rolledDays = 0;
  const reasons: string[] = [];
  while (true) {
    const check = isNonWorkingDay(cur, jurisdiction);
    if (!check.nonWorking) {
      return { date: cur, rolledDays, reasons };
    }
    reasons.push(check.reason === "weekend" ? `${cur} (weekend)` : `${cur} (${check.reason?.name["de"] ?? "holiday"})`);
    cur = addDays(cur, 1);
    rolledDays += 1;
  }
}

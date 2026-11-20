import {
  addDays,
  addMonthsLegal,
  endOfMonth,
  easterSunday,
  isNonWorkingDay,
  nextBusinessDay,
  parseIsoDate,
} from "./holidays.ts";

export interface GerichtsferienMatch {
  inRecess: boolean;
  period?: "easter" | "summer" | "winter";
  start?: string;
  end?: string;
}

/**
 * Art. 145 Abs. 1 ZPO statutory court recess windows (Gerichtsferien):
 * a. 7th day before Easter through 7th day after Easter inclusive
 * b. 15 July through 15 August inclusive
 * c. 18 December through 2 January inclusive
 */
export function checkZpoGerichtsferien(iso: string): GerichtsferienMatch {
  const d = parseIsoDate(iso);
  const year = d.getUTCFullYear();

  const easter = easterSunday(year);
  const easterStart = addDays(easter, -7);
  const easterEnd = addDays(easter, 7);
  if (iso >= easterStart && iso <= easterEnd) {
    return { inRecess: true, period: "easter", start: easterStart, end: easterEnd };
  }

  const summerStart = `${year}-07-15`;
  const summerEnd = `${year}-08-15`;
  if (iso >= summerStart && iso <= summerEnd) {
    return { inRecess: true, period: "summer", start: summerStart, end: summerEnd };
  }

  // Winter recess crosses Dec 18 (year) -> Jan 2 (year+1)
  if (iso >= `${year}-12-18`) {
    return { inRecess: true, period: "winter", start: `${year}-12-18`, end: `${year + 1}-01-02` };
  }
  if (iso <= `${year}-01-02`) {
    return { inRecess: true, period: "winter", start: `${year - 1}-12-18`, end: `${year}-01-02` };
  }

  return { inRecess: false };
}

export interface ZpoDeadlineInput {
  triggerDate: string;
  deliveryMethod: "registered_mail" | "ordinary_mail" | "electronic" | "court_pronouncement";
  durationDays?: number;
  durationMonths?: number;
  suspensionApplies: boolean;
  canton: string; // e.g. "CH-ZH", "CH-GE", "CH-TI"
  applyArt142Abs1bis: boolean; // true for post-2025-01-01 ZPO revision
}

export interface ZpoDeadlineResult {
  effectiveTriggerDate: string;
  art142Abs1bisApplied: boolean;
  startDate: string;
  rawEndDate: string;
  finalDeadline: string;
  suspendedDays: number;
  recessPeriodsHit: string[];
  rolledForwardReasons: string[];
}

/**
 * Exact statutory Swiss Civil Procedure deadline computation (Art. 142 & Art. 145 ZPO).
 */
export function computeZpoDeadline(input: ZpoDeadlineInput): ZpoDeadlineResult {
  let effectiveTriggerDate = input.triggerDate;
  let art142Abs1bisApplied = false;

  // Art. 142 Abs. 1bis ZPO (in force since 1 Jan 2025): ordinary post (Art. 138 Abs. 4)
  // delivered on a Saturday, Sunday, or recognised holiday is deemed notified on the next business day.
  if (input.applyArt142Abs1bis && input.deliveryMethod === "ordinary_mail") {
    const check = isNonWorkingDay(input.triggerDate, input.canton);
    if (check.nonWorking) {
      const shifted = nextBusinessDay(input.triggerDate, input.canton);
      effectiveTriggerDate = shifted.date;
      art142Abs1bisApplied = true;
    }
  }

  // Art. 142 Abs. 1 ZPO: period starts running on the day following notification.
  const startDate = addDays(effectiveTriggerDate, 1);

  let suspendedDays = 0;
  const recessHitSet = new Set<string>();
  let rawEndDate: string;

  if (input.durationMonths !== undefined && input.durationMonths > 0) {
    // Month-based deadline (Art. 142 Abs. 2 ZPO):
    // If trigger occurs during recess and suspension applies, effective start shifts to first day after recess.
    let effectiveStart = startDate;
    if (input.suspensionApplies) {
      while (checkZpoGerichtsferien(effectiveStart).inRecess) {
        const hit = checkZpoGerichtsferien(effectiveStart);
        if (hit.period) recessHitSet.add(`${hit.period} (${hit.start}..${hit.end})`);
        suspendedDays += 1;
        effectiveStart = addDays(effectiveStart, 1);
      }
    }
    rawEndDate = addMonthsLegal(effectiveStart, input.durationMonths);
    // If end falls inside recess and suspension applies, extend by days overlapping recess
    if (input.suspensionApplies) {
      let cursor = effectiveStart;
      let extra = 0;
      while (cursor <= rawEndDate) {
        const hit = checkZpoGerichtsferien(cursor);
        if (hit.inRecess) {
          if (hit.period) recessHitSet.add(`${hit.period} (${hit.start}..${hit.end})`);
          extra += 1;
        }
        cursor = addDays(cursor, 1);
      }
      suspendedDays += extra;
      let extended = rawEndDate;
      let remaining = extra;
      while (remaining > 0) {
        extended = addDays(extended, 1);
        const hit = checkZpoGerichtsferien(extended);
        if (hit.inRecess) {
          if (hit.period) recessHitSet.add(`${hit.period} (${hit.start}..${hit.end})`);
          suspendedDays += 1;
        } else {
          remaining -= 1;
        }
      }
      rawEndDate = extended;
    }
  } else {
    const days = input.durationDays ?? 0;
    if (days <= 0) {
      rawEndDate = effectiveTriggerDate;
    } else {
      let counted = 0;
      let cur = startDate;
      while (true) {
        const hit = input.suspensionApplies ? checkZpoGerichtsferien(cur) : { inRecess: false };
        if (hit.inRecess) {
          suspendedDays += 1;
          if (hit.period) recessHitSet.add(`${hit.period} (${hit.start}..${hit.end})`);
        } else {
          counted += 1;
          if (counted === days) {
            rawEndDate = cur;
            break;
          }
        }
        cur = addDays(cur, 1);
      }
    }
  }

  // Art. 142 Abs. 3 ZPO: if last day falls on weekend or federal/cantonal holiday at court seat, roll to next business day.
  const rolled = nextBusinessDay(rawEndDate, input.canton);

  return {
    effectiveTriggerDate,
    art142Abs1bisApplied,
    startDate,
    rawEndDate,
    finalDeadline: rolled.date,
    suspendedDays,
    recessPeriodsHit: Array.from(recessHitSet),
    rolledForwardReasons: rolled.reasons,
  };
}

export interface OrTerminationDateInput {
  noticeReceivedDate: string;
  noticeMonths: number;
  inProbation: boolean;
  probationDays?: number;
  incapacityDuringNoticeDays?: number;
  sperrfristCapDays?: number;
  extraParentalLeaveDays?: number;
  endOfMonthOnly?: boolean;
}

export interface OrTerminationDateResult {
  ordinaryEndDate: string;
  suspendedIncapacityDays: number;
  extendedBeforeTermSnap: string;
  finalEndDate: string;
  snappedToEndOfMonth: boolean;
}

/**
 * Exact Swiss OR Art. 335b / Art. 335c / Art. 336c Abs. 2-3 employment termination date calculation.
 */
export function computeOrTerminationEndDate(input: OrTerminationDateInput): OrTerminationDateResult {
  if (input.inProbation) {
    const days = input.probationDays ?? 7;
    const end = addDays(input.noticeReceivedDate, days);
    return {
      ordinaryEndDate: end,
      suspendedIncapacityDays: 0,
      extendedBeforeTermSnap: end,
      finalEndDate: end,
      snappedToEndOfMonth: false,
    };
  }

  const endOfMonthOnly = input.endOfMonthOnly ?? true;
  // Standard Swiss OR rule (Art. 335c Abs. 1): notice received in month M with N months' notice
  // runs over N full calendar months and ends on the last day of month M + N.
  const baseMonthTarget = addMonthsLegal(input.noticeReceivedDate, input.noticeMonths);
  const ordinaryEndDate = endOfMonthOnly ? endOfMonth(baseMonthTarget) : baseMonthTarget;

  // Art. 336c Abs. 2 OR: incapacity arising AFTER notice suspends the running notice period
  // up to the applicable statutory Sperrfrist cap (30 / 90 / 180 days).
  const rawIncapacity = Math.max(0, input.incapacityDuringNoticeDays ?? 0);
  const cap = input.sperrfristCapDays ?? rawIncapacity;
  const suspendedIncapacityDays = Math.min(rawIncapacity, cap);

  // Art. 335c Abs. 3 OR: unused other-parent leave extends notice period.
  const extraParental = Math.max(0, input.extraParentalLeaveDays ?? 0);

  const totalExtensionDays = suspendedIncapacityDays + extraParental;
  const extendedBeforeTermSnap = addDays(ordinaryEndDate, totalExtensionDays);

  // Art. 336c Abs. 3 OR: if extended date does not fall on end-of-month, prolong to next end-of-month.
  let finalEndDate = extendedBeforeTermSnap;
  let snappedToEndOfMonth = false;
  if (totalExtensionDays > 0 && endOfMonthOnly) {
    const snapped = endOfMonth(extendedBeforeTermSnap);
    if (snapped !== extendedBeforeTermSnap) {
      finalEndDate = snapped;
      snappedToEndOfMonth = true;
    }
  }

  return {
    ordinaryEndDate,
    suspendedIncapacityDays,
    extendedBeforeTermSnap,
    finalEndDate,
    snappedToEndOfMonth,
  };
}

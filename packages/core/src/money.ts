import type { MoneyValue } from "./types.ts";

/**
 * Exact fixed-point decimal arithmetic backed by BigInt (scale = 4 decimal places internally,
 * formatted to 2 decimal places for CHF/EUR/GBP legal amounts).
 * Eliminates all IEEE-754 floating-point drift in statutory calculations.
 */
const SCALE = 10_000n;
const SCALE_DIGITS = 4;

export function parseDecimalScaled(raw: string | number): bigint {
  const s = typeof raw === "number" ? raw.toString() : raw.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!match) {
    throw new Error(`Invalid exact decimal value: "${raw}"`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = BigInt(match[2] ?? "0");
  const fracRaw = (match[3] ?? "").slice(0, SCALE_DIGITS).padEnd(SCALE_DIGITS, "0");
  const frac = BigInt(fracRaw || "0");
  return sign * (whole * SCALE + frac);
}

export function formatDecimalScaled(scaled: bigint, decimals = 2): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const divisor = 10n ** BigInt(SCALE_DIGITS - decimals);
  // Half-up rounding
  const half = divisor / 2n;
  const rounded = (abs + half) / divisor;
  const factor = 10n ** BigInt(decimals);
  const whole = rounded / factor;
  const frac = (rounded % factor).toString().padStart(decimals, "0");
  return `${neg ? "-" : ""}${whole.toString()}.${frac}`;
}

/**
 * Swiss 5-Rappen rounding (Fünfräppler-Rundung) when legally applicable to CHF sums.
 */
export function roundSwissFiveRappen(money: MoneyValue): MoneyValue {
  const cents = Math.round(Number(parseDecimalScaled(money.amount)) / 100);
  const roundedCents = Math.round(cents / 5) * 5;
  const scaled = BigInt(roundedCents) * 100n;
  return {
    amount: formatDecimalScaled(scaled, 2),
    currency: money.currency,
  };
}

export function moneyAdd(values: MoneyValue[]): MoneyValue {
  if (values.length === 0) {
    return { amount: "0.00", currency: "CHF" };
  }
  const currency = values[0]!.currency;
  let sum = 0n;
  for (const v of values) {
    if (v.currency !== currency) {
      throw new Error(`Currency mismatch: cannot add ${v.currency} and ${currency}`);
    }
    sum += parseDecimalScaled(v.amount);
  }
  return { amount: formatDecimalScaled(sum, 2), currency };
}

export function moneySub(left: MoneyValue, right: MoneyValue): MoneyValue {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: cannot subtract ${right.currency} from ${left.currency}`);
  }
  const diff = parseDecimalScaled(left.amount) - parseDecimalScaled(right.amount);
  return { amount: formatDecimalScaled(diff, 2), currency: left.currency };
}

export function moneyMul(money: MoneyValue, factor: string | number): MoneyValue {
  const m = parseDecimalScaled(money.amount);
  const f = parseDecimalScaled(factor);
  const product = (m * f) / SCALE;
  return { amount: formatDecimalScaled(product, 2), currency: money.currency };
}

export function moneyCompare(left: MoneyValue, right: MoneyValue): -1 | 0 | 1 {
  if (left.currency !== right.currency) {
    throw new Error(`Currency mismatch: cannot compare ${left.currency} and ${right.currency}`);
  }
  const a = parseDecimalScaled(left.amount);
  const b = parseDecimalScaled(right.amount);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function moneyMin(values: MoneyValue[]): MoneyValue {
  if (values.length === 0) throw new Error("moneyMin requires at least one value");
  return values.reduce((acc, cur) => (moneyCompare(cur, acc) < 0 ? cur : acc));
}

export function moneyMax(values: MoneyValue[]): MoneyValue {
  if (values.length === 0) throw new Error("moneyMax requires at least one value");
  return values.reduce((acc, cur) => (moneyCompare(cur, acc) > 0 ? cur : acc));
}

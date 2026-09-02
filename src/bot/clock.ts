export const ANKARA_TZ = "Europe/Istanbul";

export function ankaraNow(at = new Date()): Date {
  return at;
}

export function ankaraDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ANKARA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function formatAnkaraShort(at: Date | number = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: ANKARA_TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(at));
}

export function ankaraDayStartMs(at = new Date()): number {
  return new Date(`${ankaraDay(at)}T00:00:00+03:00`).getTime();
}

export function formatAnkaraClock(at = new Date()): string {
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: ANKARA_TZ,
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(at);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: ANKARA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
  return `${date}, ${time} (Ankara, Turkey — Europe/Istanbul, UTC+3, no DST)`;
}

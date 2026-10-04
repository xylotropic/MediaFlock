export type CalendarView = "week" | "month" | "list";

function dateAtNoon(day: string) {
  return new Date(day + "T12:00:00Z");
}
function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
export function calendarDayKey(value: string | Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function moveCalendarDate(
  day: string,
  view: CalendarView,
  direction: number,
) {
  const date = dateAtNoon(day);
  if (view === "week") date.setUTCDate(date.getUTCDate() + direction * 7);
  else {
    const originalDay = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    date.setUTCDate(Math.min(originalDay, last));
  }
  return dayKey(date);
}
export function calendarDays(day: string, view: "week" | "month") {
  const start = dateAtNoon(day);
  if (view === "month") start.setUTCDate(1);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  return Array.from({ length: view === "month" ? 42 : 7 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    return dayKey(date);
  });
}
export function calendarRange(day: string, view: CalendarView) {
  if (view === "week") {
    const days = calendarDays(day, "week");
    return { start: days[0], end: days[6] };
  }
  const date = dateAtNoon(day);
  date.setUTCDate(1);
  const start = dayKey(date);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return { start, end: dayKey(date) };
}

export function calendarDateLabel(
  day: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(dateAtNoon(day));
}

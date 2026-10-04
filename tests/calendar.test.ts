import { describe, expect, it } from "vitest";
import {
  calendarDayKey,
  calendarDays,
  calendarRange,
  moveCalendarDate,
} from "../apps/web/components/calendar-utils";

describe("publication calendar dates", () => {
  it("uses the workspace day across midnight and daylight saving changes", () => {
    expect(calendarDayKey("2026-10-04T01:30:00Z", "America/New_York")).toBe(
      "2026-10-03",
    );
    expect(calendarDayKey("2026-03-08T06:30:00Z", "America/New_York")).toBe(
      "2026-03-08",
    );
    expect(calendarDayKey("2026-03-08T07:30:00Z", "America/New_York")).toBe(
      "2026-03-08",
    );
    expect(calendarDayKey("2026-01-01T00:30:00Z", "America/Los_Angeles")).toBe(
      "2025-12-31",
    );
  });
  it("builds complete Monday-first month grids including leap day", () => {
    const days = calendarDays("2028-02-15", "month");
    expect(days).toHaveLength(42);
    expect(days[0]).toBe("2028-01-31");
    expect(days[41]).toBe("2028-03-12");
    expect(days).toContain("2028-02-29");
    expect(new Set(days).size).toBe(42);
  });
  it("uses one selected month for List and an inclusive week for Week", () => {
    expect(calendarRange("2026-10-03", "list")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(calendarRange("2026-10-03", "week")).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
    });
    expect(calendarDays("2026-10-03", "week")).toEqual([
      "2026-09-28",
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
    ]);
  });
  it("clamps short months and navigates across years without skipping a month", () => {
    expect(moveCalendarDate("2026-01-31", "month", 1)).toBe("2026-02-28");
    expect(moveCalendarDate("2028-01-31", "list", 1)).toBe("2028-02-29");
    expect(moveCalendarDate("2026-12-20", "month", 1)).toBe("2027-01-20");
    expect(moveCalendarDate("2026-01-02", "week", -1)).toBe("2025-12-26");
  });
});

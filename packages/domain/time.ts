import { Temporal } from "@js-temporal/polyfill";
import { DomainError } from "./errors";
export function localToUtc(
  local: string,
  timeZone: string,
  disambiguation: "reject" | "earlier" | "later" = "reject",
) {
  try {
    return Temporal.PlainDateTime.from(local)
      .toZonedDateTime(timeZone, { disambiguation })
      .toInstant()
      .toString();
  } catch {
    throw new DomainError(
      "invalid_local_time",
      "This local time is missing or repeated at a daylight-saving transition. Choose a different time or specify earlier/later.",
    );
  }
}
export function displayTime(utc: string, timeZone = "America/New_York") {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(utc));
}

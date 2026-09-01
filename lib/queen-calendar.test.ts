import { expect, test } from "vitest";
import { queenExclusionForDate } from "./queen-calendar";

test("excludes Sundays and Indonesian national holidays from Queen rewards", () => {
  expect(queenExclusionForDate("2026-08-02")).toEqual({ code: "sunday", label: "Ahad" });
  expect(queenExclusionForDate("2026-08-17")).toEqual({ code: "national_holiday", label: "Hari Kemerdekaan RI" });
  expect(queenExclusionForDate("2026-01-16")).toEqual({ code: "national_holiday", label: "Isra Mikraj Nabi Muhammad ﷺ" });
  expect(queenExclusionForDate("2026-08-25")).toEqual({ code: "national_holiday", label: "Maulid Nabi Muhammad ﷺ" });
});

test("keeps normal workdays and collective leave eligible by default", () => {
  expect(queenExclusionForDate("2026-08-24")).toBeNull();
  expect(queenExclusionForDate("2026-05-15")).toBeNull();
});

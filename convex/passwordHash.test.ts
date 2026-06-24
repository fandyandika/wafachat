import { expect, test } from "vitest";
import { hashPassword, verifyPassword } from "./passwordHash";

test("hashPassword/verifyPassword round-trips and rejects wrong password", async () => {
  const stored = await hashPassword("s3cret-pw");
  expect(stored.startsWith("pbkdf2$")).toBe(true);
  expect(await verifyPassword("s3cret-pw", stored)).toBe(true);
  expect(await verifyPassword("wrong", stored)).toBe(false);
});

test("verifyPassword returns false on malformed/tampered hash", async () => {
  expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  const stored = await hashPassword("abc");
  const tampered = stored.slice(0, -2) + "00";
  expect(await verifyPassword("abc", tampered)).toBe(false);
});

import { describe, expect, test } from "bun:test";
import { hasRole, rolesBeyond, skipsChecks } from "../src/auth/roles";
import { describeEvent } from "../src/services/audit.service";

describe("hasRole", () => {
  test("a role counts when held", () => {
    expect(hasRole(["override"], "override")).toBe(true);
    expect(hasRole(["override"], "review_chats")).toBe(false);
    expect(hasRole([], "override")).toBe(false);
  });

  test("admins hold every role", () => {
    expect(hasRole(["admin"], "override")).toBe(true);
    expect(hasRole(["admin"], "manage_users")).toBe(true);
  });
});

describe("skipsChecks", () => {
  test("no_check and admin skip the checks; nobody else does", () => {
    expect(skipsChecks(["no_check"])).toBe(true);
    expect(skipsChecks(["admin"])).toBe(true);
    expect(skipsChecks(["override", "review_chats"])).toBe(false);
    expect(skipsChecks([])).toBe(false);
  });
});

describe("rolesBeyond: nobody hands out more than they hold", () => {
  test("manage_users alone can't grant admin or anything else they lack", () => {
    expect(rolesBeyond(["manage_users"], ["admin", "no_check"])).toEqual(["admin", "no_check"]);
  });

  test("roles you hold can be granted", () => {
    expect(rolesBeyond(["manage_users", "review_chats"], ["review_chats"])).toEqual([]);
  });

  test("admins can grant anything", () => {
    expect(rolesBeyond(["admin"], ["admin", "override", "no_check"])).toEqual([]);
  });
});

describe("describeEvent: role-related summaries", () => {
  test.each([
    ["user_created", { email: "a@b.com", roles: ["override", "review_chats"] }, "Created the user a@b.com (Can override checks, Reviews chats)."],
    ["user_created", { email: "a@b.com", roles: [] }, "Created the user a@b.com."],
    // entries from before roles
    ["user_created", { email: "a@b.com", isAdmin: true }, "Created the user a@b.com (Admin)."],
    ["user_roles_changed", { email: "a@b.com", added: ["no_check"], removed: ["override"] },
      "Changed a@b.com's roles: gave them Not checked; took away Can override checks."],
    ["block_overridden", { messageIndex: 0, findings: [{ title: "Social Security number", checker: "ssn" }] },
      "Sent as written, overriding the checks: Social Security number."],
    ["sent_unchecked", { messageIndex: 0, because: "no_check" }, "Message sent without checks (this user's messages aren't checked)."],
    ["conversation_reviewed", { owner: "a@b.com", title: "Quarterly numbers" }, 'Read a@b.com\'s conversation "Quarterly numbers".'],
  ])("%s", (event, details, expected) => {
    expect(describeEvent(event, details)).toBe(expected);
  });
});

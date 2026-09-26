import { describe, expect, test } from "bun:test";
import { runStaticChecks } from "../src/checkers/run-static-checks";

// What each checker flagged in `text`, as "checker:contents"
const detect = (text: string) =>
  runStaticChecks(text).map((d) => `${d.checker}:${d.contents}`);

const cases: Record<string, { hits: [string, string][]; misses: string[] }> = {
  ssn: {
    hits: [
      ["My SSN is 123-45-6789.", "123-45-6789"],
      ["ssn 123 45 6789", "123 45 6789"],
      ["SSN: 123456789", "123456789"],
      ["social security number #123456789", "123456789"],
    ],
    misses: [
      "000-12-3456", // area 000 is never issued
      "666-12-3456",
      "900-12-3456",
      "123-00-4567",
      "order 123456789 shipped", // bare 9 digits, no label
      "part no. 123-45-67890",
    ],
  },
  "credit-card": {
    hits: [
      ["card 4111 1111 1111 1111 exp 12/27", "4111 1111 1111 1111"],
      ["4111-1111-1111-1111", "4111-1111-1111-1111"],
      ["amex 378282246310005", "378282246310005"],
      ["mc 5555555555554444.", "5555555555554444"],
      ["new mc 2223003122003222", "2223003122003222"],
    ],
    misses: [
      "4111 1111 1111 1112", // fails Luhn
      "tracking 1234567890123456", // no card prefix
      "timestamp 1727389012345",
    ],
  },
  email: {
    hits: [
      ["email jane.doe+work@example.co.uk today", "jane.doe+work@example.co.uk"],
      ["<bob@corp.example.com>", "bob@corp.example.com"],
    ],
    misses: ["use the @decorator syntax", "npm i @hono/swagger-ui@0.6.1"],
  },
  phone: {
    hits: [
      ["call (212) 555-1234", "(212) 555-1234"],
      ["cell: 212-555-1234", "212-555-1234"],
      ["+1 212.555.1234", "+1 212.555.1234"],
      ["UK office +44 20 7946 0958", "+44 20 7946 0958"],
    ],
    misses: [
      "id 2125551234", // no separators
      "released 2024-09-26",
      "version 1.212.555",
      "123-456-7890", // area/exchange can't start with 1
    ],
  },
  "bank-account": {
    hits: [
      ["IBAN GB82 WEST 1234 5698 7654 32", "GB82 WEST 1234 5698 7654 32"],
      ["DE89370400440532013000", "DE89370400440532013000"],
      ["routing number: 021000021", "021000021"],
      ["ABA 011000015", "011000015"],
      ["account number: 12345678901", "12345678901"],
      ["acct# 0012-3456-78", "0012-3456-78"],
    ],
    misses: [
      "GB82 WEST 1234 5698 7654 33", // bad IBAN checksum
      "routing 123456789", // bad ABA checksum
      "the account for over 1000000 users",
      "account 42",
    ],
  },
  "date-of-birth": {
    hits: [
      ["DOB: 04/12/1985", "04/12/1985"],
      ["date of birth 1985-04-12", "1985-04-12"],
      ["born on March 3rd, 1990", "March 3rd, 1990"],
      ["Birthdate: 3 March 1990", "3 March 1990"],
    ],
    misses: ["meeting on 04/12/2025", "Q3 report due March 3, 2026"],
  },
  secret: {
    hits: [
      ["key AKIAIOSFODNN7EXAMPLE ok", "AKIAIOSFODNN7EXAMPLE"],
      ["ghp_" + "a".repeat(36), "ghp_" + "a".repeat(36)],
      ["xoxb-1234567890-abcdefghij", "xoxb-1234567890-abcdefghij"],
      ["sk_live_" + "4eC39HqLyjWDarjtT1zdp7dc", "sk_live_4eC39HqLyjWDarjtT1zdp7dc"],
      ["sk-ant-api03-" + "x".repeat(30), "sk-ant-api03-" + "x".repeat(30)],
      ["sk-proj-" + "Ab1".repeat(10), "sk-proj-" + "Ab1".repeat(10)],
      ["AIza" + "B".repeat(35), "AIza" + "B".repeat(35)],
      [
        "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----",
      ],
      [
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.abcdefghijklmnop",
        "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOjF9.abcdefghijklmnop",
      ],
      ["postgres://myuser:hunter2@db:5432/app", "postgres://myuser:hunter2@db:5432"],
    ],
    misses: [
      "risk-assessment and task-management", // "sk-" inside words
      "https://example.com/path",
      "postgres://db:5432/app",
    ],
  },
};

for (const [checker, { hits, misses }] of Object.entries(cases)) {
  describe(checker, () => {
    test.each(hits)("flags %p", (text, expected) => {
      expect(detect(text)).toContain(`${checker}:${expected}`);
    });

    test.each(misses)("ignores %p", (text) => {
      expect(detect(text).filter((d) => d.startsWith(`${checker}:`))).toEqual([]);
    });
  });
}

// Any detection blocks the request, so everyday prompts must come back clean
describe("ordinary prompts", () => {
  test.each([
    "Summarize Q3 2026 earnings: revenue rose 12% to $1,234,567,890.",
    "Compare the 10-year treasury yield (4.25%) with the S&P 500 return since 2019-01-01.",
    "Write a SQL query joining orders and customers on customer_id where total > 1000.",
    "Fix this TypeScript: const x: number = parseInt('42', 10);",
    "Our ticket JIRA-12345 mentions build 20260926.1 failing on node 22.",
    "Draft an email to the team about the offsite on March 3, 2026 at 10:30.",
    "What's the ISIN format? e.g. US0378331005 for Apple.",
    "Explain how risk-management and task-scheduling differ.",
    "Price target raised from 145.50 to 162.00; volume 3,456,789 shares.",
  ])("%p", (text) => {
    expect(detect(text)).toEqual([]);
  });
});

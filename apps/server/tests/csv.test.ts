import { expect, test } from "bun:test";
import { csvCell, csvRow } from "../src/services/csv";

test.each([
  ["plain", "plain"],
  [null, ""],
  [42, "42"],
  ['say "hi", ok', '"say ""hi"", ok"'],
  ["two\nlines", '"two\nlines"'],
  // would run as a formula in a spreadsheet
  ['=HYPERLINK("http://evil","x")', `"'=HYPERLINK(""http://evil"",""x"")"`],
  ["+1 555", "'+1 555"],
  ["-2+3", "'-2+3"],
  ["@SUM(A1)", "'@SUM(A1)"],
  ["\tx", "'\tx"],
  [{ a: 1 }, '"{""a"":1}"'],
])("%p → %p", (value, cell) => {
  expect(csvCell(value)).toBe(cell);
});

test("rows end in CRLF", () => {
  expect(csvRow(["a", 1, null])).toBe("a,1,\r\n");
});

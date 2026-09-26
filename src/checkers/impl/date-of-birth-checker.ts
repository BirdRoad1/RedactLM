import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";

// A date alone isn't PII; a date labelled as a birth date is
const date = String.raw`(?:\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? \d{1,2}(?:st|nd|rd|th)?,? \d{4}|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,? \d{4})`;
const label = String.raw`\b(?:dob|d\.o\.b\.?|date of birth|birth ?date|birthday|born(?: on)?)`;

export default buildRegexChecker('date-of-birth', [
    { expression: new RegExp(String.raw`(?<=${label}[\s:,-]{0,3})${date}`, 'gi'), confidence: Confidence.PROBABLY },
], 'PII: This looks like a date of birth');

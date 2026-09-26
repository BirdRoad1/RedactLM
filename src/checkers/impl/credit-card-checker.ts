import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";
import { isCardNumber } from "../validators";

// 13-19 digits, optionally grouped with spaces or dashes; must pass Luhn and
// start with a real card network prefix
export default buildRegexChecker('credit-card', [
    { expression: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, confidence: Confidence.ABSOLUTELY, validate: isCardNumber },
], 'PII: This looks like a credit or debit card number');

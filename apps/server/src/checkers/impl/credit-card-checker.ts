import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";
import { isCardNumber } from "../validators";

// 13-19 digits, optionally grouped with spaces or dashes; must pass Luhn and
// start with a real card network prefix
export default buildRegexChecker('credit-card', [
    { expression: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g, confidence: Confidence.ABSOLUTELY, validate: isCardNumber },
], {
    title: "Card number",
    userFacingReason: "This looks like a credit or debit card number.",
    explanation: "Card numbers can be used for fraud if they leak. Leave the number out; if you need to refer to the card, the last four digits are enough.",
});

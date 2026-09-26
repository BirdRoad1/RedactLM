import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";

export default buildRegexChecker('phone', [
    // US/NANP with separators: (212) 555-1234, 212-555-1234, +1 212.555.1234.
    // Separators are required so plain 10-digit ids don't match.
    {
        expression: /(?<![\w-])(?:\+?1[ .-]?)?(?:\([2-9]\d{2}\) ?|[2-9]\d{2}[ .-])[2-9]\d{2}[ .-]\d{4}(?![\w-])/g,
        confidence: Confidence.MAYBE,
    },
    // International E.164: +44 20 7946 0958, +442079460958
    {
        expression: /(?<![\w+])\+(?:[2-9]\d{0,2})(?:[ .-]?\d){6,13}(?![\w-])/g,
        confidence: Confidence.MAYBE,
    },
], 'PII: This looks like a phone number');

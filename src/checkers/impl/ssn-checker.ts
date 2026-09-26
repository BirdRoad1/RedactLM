import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";
import { isValidSsn } from "../validators";

export default buildRegexChecker('ssn', [
    { expression: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, confidence: Confidence.PROBABLY, validate: isValidSsn },
    { expression: /(?<!\d ?)\d{3} \d{2} \d{4}(?! ?\d)/g, confidence: Confidence.MAYBE, validate: isValidSsn },
    // bare 9 digits is too common on its own, so only right after an SSN/TIN label
    { expression: /(?<=\b(?:ssn|social security(?: number| no\.?| #)?|tin|itin)[\s:#.]{0,3})\d{9}(?!\d)/gi, confidence: Confidence.ABSOLUTELY, validate: isValidSsn },
], 'PII: This looks like a Social Security Number');

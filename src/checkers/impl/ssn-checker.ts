import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";
import { isValidSsn } from "../validators";

export default buildRegexChecker('ssn', [
    { expression: /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g, confidence: Confidence.PROBABLY, validate: isValidSsn },
    { expression: /(?<!\d ?)\d{3} \d{2} \d{4}(?! ?\d)/g, confidence: Confidence.MAYBE, validate: isValidSsn },
    // bare 9 digits is too common on its own, so only right after an SSN/TIN label
    { expression: /(?<=\b(?:ssn|social security(?: number| no\.?| #)?|tin|itin)[\s:#.]{0,3})\d{9}(?!\d)/gi, confidence: Confidence.ABSOLUTELY, validate: isValidSsn },
], {
    title: "Social Security number",
    userFacingReason: "This looks like a Social Security number.",
    explanation: "A Social Security number identifies a person for life and is a favorite target for identity theft. Leave it out, or describe it in general terms instead.",
});

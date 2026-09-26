import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";
import { isValidIban, isValidRoutingNumber } from "../validators";

export default buildRegexChecker('bank-account', [
    // IBAN, checksum-validated: GB82 WEST 1234 5698 7654 32
    { expression: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g, confidence: Confidence.ABSOLUTELY, validate: isValidIban },
    // US routing number, only after a label since 9 digits alone is too common
    {
        expression: /(?<=\b(?:routing|aba|rtn)(?: number| no\.?| #)?[\s:#.]{0,3})\d{9}(?!\d)/gi,
        confidence: Confidence.PROBABLY,
        validate: isValidRoutingNumber,
    },
    // Account numbers have no fixed format, so only after an explicit label
    {
        expression: /(?<=\b(?:account|acct\.?)(?: number| no\.?| #|#)[\s:#.]{0,3})\d(?:-?\d){5,16}(?![\d-])/gi,
        confidence: Confidence.PROBABLY,
    },
], 'PII: This looks like a bank account or routing number');

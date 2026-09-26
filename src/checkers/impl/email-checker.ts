import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";

export default buildRegexChecker('email', [
    { expression: /(?<![\w.%+-])[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?![\w-])/gi, confidence: Confidence.PROBABLY },
], 'PII: This looks like an email address');

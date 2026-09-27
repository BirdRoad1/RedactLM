import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";

export default buildRegexChecker('email', [
    { expression: /(?<![\w.%+-])[\w.%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?![\w-])/gi, confidence: Confidence.PROBABLY },
], {
    title: "Email address",
    userFacingReason: "This looks like an email address.",
    explanation: "Email addresses identify people and can be misused for spam or phishing. Use a placeholder such as name@example.com instead.",
});

import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";

// `(?![\w-])` instead of `\b` because many of these keys end in `-` or `_`
export default buildRegexChecker('secret', [
    // AWS access key id
    { expression: /\b(?:AKIA|ASIA)[0-9A-Z]{16}(?![\w-])/g, confidence: Confidence.YUP },
    // GitHub tokens
    { expression: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_\w{22,})(?![\w-])/g, confidence: Confidence.YUP },
    // Slack tokens
    { expression: /\bxox[abprs]-[A-Za-z0-9-]{10,}(?![\w-])/g, confidence: Confidence.YUP },
    // Stripe secret/restricted keys
    { expression: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{16,}(?![\w-])/g, confidence: Confidence.YUP },
    // Anthropic keys
    { expression: /\bsk-ant-[\w-]{20,}/g, confidence: Confidence.YUP },
    // OpenAI keys (Anthropic's handled above)
    { expression: /\bsk-(?!ant-)(?:proj-|svcacct-|admin-)?[\w-]{20,}/g, confidence: Confidence.ABSOLUTELY },
    // Google API keys
    { expression: /\bAIza[\w-]{35}(?![\w-])/g, confidence: Confidence.YUP },
    // PEM private keys, through the END line when it's there
    { expression: /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z]+ )*PRIVATE KEY-----|$)/g, confidence: Confidence.YUP },
    // JWTs (header and payload both start with base64 `{"`)
    { expression: /\beyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,}/g, confidence: Confidence.PROBABLY },
    // Credentials in connection strings: postgres://user:pass@host
    { expression: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@[^\s/]+/gi, confidence: Confidence.ABSOLUTELY },
], {
    title: "Password or access key",
    userFacingReason: "This looks like a password, access key or token.",
    explanation: "Anyone who sees a key or password can use it to get into our systems. Remove it, and have it changed if it was shared anywhere.",
});

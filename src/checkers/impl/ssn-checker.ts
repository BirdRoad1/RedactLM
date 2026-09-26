import { buildRegexChecker } from "../checker";
import { Confidence } from "../confidence";

export default buildRegexChecker('ssn', [{ expression: /\d{3}-\d{2}-\d{4}/g, confidence: Confidence.PROBABLY }]);

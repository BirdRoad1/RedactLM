import { Confidence } from "./confidence";

export enum DetectionType {
    STATIC,
    LOCAL_LLM
};

export interface Detection {
    checker: string;
    contents: string;
    start: number;
    end: number;
    confidence: number; // 0-1
    reason: string;           // technical, for logs: which rule matched
    userFacingReason: string; // one sentence, e.g. "This looks like a phone number."
    title: string;            // short name for the issue, e.g. "Phone number"
    explanation: string;      // why it matters and what to do instead
    type: DetectionType;
}

// Plain-language wording shown to people; never checker names or numbers
export type IssueWording = Pick<Detection, "title" | "userFacingReason" | "explanation">;


// check: (prompt: string) => { // TODO: file support
//         ranges: DetectionRange[];
//         checkersTested: string[];
//     };
export type Checker = {
    name: string; // must be unique
    check: (prompt: string) => Detection[]; // TODO: file support
}

export type RegexCheck = {
    expression: RegExp;
    confidence: Confidence;
    // extra check on the matched text (e.g. a checksum) to cut false positives
    validate?: (match: string) => boolean;
}

export function buildRegexChecker(name: string, expressions: RegexCheck[], wording: IssueWording): Checker {
    return {
        name,
        check(prompt) {
            const detections: Detection[] = [];
            for (const regex of expressions) {
                const matches = [...prompt.matchAll(regex.expression)];

                matches.forEach(m => {
                    if (regex.validate && !regex.validate(m[0])) return;

                    detections.push({
                        checker: name,
                        contents: m[0],
                        confidence: regex.confidence,
                        start: m.index,
                        end: m.index + m[0].length,
                        reason: 'Matched regex rule: ' + String(regex.expression),
                        type: DetectionType.STATIC,
                        ...wording,
                    });
                })

            }

            return detections;
        },
    };
}
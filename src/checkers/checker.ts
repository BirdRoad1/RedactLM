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
    reason: string;
    userFacingReason: string;
    type: DetectionType;
}


// check: (prompt: string) => { // TODO: file support
//         ranges: DetectionRange[];
//         checkersTested: string[];
//     };
export type Checker = {
    name: string; // must be unique
    check: (prompt: string) => Detection[]; // TODO: file support
}

export type RegexCheck = { expression: RegExp; confidence: Confidence }

export function buildRegexChecker(name: string, expressions: RegexCheck[], userFacingReason: string): Checker {
    return {
        name,
        check(prompt) {
            const detections: Detection[] = [];
            for (const regex of expressions) {
                const matches = [...prompt.matchAll(regex.expression)];

                matches.forEach(m => {
                    detections.push({
                        checker: name,
                        contents: m[0],
                        confidence: regex.confidence,
                        start: m.index,
                        end: m.index + m[0].length,
                        reason: 'Matched regex rule: ' + String(regex.expression),
                        type: DetectionType.STATIC,
                        userFacingReason: userFacingReason
                    });
                })

            }

            return detections;
        },
    };
}
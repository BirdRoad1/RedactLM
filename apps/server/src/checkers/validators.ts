// Checksums and format rules that turn "looks like" into "almost certainly is"

const digitsOf = (text: string) => text.replace(/\D/g, "");

// Credit/debit cards: Luhn checksum
export function luhn(text: string) {
    const digits = digitsOf(text);
    let sum = 0;
    for (let i = 0; i < digits.length; i++) {
        let d = Number(digits[digits.length - 1 - i]);
        if (i % 2 === 1) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
    }
    return digits.length > 0 && sum % 10 === 0;
}

// Visa, Mastercard, Amex, Discover, Diners, JCB, UnionPay prefixes + lengths
export function isCardNumber(text: string) {
    const digits = digitsOf(text);
    const prefixOk = /^(?:4\d{12}(?:\d{3}){0,2}|5[1-5]\d{14}|2(?:2[2-9]|[3-6]\d|7[01])\d{13}|2720\d{12}|3[47]\d{13}|6(?:011|5\d{2}|4[4-9]\d)\d{12,15}|3(?:0[0-5]|[68]\d)\d{11,16}|35(?:2[89]|[3-8]\d)\d{12,15}|62\d{14,17})$/.test(digits);
    return prefixOk && luhn(digits);
}

// SSA never issues area 000, 666 or 900-999, group 00 or serial 0000
export function isValidSsn(text: string) {
    const digits = digitsOf(text);
    const area = digits.slice(0, 3), group = digits.slice(3, 5), serial = digits.slice(5);
    return digits.length === 9 && area !== "000" && area !== "666" && area[0] !== "9"
        && group !== "00" && serial !== "0000";
}

// IBAN: move the first 4 chars to the end, letters to numbers, mod 97 must be 1
export function isValidIban(text: string) {
    const iban = text.replace(/\s/g, "").toUpperCase();
    if (iban.length < 15 || iban.length > 34) return false;

    const rearranged = iban.slice(4) + iban.slice(0, 4);
    let remainder = 0;
    for (const char of rearranged) {
        const value = char >= "A" ? char.charCodeAt(0) - 55 : Number(char);
        remainder = Number(`${remainder}${value}`) % 97;
    }
    return remainder === 1;
}

// US ABA routing number: weighted 3-7-1 checksum
export function isValidRoutingNumber(text: string) {
    const d = digitsOf(text).split("").map(Number);
    if (d.length !== 9) return false;
    const sum = 3 * (d[0]! + d[3]! + d[6]!) + 7 * (d[1]! + d[4]! + d[7]!) + (d[2]! + d[5]! + d[8]!);
    return sum % 10 === 0 && sum > 0;
}

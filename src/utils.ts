import parsePhoneNumber from 'libphonenumber-js';

export function getNationalNumber(phone: unknown): string | undefined {
    if (typeof phone === 'string') {
        const phno = parsePhoneNumber(phone, 'US');
        return phno ? phno.countryCallingCode + phno.nationalNumber : phone;
    }
    return undefined;
}
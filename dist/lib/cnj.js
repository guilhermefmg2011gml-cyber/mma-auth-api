export function onlyDigits(s = "") {
    return String(s).replace(/\D+/g, "");
}
// Converte 20 dígitos para o formato CNJ 0000000-00.0000.0.00.0000
export function toFormattedCNJ(s = "") {
    const d = onlyDigits(s);
    if (!/^\d{20}$/.test(d))
        return null;
    return d.replace(/^(\d{7})(\d{2})(\d{4})(\d)(\d{2})(\d{4})$/, "$1-$2.$3.$4.$5.$6");
}

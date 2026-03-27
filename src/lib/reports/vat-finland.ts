/**
 * Finnish VAT reference rates (verify with your tax adviser for your facts).
 * Modeled as: stored amounts = ex-VAT (net). VAT and gross derived.
 */

export const VAT_FINLAND_GENERAL = 0.255; // 25.5% standard
export const VAT_FINLAND_REDUCED_SERVICES = 0.1; // 10% — only applied where noted in assumptions

export type VatBreakdown = {
  net: number;
  vat: number;
  gross: number;
  rate: number;
  rateLabel: string;
};

export function roundMoney2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** net is ex-VAT */
export function vatFromNet(net: number, rate: number, label: string): VatBreakdown {
  const n = roundMoney2(net);
  const rawVat = n * rate;
  const vat = roundMoney2(rawVat);
  const gross = roundMoney2(n + vat);
  return {
    net: n,
    vat,
    gross,
    rate,
    rateLabel: label,
  };
}

export function sumVatBreakdowns(rows: VatBreakdown[]): VatBreakdown {
  const net = roundMoney2(rows.reduce((s, r) => s + r.net, 0));
  const vat = roundMoney2(rows.reduce((s, r) => s + r.vat, 0));
  const gross = roundMoney2(rows.reduce((s, r) => s + r.gross, 0));
  const rate = net > 0 ? vat / net : 0;
  return {
    net,
    vat,
    gross,
    rate,
    rateLabel: "Blended (derived)",
  };
}

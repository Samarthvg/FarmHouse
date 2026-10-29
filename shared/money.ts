// Amounts travel as integer paise. Rupee strings are parsed and formatted here only.

const MAX_PAISE = 100_000_000_00; // ₹10 crore per entry, a sanity ceiling

/**
 * Parses what a person types into the amount box: "2100", "₹2,100", "800+700+600", "3*600".
 * Returns paise, or null when the input is not a positive amount.
 */
export function parseAmountExpression(input: string): number | null {
  const cleaned = input.replace(/[₹,\s]/g, '').replace(/[x×]/gi, '*');
  if (!cleaned || !/^[\d.+*]+$/.test(cleaned)) return null;
  let totalPaise = 0;
  for (const term of cleaned.split('+')) {
    if (!term) return null;
    let product = 1;
    for (const factor of term.split('*')) {
      if (!/^\d+(\.\d{1,2})?$/.test(factor)) return null;
      product *= Number(factor);
    }
    totalPaise += Math.round(product * 100);
  }
  if (totalPaise <= 0 || totalPaise > MAX_PAISE) return null;
  return totalPaise;
}

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const inrCompact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export function formatRupees(paise: number, opts: { sign?: boolean } = {}): string {
  const rupees = paise / 100;
  const body = '₹' + inr.format(Math.abs(rupees));
  if (rupees < 0) return '−' + body;
  if (opts.sign && rupees > 0) return '+' + body;
  return body;
}

export function formatRupeesCompact(paise: number): string {
  const rupees = paise / 100;
  return (rupees < 0 ? '−' : '') + '₹' + inrCompact.format(Math.abs(rupees));
}

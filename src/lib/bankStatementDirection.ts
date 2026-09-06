export type BankStatementDirection = 'entrata' | 'uscita';
export type BankStatementDirectionConfidence = 'alta' | 'media' | 'bassa';

export interface BankStatementDirectionResult {
  tipo: BankStatementDirection;
  confidence: BankStatementDirectionConfidence;
  rule: string;
  conflict: boolean;
}

function explicitCategory(text: string): BankStatementDirection | null {
  if (/\bUSCIT(?:A|E)\b/.test(text)) return 'uscita';
  if (/\bENTRAT(?:A|E)\b/.test(text)) return 'entrata';
  return null;
}

function explicitSign(rawAmount: string): BankStatementDirection | null {
  const normalized = rawAmount.replace(/[€\s]/g, '');
  if (normalized.startsWith('-')) return 'uscita';
  if (normalized.startsWith('+')) return 'entrata';
  return null;
}

function descriptionDirection(text: string): BankStatementDirection | null {
  if (
    /\bDARE\b/.test(text)
    || text.includes('ADDEBIT')
    || text.includes('DISPOSTO A FAVORE')
    || text.includes('DA VOI DISPOSTO')
    || text.includes('VOSTRA DISPOSIZIONE')
    || text.includes('PAGAMENTO RATA')
    || text.includes('PRELEV')
  ) {
    return 'uscita';
  }
  if (
    /\bAVERE\b/.test(text)
    || text.includes('ACCREDIT')
    || text.includes('DISPOSTO DA ')
    || text.includes('BONIFICO A VOSTRO FAVORE')
  ) {
    return 'entrata';
  }
  return null;
}

/**
 * Determina la direzione con questa priorità:
 * 1. categoria esplicita della banca ("Uscite Business" / "Entrate Business");
 * 2. segno esplicito dell'importo;
 * 3. causale;
 * 4. segno numerico come fallback.
 *
 * Non usa marcatori generici come " A " o " D ": la preposizione "a" in
 * "disposto a favore" era la causa della conversione errata delle uscite.
 */
export function inferBankStatementDirection(
  description: string,
  amount: number,
  rawAmount: string,
): BankStatementDirectionResult {
  const text = String(description ?? '').toUpperCase();
  const category = explicitCategory(text);
  const sign = explicitSign(rawAmount);
  const descriptionResult = descriptionDirection(text);

  if (category) {
    const conflict = Boolean(sign && sign !== category);
    return {
      tipo: category,
      confidence: conflict ? 'media' : 'alta',
      rule: conflict ? 'CATEGORIA BANCA (CONFLITTO SEGNO)' : 'CATEGORIA BANCA',
      conflict,
    };
  }

  if (sign) {
    const conflict = Boolean(descriptionResult && descriptionResult !== sign);
    return {
      tipo: sign,
      confidence: conflict ? 'media' : 'alta',
      rule: conflict ? 'SEGNO IMPORTO (CONFLITTO CAUSALE)' : 'SEGNO IMPORTO',
      conflict,
    };
  }

  if (descriptionResult) {
    return {
      tipo: descriptionResult,
      confidence: 'media',
      rule: 'CAUSALE OPERAZIONE',
      conflict: false,
    };
  }

  return {
    tipo: amount < 0 ? 'uscita' : 'entrata',
    confidence: 'bassa',
    rule: 'SEGNO NUMERICO DI FALLBACK',
    conflict: false,
  };
}

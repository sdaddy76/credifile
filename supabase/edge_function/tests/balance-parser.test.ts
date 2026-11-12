import { assertEquals } from "../deps.ts";
import {
  extractBalanceValue,
  extractBankDebtByMaturity,
  parseItalianBalanceNumber,
} from "../../functions/_shared/balance-parser.ts";

Deno.test("il parser interpreta importi italiani e placeholder senza inventare valori", () => {
  assertEquals(parseItalianBalanceNumber("1.234.567,89"), 1_234_567.89);
  assertEquals(parseItalianBalanceNumber("(1.234,50)"), -1_234.5);
  assertEquals(parseItalianBalanceNumber("—"), 0);
  assertEquals(parseItalianBalanceNumber("N/D"), null);
});

Deno.test("estrae un valore di bilancio dalla voce corrispondente", () => {
  const text = [
    "Stato Patrimoniale",
    "Totale attivo 1.234.567",
    "Totale passivo 999.000",
  ].join("\n");

  assertEquals(extractBalanceValue(text, ["Totale attivo"]), 1_234_567);
  assertEquals(extractBalanceValue(text, ["Voce assente"]), null);
});

Deno.test("separa debiti bancari a breve e lungo termine solo con scadenza esplicita", () => {
  const text = [
    "Debiti verso banche",
    "entro 12 mesi 120.000,00",
    "oltre 12 mesi 380.000,00",
  ].join("\n");

  assertEquals(extractBankDebtByMaturity(text, "breve"), 120_000);
  assertEquals(extractBankDebtByMaturity(text, "lungo"), 380_000);
});

import { assertEquals } from "../deps.ts";
import {
  financingForBalanceYear,
  transactionsForBalanceYear,
} from "../../functions/_shared/balance-period.ts";
import { selectPreviousAnnualBalance } from "../../functions/_shared/balance-anomaly-engine.ts";

Deno.test("filtra le transazioni all'esercizio analizzato", () => {
  const transactions = [
    { id: "2025", data_valuta: "2025-04-01" },
    { id: "2024", data_contabile: "31/12/2024" },
    { id: "senza-data" },
  ];

  assertEquals(transactionsForBalanceYear(transactions, 2025), [
    transactions[0],
  ]);
  assertEquals(transactionsForBalanceYear(transactions, null), transactions);
});

Deno.test("non usa snapshots finanziari successivi in un bilancio storico", () => {
  const financing = [
    { id: "precedente", data_riferimento: "2024-12-31" },
    { id: "successivo", data_riferimento: "2026-01-01" },
    { id: "senza-data" },
  ];

  assertEquals(financingForBalanceYear(financing, 2025, 2026), [financing[0]]);
  assertEquals(financingForBalanceYear(financing, 2026, 2026), financing);
});

Deno.test("seleziona solo il precedente bilancio annuale non provvisorio", () => {
  const balances = [
    { anno_esercizio: 2026, is_provvisorio: true },
    { anno_esercizio: 2027, is_provvisorio: false },
    { anno_esercizio: 2025, is_provvisorio: false, id: "annual-2025" },
  ];

  assertEquals(selectPreviousAnnualBalance(balances, 2026), balances[2]);
  assertEquals(selectPreviousAnnualBalance(balances, null), null);
});

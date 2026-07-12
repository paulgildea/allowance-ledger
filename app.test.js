import test from "node:test";
import assert from "node:assert/strict";

import {
  applyWeeklyAllowance,
  calculateBalance,
  createTransaction,
  normalizeState,
} from "./app.js";

test("weekly allowance is added once per elapsed week", () => {
  const state = applyWeeklyAllowance(
    {
      weeklyAllowance: 12.5,
      lastWeeklyAccrualAt: "2026-07-01T00:00:00.000Z",
      transactions: [],
    },
    new Date("2026-07-15T00:00:00.000Z"),
  );

  assert.equal(state.transactions.length, 2);
  assert.deepEqual(
    state.transactions.map((transaction) => transaction.amount),
    [12.5, 12.5],
  );
  assert.equal(state.lastWeeklyAccrualAt, "2026-07-15T00:00:00.000Z");
});

test("debt transactions reduce the balance", () => {
  const balance = calculateBalance([
    createTransaction({
      type: "credit",
      amount: 20,
      note: "Allowance",
      createdAt: "2026-07-01T10:00:00.000Z",
    }),
    createTransaction({
      type: "debt",
      amount: 6.25,
      note: "Toy",
      createdAt: "2026-07-02T10:00:00.000Z",
    }),
  ]);

  assert.equal(balance, 13.75);
});

test("state normalization preserves both children", () => {
  const state = normalizeState({
    children: {
      Quinn: {
        weeklyAllowance: 9,
        lastWeeklyAccrualAt: "2026-07-12T00:00:00.000Z",
        transactions: [],
      },
    },
  });

  assert.equal(state.children.Quinn.weeklyAllowance, 9);
  assert.equal(state.children.Logan.weeklyAllowance, 10);
  assert.deepEqual(state.children.Logan.transactions, []);
});

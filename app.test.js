import test from "node:test";
import assert from "node:assert/strict";

import {
  calculateBalance,
  formatCurrency,
  normalizeApiBaseUrl,
  normalizeChildName,
} from "./web/app.js";

test("formatCurrency returns usd currency", () => {
  assert.equal(formatCurrency(12.5), "$12.50");
});

test("debt transactions reduce the balance", () => {
  const balance = calculateBalance([
    {
      type: "credit",
      amount: 20,
      note: "Allowance",
      createdAt: "2026-07-01T10:00:00.000Z",
    },
    {
      type: "debt",
      amount: 6.25,
      note: "Toy",
      createdAt: "2026-07-02T10:00:00.000Z",
    },
  ]);

  assert.equal(balance, 13.75);
});

test("normalizeChildName supports Logan and Quinn", () => {
  assert.equal(normalizeChildName("logan"), "Logan");
  assert.equal(normalizeChildName(" QuInn "), "Quinn");
  assert.equal(normalizeChildName("Other"), "");
});

test("normalizeApiBaseUrl trims and removes trailing slash", () => {
  assert.equal(normalizeApiBaseUrl(" https://api.example.com/ "), "https://api.example.com");
  assert.equal(normalizeApiBaseUrl(""), "");
});

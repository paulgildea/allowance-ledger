import { app } from "@azure/functions";
import {
  addTransaction,
  applyWeeklyCredits,
  deleteTransaction,
  normalizeLedger,
  readLedger,
  updateTransaction,
  writeLedger,
} from "./ledgerStore.js";

function jsonResponse(body, status = 200) {
  return {
    status,
    jsonBody: body,
    headers: {
      "content-type": "application/json",
    },
  };
}

async function withLedgerUpdate(mutator) {
  let attempts = 0;
  while (attempts < 3) {
    attempts += 1;
    const current = await readLedger();
    const nextLedger = mutator(current.ledger);

    try {
      const saved = await writeLedger(nextLedger, current.eTag);
      return saved.ledger;
    } catch (error) {
      if (String(error.message).includes("conflict") && attempts < 3) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Unable to save ledger after retrying.");
}

app.http("getLedger", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "ledger",
  handler: async () => {
    const current = await readLedger();
    return jsonResponse(normalizeLedger(current.ledger));
  },
});

app.http("getLedgerChild", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "ledger/{child}",
  handler: async (request) => {
    const child = request.params.child;
    const current = await readLedger();
    const ledger = normalizeLedger(current.ledger);
    const childData = ledger.children?.[child];

    if (!childData) {
      return jsonResponse({ error: "Child not found." }, 404);
    }

    return jsonResponse({ child, ...childData });
  },
});

app.http("createTransaction", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "transactions",
  handler: async (request) => {
    try {
      const body = await request.json();
      const next = await withLedgerUpdate((ledger) => addTransaction(ledger, body));
      return jsonResponse(next, 201);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }
  },
});

app.http("updateTransaction", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "transactions/{id}",
  handler: async (request) => {
    try {
      const body = await request.json();
      const next = await withLedgerUpdate((ledger) =>
        updateTransaction(ledger, request.params.id, body),
      );
      return jsonResponse(next);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }
  },
});

app.http("deleteTransaction", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "transactions/{id}",
  handler: async (request) => {
    const child = request.query.get("child");
    try {
      const next = await withLedgerUpdate((ledger) =>
        deleteTransaction(ledger, child, request.params.id),
      );
      return jsonResponse(next);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }
  },
});

app.http("applyWeeklyCredit", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "weekly-credit/apply",
  handler: async () => {
    try {
      const next = await withLedgerUpdate((ledger) => applyWeeklyCredits(ledger, new Date()));
      return jsonResponse(next);
    } catch (error) {
      return jsonResponse({ error: error.message }, 500);
    }
  },
});

app.timer("weeklyCreditScheduler", {
  schedule: "0 0 12 * * 1",
  handler: async (timer, context) => {
    context.log(`weeklyCreditScheduler triggered at ${timer.scheduleStatus?.last || new Date().toISOString()}`);

    try {
      await withLedgerUpdate((ledger) => applyWeeklyCredits(ledger, new Date()));
      context.log("Weekly credit pass complete.");
    } catch (error) {
      context.error(`Weekly credit scheduler failed: ${error.message}`);
      throw error;
    }
  },
});

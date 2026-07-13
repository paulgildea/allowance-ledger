import { randomUUID } from "node:crypto";
import { BlobServiceClient } from "@azure/storage-blob";

export const CHILDREN = ["Logan", "Quinn"];
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;
const LEDGER_BLOB_NAME = "ledger.json";

function calculateBalance(transactions = []) {
  return transactions.reduce((balance, transaction) => {
    const direction = transaction.type === "debt" ? -1 : 1;
    return balance + direction * Number(transaction.amount || 0);
  }, 0);
}

function streamToText(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

function normalizeChildName(child) {
  const normalized = String(child || "").trim().toLowerCase();
  if (normalized === "logan") {
    return "Logan";
  }
  if (normalized === "quinn") {
    return "Quinn";
  }
  return "";
}

function getContainerName() {
  return process.env.LEDGER_CONTAINER || "ledger";
}

function getWeeklyCreditAmount() {
  return Number(process.env.WEEKLY_CREDIT_AMOUNT || 5);
}

function getStorageConnectionString() {
  const connectionString = process.env.AzureWebJobsStorage || process.env.STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    throw new Error("Storage connection string is not configured.");
  }
  return connectionString;
}

function getContainerClient() {
  const serviceClient = BlobServiceClient.fromConnectionString(getStorageConnectionString());
  return serviceClient.getContainerClient(getContainerName());
}

export function createDefaultLedger(now = new Date()) {
  const timestamp = now.toISOString();
  return {
    updatedAt: timestamp,
    children: Object.fromEntries(
      CHILDREN.map((child) => [
        child,
        {
          total: 0,
          lastWeeklyCreditAt: timestamp,
          transactions: [],
        },
      ]),
    ),
  };
}

export function normalizeLedger(ledger, now = new Date()) {
  const base = ledger && typeof ledger === "object" ? ledger : createDefaultLedger(now);

  const children = Object.fromEntries(
    CHILDREN.map((child) => {
      const childData = base.children?.[child] || {};
      const transactions = Array.isArray(childData.transactions)
        ? childData.transactions.map((transaction) => ({
            id: String(transaction.id || randomUUID()),
            type: transaction.type === "debt" ? "debt" : "credit",
            amount: Number(transaction.amount || 0),
            note: String(transaction.note || ""),
            createdAt: transaction.createdAt || now.toISOString(),
            source: String(transaction.source || "manual"),
          }))
        : [];

      return [
        child,
        {
          lastWeeklyCreditAt: childData.lastWeeklyCreditAt || now.toISOString(),
          transactions,
          total: Number.isFinite(Number(childData.total))
            ? Number(childData.total)
            : Number(calculateBalance(transactions).toFixed(2)),
        },
      ];
    }),
  );

  return {
    updatedAt: base.updatedAt || now.toISOString(),
    children,
  };
}

export async function readLedger() {
  const containerClient = getContainerClient();
  await containerClient.createIfNotExists();
  const blobClient = containerClient.getBlockBlobClient(LEDGER_BLOB_NAME);

  try {
    const download = await blobClient.download();
    const payload = JSON.parse(await streamToText(download.readableStreamBody));
    return {
      ledger: normalizeLedger(payload),
      eTag: download.etag,
    };
  } catch (error) {
    const statusCode = error?.statusCode || error?.details?.statusCode;
    if (statusCode !== 404) {
      throw error;
    }

    const ledger = createDefaultLedger();
    const upload = await blobClient.upload(
      JSON.stringify(ledger, null, 2),
      Buffer.byteLength(JSON.stringify(ledger, null, 2)),
      {
        blobHTTPHeaders: {
          blobContentType: "application/json",
        },
      },
    );

    return {
      ledger,
      eTag: upload.etag,
    };
  }
}

export async function writeLedger(ledger, eTag) {
  const containerClient = getContainerClient();
  await containerClient.createIfNotExists();
  const blobClient = containerClient.getBlockBlobClient(LEDGER_BLOB_NAME);

  const payload = JSON.stringify(
    {
      ...ledger,
      updatedAt: new Date().toISOString(),
    },
    null,
    2,
  );

  const uploadOptions = {
    blobHTTPHeaders: {
      blobContentType: "application/json",
    },
    conditions: eTag ? { ifMatch: eTag } : undefined,
  };

  try {
    const response = await blobClient.upload(payload, Buffer.byteLength(payload), uploadOptions);
    return {
      ledger: normalizeLedger(JSON.parse(payload)),
      eTag: response.etag,
    };
  } catch (error) {
    const statusCode = error?.statusCode || error?.details?.statusCode;
    if (statusCode === 412) {
      throw new Error("Ledger update conflict. Please retry.");
    }
    throw error;
  }
}

export function addTransaction(ledger, input) {
  const child = normalizeChildName(input.child);
  if (!child) {
    throw new Error("Invalid child. Expected Logan or Quinn.");
  }

  const type = String(input.type || "credit").toLowerCase() === "debt" ? "debt" : "credit";
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than 0.");
  }

  const note = String(input.note || "").trim() || (type === "debt" ? "Debt" : "Credit");
  const transaction = {
    id: randomUUID(),
    type,
    amount: Number(amount.toFixed(2)),
    note,
    createdAt: new Date().toISOString(),
    source: String(input.source || "manual"),
  };

  const nextLedger = normalizeLedger(ledger);
  nextLedger.children[child].transactions.push(transaction);
  nextLedger.children[child].total = Number(calculateBalance(nextLedger.children[child].transactions).toFixed(2));
  return nextLedger;
}

export function updateTransaction(ledger, transactionId, input) {
  const child = normalizeChildName(input.child);
  if (!child) {
    throw new Error("Invalid child. Expected Logan or Quinn.");
  }

  const nextLedger = normalizeLedger(ledger);
  const transactions = nextLedger.children[child].transactions;
  const index = transactions.findIndex((transaction) => transaction.id === transactionId);

  if (index < 0) {
    throw new Error("Transaction not found.");
  }

  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Amount must be greater than 0.");
  }

  const type = String(input.type || transactions[index].type || "credit").toLowerCase() === "debt" ? "debt" : "credit";
  transactions[index] = {
    ...transactions[index],
    type,
    amount: Number(amount.toFixed(2)),
    note: String(input.note || transactions[index].note || "").trim(),
  };

  nextLedger.children[child].total = Number(calculateBalance(transactions).toFixed(2));
  return nextLedger;
}

export function deleteTransaction(ledger, childInput, transactionId) {
  const child = normalizeChildName(childInput);
  if (!child) {
    throw new Error("Invalid child. Expected Logan or Quinn.");
  }

  const nextLedger = normalizeLedger(ledger);
  const transactions = nextLedger.children[child].transactions;
  const filtered = transactions.filter((transaction) => transaction.id !== transactionId);

  if (filtered.length === transactions.length) {
    throw new Error("Transaction not found.");
  }

  nextLedger.children[child].transactions = filtered;
  nextLedger.children[child].total = Number(calculateBalance(filtered).toFixed(2));
  return nextLedger;
}

export function applyWeeklyCredits(ledger, now = new Date()) {
  const nextLedger = normalizeLedger(ledger, now);
  const weeklyAmount = getWeeklyCreditAmount();

  if (weeklyAmount <= 0) {
    return nextLedger;
  }

  CHILDREN.forEach((child) => {
    const childState = nextLedger.children[child];
    const lastCreditTime = new Date(childState.lastWeeklyCreditAt || now.toISOString()).getTime();
    const weeksDue = Math.floor((now.getTime() - lastCreditTime) / WEEK_IN_MS);

    if (weeksDue <= 0) {
      return;
    }

    for (let index = 1; index <= weeksDue; index += 1) {
      childState.transactions.push({
        id: randomUUID(),
        type: "credit",
        amount: Number(weeklyAmount.toFixed(2)),
        note: "Weekly allowance",
        createdAt: new Date(lastCreditTime + index * WEEK_IN_MS).toISOString(),
        source: "weekly",
      });
    }

    childState.lastWeeklyCreditAt = new Date(lastCreditTime + weeksDue * WEEK_IN_MS).toISOString();
    childState.total = Number(calculateBalance(childState.transactions).toFixed(2));
  });

  return nextLedger;
}

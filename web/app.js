const API_SETTINGS_KEY = "allowance-ledger-api-settings-v1";
const CHILDREN = ["Logan", "Quinn"];

export function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(Number(amount || 0));
}

export function calculateBalance(transactions = []) {
  return transactions.reduce((balance, transaction) => {
    const direction = transaction.type === "debt" ? -1 : 1;
    return balance + direction * Number(transaction.amount || 0);
  }, 0);
}

export function normalizeChildName(child) {
  const normalized = String(child || "").trim().toLowerCase();
  if (normalized === "logan") {
    return "Logan";
  }
  if (normalized === "quinn") {
    return "Quinn";
  }
  return "";
}

export function normalizeApiBaseUrl(url) {
  const normalized = String(url || "").trim();
  return normalized.replace(/\/$/, "");
}

function getApiBaseUrl() {
  try {
    const raw = window.localStorage.getItem(API_SETTINGS_KEY);
    const saved = raw ? JSON.parse(raw).apiBaseUrl : "";
    return normalizeApiBaseUrl(saved) || "/api";
  } catch {
    return "/api";
  }
}

function saveApiBaseUrl(apiBaseUrl) {
  window.localStorage.setItem(API_SETTINGS_KEY, JSON.stringify({ apiBaseUrl }));
}

function getApiUrl(path) {
  const base = getApiBaseUrl();
  return `${base}${path}`;
}

async function requestJson(path, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };

  if (options.body && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }

  const response = await fetch(getApiUrl(path), {
    ...options,
    headers,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message = payload?.error || `Request failed (${response.status}).`;
    throw new Error(message);
  }

  return payload;
}

function formatTimestamp(timestamp) {
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function renderEmptyState(target, message) {
  target.replaceChildren();
  const item = document.createElement("li");
  item.className = "empty-state";
  item.textContent = message;
  target.appendChild(item);
}

function createTransactionItem(child, transaction, onEdit, onDelete) {
  const item = document.createElement("li");
  item.className = "entry-item";

  const content = document.createElement("div");

  const head = document.createElement("div");
  head.className = "entry-head";

  const title = document.createElement("strong");
  title.textContent = transaction.note || (transaction.type === "debt" ? "Debt" : "Credit");

  const amount = document.createElement("span");
  amount.className = `entry-amount ${transaction.type}`;
  amount.textContent = `${transaction.type === "debt" ? "-" : "+"}${formatCurrency(transaction.amount)}`;

  head.append(title, amount);

  const meta = document.createElement("p");
  meta.className = "entry-meta";
  meta.textContent = `${formatTimestamp(transaction.createdAt)} | ${transaction.source || "manual"}`;

  content.append(head, meta);

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.textContent = "Edit";
  editButton.addEventListener("click", () => onEdit(child, transaction));

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  deleteButton.addEventListener("click", () => onDelete(child, transaction));

  actions.append(editButton, deleteButton);

  item.append(content, actions);
  return item;
}

function renderChildCard(name, childState, onCreate, onEdit, onDelete) {
  const template = document.getElementById("child-template");
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".child-card");

  fragment.querySelector(".child-name").textContent = name;
  fragment.querySelector(".child-balance").textContent = formatCurrency(childState.total);

  const list = fragment.querySelector(".activity-list");
  const transactions = (childState.transactions || [])
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

  if (transactions.length === 0) {
    renderEmptyState(list, "No transactions yet.");
  } else {
    list.replaceChildren();
    transactions.forEach((transaction) => {
      list.appendChild(createTransactionItem(name, transaction, onEdit, onDelete));
    });
  }

  const form = fragment.querySelector(".entry-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    onCreate(name, {
      type: String(formData.get("type") || "credit"),
      amount: Number(formData.get("amount")),
      note: String(formData.get("note") || "").trim(),
    });
    form.reset();
  });

  return card;
}

function createApp() {
  const statusText = document.getElementById("status-text");
  const childrenRoot = document.getElementById("children");
  const householdTotalElement = document.getElementById("household-total");
  const refreshButton = document.getElementById("refresh-ledger");
  const applyWeeklyButton = document.getElementById("apply-weekly-credit");
  const settingsForm = document.getElementById("settings-form");
  const apiBaseUrlInput = document.getElementById("api-base-url");

  let state = {
    children: Object.fromEntries(CHILDREN.map((name) => [name, { total: 0, transactions: [] }])),
  };

  const setStatus = (message) => {
    statusText.textContent = message;
  };

  const rerender = () => {
    const householdTotal = CHILDREN.reduce((sum, child) => sum + Number(state.children[child]?.total || 0), 0);
    householdTotalElement.textContent = formatCurrency(householdTotal);

    childrenRoot.innerHTML = "";
    CHILDREN.forEach((child) => {
      childrenRoot.appendChild(
        renderChildCard(
          child,
          state.children[child] || { total: 0, transactions: [] },
          async (childName, payload) => {
            if (!payload.amount || payload.amount <= 0) {
              setStatus("Amount must be greater than 0.");
              return;
            }

            try {
              await requestJson("/transactions", {
                method: "POST",
                body: JSON.stringify({ child: childName, ...payload }),
              });
              await loadLedger();
              setStatus(`Transaction added for ${childName}.`);
            } catch (error) {
              setStatus(error.message);
            }
          },
          async (childName, transaction) => {
            const nextType = window.prompt("Type (credit or debt)", transaction.type);
            if (!nextType) {
              return;
            }

            const parsedType = String(nextType).toLowerCase() === "debt" ? "debt" : "credit";
            const nextAmount = Number(window.prompt("Amount", String(transaction.amount)));
            if (!nextAmount || nextAmount <= 0) {
              setStatus("Updated amount must be greater than 0.");
              return;
            }
            const nextNote = window.prompt("Note", transaction.note || "") || "";

            try {
              await requestJson(`/transactions/${transaction.id}`, {
                method: "PUT",
                body: JSON.stringify({
                  child: childName,
                  type: parsedType,
                  amount: nextAmount,
                  note: nextNote,
                }),
              });
              await loadLedger();
              setStatus(`Transaction updated for ${childName}.`);
            } catch (error) {
              setStatus(error.message);
            }
          },
          async (childName, transaction) => {
            if (!window.confirm(`Delete this transaction for ${childName}?`)) {
              return;
            }

            try {
              await requestJson(`/transactions/${transaction.id}?child=${encodeURIComponent(childName)}`, {
                method: "DELETE",
              });
              await loadLedger();
              setStatus(`Transaction deleted for ${childName}.`);
            } catch (error) {
              setStatus(error.message);
            }
          },
        ),
      );
    });
  };

  const loadLedger = async () => {
    try {
      const payload = await requestJson("/ledger");
      const children = payload?.children || {};

      state.children = Object.fromEntries(
        CHILDREN.map((child) => {
          const childData = children[child] || { transactions: [] };
          const transactions = Array.isArray(childData.transactions) ? childData.transactions : [];
          return [
            child,
            {
              ...childData,
              transactions,
              total: Number(childData.total ?? calculateBalance(transactions)),
            },
          ];
        }),
      );

      rerender();
      setStatus("Ledger loaded.");
    } catch (error) {
      setStatus(error.message);
    }
  };

  settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const normalized = normalizeApiBaseUrl(apiBaseUrlInput.value);
    saveApiBaseUrl(normalized);
    setStatus(normalized ? "API URL saved." : "Using default /api endpoint.");
    await loadLedger();
  });

  refreshButton.addEventListener("click", loadLedger);
  applyWeeklyButton.addEventListener("click", async () => {
    try {
      await requestJson("/weekly-credit/apply", { method: "POST" });
      await loadLedger();
      setStatus("Weekly credit applied where due.");
    } catch (error) {
      setStatus(error.message);
    }
  });

  apiBaseUrlInput.value = getApiBaseUrl() === "/api" ? "" : getApiBaseUrl();
  rerender();
  loadLedger();
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  createApp();
}

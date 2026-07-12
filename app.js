const STORAGE_KEY = "allowance-ledger-state-v1";
const CHILDREN = ["Quinn", "Logan"];
const DEFAULT_WEEKLY_ALLOWANCE = 10;
const WEEK_IN_MS = 7 * 24 * 60 * 60 * 1000;

export function formatCurrency(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

export function createTransaction({ type, amount, note, createdAt, source = "manual" }) {
  return {
    id: `${source}-${createdAt}-${Math.round(amount * 100)}`,
    type,
    amount: Number(amount),
    note: note?.trim() || (type === "debt" ? "Debt" : "Credit"),
    createdAt,
    source,
  };
}

export function calculateBalance(transactions = []) {
  return transactions.reduce((balance, transaction) => {
    const direction = transaction.type === "debt" ? -1 : 1;
    return balance + direction * Number(transaction.amount || 0);
  }, 0);
}

export function getWeekAnchor(date = new Date()) {
  const anchor = new Date(date);
  anchor.setHours(0, 0, 0, 0);
  return anchor.getTime();
}

export function applyWeeklyAllowance(childState, now = new Date()) {
  const weeklyAllowance = Number(childState.weeklyAllowance || 0);
  const lastAccrual = childState.lastWeeklyAccrualAt
    ? new Date(childState.lastWeeklyAccrualAt).getTime()
    : getWeekAnchor(now);
  const nowTime = now.getTime();
  const weeksDue = Math.floor((nowTime - lastAccrual) / WEEK_IN_MS);

  if (weeksDue <= 0 || weeklyAllowance <= 0) {
    return {
      ...childState,
      lastWeeklyAccrualAt: new Date(lastAccrual).toISOString(),
    };
  }

  const transactions = [...(childState.transactions || [])];

  for (let index = 1; index <= weeksDue; index += 1) {
    const transactionTime = new Date(lastAccrual + index * WEEK_IN_MS).toISOString();
    transactions.push(
      createTransaction({
        type: "credit",
        amount: weeklyAllowance,
        note: "Weekly allowance",
        createdAt: transactionTime,
        source: "weekly",
      }),
    );
  }

  return {
    ...childState,
    transactions,
    lastWeeklyAccrualAt: new Date(lastAccrual + weeksDue * WEEK_IN_MS).toISOString(),
  };
}

export function createInitialState(now = new Date()) {
  const weekAnchor = new Date(getWeekAnchor(now)).toISOString();

  return {
    children: Object.fromEntries(
      CHILDREN.map((name) => [
        name,
        {
          weeklyAllowance: DEFAULT_WEEKLY_ALLOWANCE,
          lastWeeklyAccrualAt: weekAnchor,
          transactions: [],
        },
      ]),
    ),
  };
}

export function normalizeState(state, now = new Date()) {
  const baseState = state?.children ? state : createInitialState(now);
  const children = Object.fromEntries(
    CHILDREN.map((name) => {
      const childState = baseState.children?.[name] || createInitialState(now).children[name];
      return [
        name,
        applyWeeklyAllowance(
          {
            weeklyAllowance: Number(childState.weeklyAllowance ?? DEFAULT_WEEKLY_ALLOWANCE),
            lastWeeklyAccrualAt: childState.lastWeeklyAccrualAt,
            transactions: Array.isArray(childState.transactions) ? childState.transactions : [],
          },
          now,
        ),
      ];
    }),
  );

  return { children };
}

function loadState(now = new Date()) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : undefined, now);
  } catch {
    return createInitialState(now);
  }
}

function saveState(state) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function renderEntries(target, transactions, type) {
  const filtered = type ? transactions.filter((entry) => entry.type === type) : transactions;

  if (filtered.length === 0) {
    renderEmptyState(target, type === "debt" ? "No debts yet." : "No activity yet.");
    return;
  }

  target.replaceChildren();

  filtered
    .slice()
    .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt))
    .forEach((entry) => {
      const item = document.createElement("li");
      item.className = "entry-item";

      const content = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = entry.note;
      const meta = document.createElement("p");
      meta.className = "entry-meta";
      meta.textContent = formatTimestamp(entry.createdAt);
      content.append(title, meta);

      const amount = document.createElement("span");
      amount.className = `entry-amount ${entry.type}`;
      amount.textContent = `${entry.type === "debt" ? "-" : "+"}${formatCurrency(
        Number(entry.amount),
      )}`;

      item.append(content, amount);
      target.appendChild(item);
    });
}

function updateSummary(state) {
  const householdTotal = CHILDREN.reduce((total, child) => {
    return total + calculateBalance(state.children[child].transactions);
  }, 0);

  document.getElementById("household-total").textContent = formatCurrency(householdTotal);
  document.getElementById("weekly-status").textContent =
    "Weekly allowance is applied automatically whenever a new week is due.";
}

function renderChildCard(name, childState, onWeeklyAmountChange, onEntrySubmit) {
  const template = document.getElementById("child-template");
  const fragment = template.content.cloneNode(true);
  const card = fragment.querySelector(".child-card");

  fragment.querySelector(".child-name").textContent = name;
  fragment.querySelector(".child-balance").textContent = formatCurrency(
    calculateBalance(childState.transactions),
  );

  const weeklyInput = fragment.querySelector(".weekly-input");
  weeklyInput.value = Number(childState.weeklyAllowance).toFixed(2);
  weeklyInput.setAttribute("aria-label", `${name} weekly allowance`);
  weeklyInput.addEventListener("change", (event) => {
    onWeeklyAmountChange(name, Number(event.target.value || 0));
  });

  const form = fragment.querySelector(".entry-form");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    onEntrySubmit(name, {
      type: String(formData.get("type")),
      amount: Number(formData.get("amount")),
      note: String(formData.get("note") || ""),
    });
    form.reset();
  });

  renderEntries(fragment.querySelector(".debt-list"), childState.transactions, "debt");
  renderEntries(fragment.querySelector(".activity-list"), childState.transactions);

  return card;
}

function createApp() {
  let state = loadState(new Date());
  saveState(state);

  const childrenRoot = document.getElementById("children");

  const rerender = () => {
    childrenRoot.innerHTML = "";
    CHILDREN.forEach((name) => {
      childrenRoot.appendChild(
        renderChildCard(
          name,
          state.children[name],
          (childName, amount) => {
            state = {
              children: {
                ...state.children,
                [childName]: {
                  ...state.children[childName],
                  weeklyAllowance: Math.max(0, Number(amount || 0)),
                },
              },
            };
            saveState(state);
            rerender();
          },
          (childName, entry) => {
            if (!entry.amount || entry.amount <= 0) {
              return;
            }

            const transaction = createTransaction({
              ...entry,
              createdAt: new Date().toISOString(),
            });

            state = {
              children: {
                ...state.children,
                [childName]: {
                  ...state.children[childName],
                  transactions: [...state.children[childName].transactions, transaction],
                },
              },
            };
            saveState(state);
            rerender();
          },
        ),
      );
    });
    updateSummary(state);
  };

  const syncWeeklyAccruals = () => {
    const nextState = normalizeState(state, new Date());
    if (JSON.stringify(nextState) !== JSON.stringify(state)) {
      state = nextState;
      saveState(state);
      rerender();
    }
  };

  rerender();
  window.setInterval(syncWeeklyAccruals, 60 * 1000);
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  createApp();
}

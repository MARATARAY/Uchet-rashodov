"use strict";

const STORAGE_KEY = "family-budget-v1";
const ADD_CATEGORY = "";
const DEFAULT_CATEGORIES = ["Еда", "Транспорт", "Дом"];
const $ = (id) => document.getElementById(id);
const moneyFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
let state = { categories: [...DEFAULT_CATEGORIES], expenses: [] };
let storageReadable = true;
let pendingExpense = null;
let pendingPosition = 0;

function today() {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return year > 0 && date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function parseAmount(value) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 ? cents : null;
}

function formatMoney(cents) {
  // Format the integer and fractional parts separately to preserve exact cents.
  const whole = BigInt(cents) / 100n;
  const fraction = String(BigInt(cents) % 100n).padStart(2, "0");
  return moneyFormatter.format(whole).replace(/,\d{2}$/, `,${fraction}`);
}

function error(field, message) {
  $(`${field}-error`).textContent = message;
  $(field).setAttribute("aria-invalid", String(Boolean(message)));
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.categories) || !Array.isArray(data.expenses)
      || !data.categories.every((name) => typeof name === "string" && name.trim())
      || !data.expenses.every((item) => item && Number.isSafeInteger(item.cents) && item.cents > 0
        && typeof item.date === "string" && validDate(item.date)
        && data.categories.includes(item.category) && typeof item.comment === "string")) {
      throw new Error("Invalid saved data");
    }
    state = data;
  } catch {
    storageReadable = false;
    $("storage-error").textContent = "Не удалось прочитать сохранённые данные. Проверьте доступ к хранилищу браузера. Добавление приостановлено, чтобы сохранить прежние записи.";
  }
}

function save(nextState) {
  if (!storageReadable) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState));
    state = nextState;
    $("storage-error").textContent = "";
    return true;
  } catch {
    $("storage-error").textContent = "Не удалось сохранить данные. Проверьте свободное место и разрешение на хранение данных в браузере. Введённые значения сохранены в форме.";
    return false;
  }
}

function renderCategories(selected = state.categories[0]) {
  $("category").replaceChildren();
  for (const name of state.categories) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    $("category").append(option);
  }
  const add = document.createElement("option");
  add.value = ADD_CATEGORY;
  add.textContent = "Добавить категорию траты";
  $("category").append(add);
  $("category").value = selected;
}

function renderExpenses() {
  const month = today().slice(0, 7);
  const categoryTotals = new Map(state.categories.map((name) => [name, 0n]));
  let total = 0n;
  for (const item of state.expenses) {
    if (!item.date.startsWith(`${month}-`)) continue;
    total += BigInt(item.cents);
    categoryTotals.set(item.category, categoryTotals.get(item.category) + BigInt(item.cents));
  }
  $("month-total").textContent = formatMoney(total);
  const totalsFragment = document.createDocumentFragment();
  for (const [name, cents] of categoryTotals) {
    const row = document.createElement("div");
    row.className = "category-total-row";
    const label = document.createElement("dt");
    label.textContent = name;
    const amount = document.createElement("dd");
    amount.textContent = formatMoney(cents);
    row.append(label, amount);
    totalsFragment.append(row);
  }
  $("category-totals").replaceChildren(totalsFragment);
  $("month-label").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date());
  $("empty-state").hidden = state.expenses.length > 0;
  const fragment = document.createDocumentFragment();
  const sorted = state.expenses.map((item, index) => ({ ...item, index }))
    .sort((a, b) => b.date.localeCompare(a.date) || b.index - a.index);
  for (const [position, item] of sorted.entries()) {
    const row = document.createElement("li");
    row.className = "expense-item";
    const icon = document.createElement("span");
    icon.className = "category-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ({ Еда: "○", Транспорт: "↗", Дом: "⌂" })[item.category] || "◇";
    const details = document.createElement("div");
    const category = document.createElement("p");
    category.className = "expense-category";
    category.textContent = item.category;
    const date = document.createElement("time");
    date.className = "expense-date";
    date.dateTime = item.date;
    const localDate = new Date(0);
    const [year, monthNumber, day] = item.date.split("-").map(Number);
    localDate.setFullYear(year, monthNumber - 1, day);
    date.textContent = dateFormatter.format(localDate);
    details.append(category, date);
    if (item.comment) {
      const comment = document.createElement("p");
      comment.className = "expense-comment";
      comment.textContent = item.comment;
      details.append(comment);
    }
    const amount = document.createElement("span");
    amount.className = "expense-amount";
    amount.textContent = formatMoney(item.cents);
    const actions = document.createElement("div");
    actions.className = "expense-actions";
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-expense";
    remove.textContent = "Удалить";
    remove.setAttribute("aria-label", `Удалить трату: ${item.category}, ${formatMoney(item.cents)}, ${date.textContent}`);
    // Keep the original object, not its sorted position: identical old records remain distinct.
    const expense = state.expenses[item.index];
    remove.addEventListener("click", () => {
      pendingExpense = expense;
      pendingPosition = position;
      $("delete-description").textContent = `${item.category} · ${formatMoney(item.cents)} · ${date.textContent}${item.comment ? ` · ${item.comment}` : ""}`;
      $("delete-error").textContent = "";
      $("delete-dialog").showModal();
    });
    actions.append(amount, remove);
    row.append(icon, details, actions);
    fragment.append(row);
  }
  $("expense-list").replaceChildren(fragment);
}

$("confirm-delete").addEventListener("click", () => {
  const index = state.expenses.indexOf(pendingExpense);
  if (index < 0) return;
  const expenses = state.expenses.filter((_, itemIndex) => itemIndex !== index);
  if (!save({ ...state, expenses })) {
    $("delete-error").textContent = "Не удалось сохранить удаление. Трата и итоги не изменены. Проверьте доступ к хранилищу браузера и попробуйте ещё раз.";
    return;
  }
  renderExpenses();
  $("status").textContent = `Трата ${formatMoney(pendingExpense.cents)}, ${pendingExpense.category}, удалена. Всего записей: ${expenses.length}.`;
  $("delete-dialog").close();
});

$("delete-dialog").addEventListener("close", () => {
  const buttons = $("expense-list").querySelectorAll(".delete-expense");
  (buttons[Math.min(pendingPosition, buttons.length - 1)] || $("amount")).focus();
  pendingExpense = null;
});

$("category").addEventListener("change", () => {
  const adding = $("category").value === ADD_CATEGORY;
  $("new-category-fields").hidden = !adding;
  error("category", "");
  if (adding) $("new-category").focus();
});

function addCategory() {
  const name = $("new-category").value.trim();
  if (!name) {
    error("new-category", "Введите название категории.");
    $("new-category").focus();
    return;
  }
  if (state.categories.some((existing) => existing.toLocaleLowerCase("ru-RU") === name.toLocaleLowerCase("ru-RU"))) {
    error("new-category", "Такая категория уже есть.");
    $("new-category").focus();
    return;
  }
  if (!save({ ...state, categories: [...state.categories, name] })) return;
  renderCategories(name);
  renderExpenses();
  $("new-category-fields").hidden = true;
  $("new-category").value = "";
  error("new-category", "");
  error("category", "");
  $("category").focus();
  $("status").textContent = `Категория «${name}» добавлена.`;
}

$("add-category").addEventListener("click", addCategory);
$("new-category").addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addCategory();
  }
});

$("expense-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const cents = parseAmount($("amount").value);
  const category = $("category").value;
  const date = $("date").value;
  error("amount", cents === null ? "Введите сумму больше нуля, не более двух знаков после запятой." : "");
  error("category", !state.categories.includes(category) ? "Выберите категорию или сначала добавьте новую." : "");
  error("date", !validDate(date) ? "Укажите корректную дату." : "");
  const invalid = ["amount", "category", "date"].find((field) => $(field).getAttribute("aria-invalid") === "true");
  if (invalid) { $(invalid).focus(); return; }
  const expense = { cents, category, date, comment: $("comment").value.trim() };
  if (!save({ ...state, expenses: [...state.expenses, expense] })) return;
  renderExpenses();
  $("amount").value = "";
  $("comment").value = "";
  $("date").value = today();
  $("amount").focus();
  $("status").textContent = `Трата ${formatMoney(cents)}, ${category}, добавлена. Всего записей: ${state.expenses.length}.`;
});

load();
renderCategories();
$("date").value = today();
renderExpenses();
// Recalculate the current month when returning to a page left open overnight.
document.addEventListener("visibilitychange", () => { if (!document.hidden) renderExpenses(); });
window.addEventListener("focus", renderExpenses);

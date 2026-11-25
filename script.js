"use strict";

const STORAGE_KEY = "family-budget-v1";
const ADD_CATEGORY = "";
const DEFAULT_CATEGORIES = ["Еда", "Транспорт", "Дом"];
const $ = (id) => document.getElementById(id);
const moneyFormatter = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" });
let state = { categories: [...DEFAULT_CATEGORIES], expenses: [], budgets: {} };
let renderedBudgetMonth = "";
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

function parseAmount(value, allowZero = false) {
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return cents <= BigInt(Number.MAX_SAFE_INTEGER) && (allowZero || cents > 0n) ? Number(cents) : null;
}

function formatMoney(cents) {
  // Format the integer and fractional parts separately to preserve exact cents.
  const value = BigInt(cents);
  const absolute = value < 0n ? -value : value;
  const whole = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, "0");
  return `${value < 0n ? "−" : ""}${moneyFormatter.format(whole).replace(/,\d{2}$/, `,${fraction}`)}`;
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
    if (data.budgets !== undefined && (!data.budgets || typeof data.budgets !== "object" || Array.isArray(data.budgets)
      || !Object.entries(data.budgets).every(([month, limits]) => /^\d{4}-\d{2}$/.test(month) && validDate(`${month}-01`)
        && Array.isArray(limits) && limits.every((limit) => limit && data.categories.includes(limit.category)
          && Number.isSafeInteger(limit.cents) && limit.cents >= 0)
        && new Set(limits.map((limit) => limit.category)).size === limits.length))) {
      throw new Error("Invalid saved budgets");
    }
    state = { ...data, budgets: data.budgets || {} };
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

function renderLimits() {
  const month = today().slice(0, 7);
  // Keep unfinished input and keyboard focus when the window regains focus.
  if (renderedBudgetMonth === month && $("category-limits").children.length === state.categories.length) return;
  renderedBudgetMonth = month;
  $("budget-month").textContent = new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date());
  const fragment = document.createDocumentFragment();
  state.categories.forEach((name, index) => {
    const form = document.createElement("form");
    form.className = "limit-form";
    form.noValidate = true;
    const label = document.createElement("label");
    label.htmlFor = `limit-${index}`;
    label.textContent = `Лимит: ${name}`;
    const saved = document.createElement("p");
    saved.id = `limit-saved-${index}`;
    saved.className = "limit-saved";
    saved.setAttribute("aria-live", "polite");
    const limit = (state.budgets[month] || []).find((item) => item.category === name);
    saved.textContent = limit ? `Лимит: ${formatMoney(limit.cents)}` : "Лимит: Не задан";
    const summary = document.createElement("dl");
    summary.className = "budget-values";
    for (const [key, title] of [["spent", "Потрачено"], ["remaining", "Осталось"]]) {
      const pair = document.createElement("div");
      const term = document.createElement("dt");
      term.textContent = title;
      const amount = document.createElement("dd");
      amount.id = `limit-${key}-${index}`;
      pair.append(term, amount);
      summary.append(pair);
    }
    const warning = document.createElement("p");
    warning.id = `limit-warning-${index}`;
    warning.className = "budget-warning";
    warning.setAttribute("role", "status");
    warning.hidden = true;
    const controls = document.createElement("div");
    controls.className = "limit-controls";
    const input = document.createElement("input");
    input.id = `limit-${index}`;
    input.type = "text";
    input.inputMode = "decimal";
    input.placeholder = "Не задан";
    input.value = limit ? `${Math.floor(limit.cents / 100)},${String(limit.cents % 100).padStart(2, "0")}` : "";
    input.setAttribute("aria-describedby", `limit-${index}-error`);
    const button = document.createElement("button");
    button.type = "submit";
    button.className = "secondary";
    button.textContent = "Сохранить";
    button.setAttribute("aria-label", `Сохранить лимит: ${name}`);
    const message = document.createElement("p");
    message.id = `limit-${index}-error`;
    message.className = "error";
    message.setAttribute("aria-live", "polite");
    controls.append(input, button);
    form.append(label, saved, summary, warning, controls, message);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (month !== today().slice(0, 7)) {
        renderLimits();
        $("status").textContent = "Начался новый месяц. Задайте лимит заново.";
        return;
      }
      const empty = input.value.trim() === "";
      const cents = empty ? null : parseAmount(input.value, true);
      message.textContent = "";
      input.setAttribute("aria-invalid", "false");
      if (!empty && cents === null) {
        message.textContent = "Введите сумму от нуля, не более двух знаков после запятой, в допустимом диапазоне.";
        input.setAttribute("aria-invalid", "true");
        input.focus();
        return;
      }
      const limits = (state.budgets[month] || []).filter((item) => item.category !== name);
      if (!empty) limits.push({ category: name, cents });
      if (!save({ ...state, budgets: { ...state.budgets, [month]: limits } })) {
        message.textContent = "Не удалось сохранить лимит. Прежний лимит не изменён. Проверьте доступ к хранилищу браузера.";
        return;
      }
      saved.textContent = empty ? "Лимит: Не задан" : `Лимит: ${formatMoney(cents)}`;
      input.value = empty ? "" : `${Math.floor(cents / 100)},${String(cents % 100).padStart(2, "0")}`;
      renderExpenses();
      $("status").textContent = empty ? `Лимит категории «${name}» снят.` : `Лимит категории «${name}» сохранён.`;
    });
    fragment.append(form);
  });
  $("category-limits").replaceChildren(fragment);
}

function renderExpenses() {
  renderLimits();
  const month = today().slice(0, 7);
  const categoryTotals = new Map(state.categories.map((name) => [name, 0n]));
  let total = 0n;
  for (const item of state.expenses) {
    if (!item.date.startsWith(`${month}-`)) continue;
    total += BigInt(item.cents);
    categoryTotals.set(item.category, categoryTotals.get(item.category) + BigInt(item.cents));
  }
  $("month-total").textContent = formatMoney(total);
  const limits = new Map((state.budgets[month] || []).map((item) => [item.category, BigInt(item.cents)]));
  state.categories.forEach((name, index) => {
    const spent = categoryTotals.get(name);
    const limit = limits.get(name);
    const remaining = limit === undefined ? null : limit - spent;
    $(`limit-saved-${index}`).textContent = limit === undefined ? "Лимит: Не задан" : `Лимит: ${formatMoney(limit)}`;
    $(`limit-spent-${index}`).textContent = formatMoney(spent);
    $(`limit-remaining-${index}`).textContent = remaining === null ? "—" : formatMoney(remaining);
    const warning = $(`limit-warning-${index}`);
    const overspent = remaining !== null && remaining < 0n;
    warning.textContent = overspent ? `Перерасход: ${formatMoney(-remaining)}` : "";
    warning.hidden = !overspent;
    $(`limit-remaining-${index}`).className = overspent ? "budget-overrun" : "";
  });
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

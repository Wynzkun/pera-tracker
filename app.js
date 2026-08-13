
'use strict';

const STORAGE_KEY = 'peraTrackerPWA_v2';
const LEGACY_KEYS = ['moneyTrackerPWA_v1', 'moneyTrackerSampleV1'];
const DB_NAME = 'peraTrackerDB';
const DB_VERSION = 1;
const DEBT_STORE = 'debts';
const NOTICE_STORE = 'notificationLog';

const chartPalette = [
  '#4b382b', '#8c7a5b', '#e5d7b8', '#5f866d',
  '#b69c7c', '#6f6258', '#c8b89c', '#82977f',
  '#9b8066', '#d2c4ad', '#574436', '#9d8e79'
];

const EXPENSE_CATEGORIES = ['Food', 'Bills', 'Transportation', 'Groceries', 'Shopping', 'Health', 'Entertainment', 'Other'];
const INCOME_CATEGORIES = ['Paycheck', 'Business', 'Side Hustle', 'Other Income'];
let photoScanData = null;
let currentPhotoObjectUrl = null;
let toastTimer = null;

let deferredInstallPrompt = null;
let calendarCursor = startOfMonth(new Date());
let selectedCalendarDate = todayISO();

function freshState() {
  return { transactions: [], debts: [] };
}

function loadState() {
  const current = safeParse(localStorage.getItem(STORAGE_KEY));
  if (current) return normalizeState(current);

  for (const key of LEGACY_KEYS) {
    const legacy = safeParse(localStorage.getItem(key));
    if (legacy) {
      const migrated = normalizeState(legacy);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
  }
  return freshState();
}

let state = loadState();

function safeParse(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeState(raw) {
  return {
    transactions: Array.isArray(raw.transactions) ? raw.transactions.map(t => ({
      id: t.id || uid(),
      type: ['expense', 'income', 'debt-payment'].includes(t.type) ? t.type : 'expense',
      amount: Number(t.amount || 0),
      category: t.category || 'Other',
      date: t.date || todayISO(),
      notes: t.notes || '',
      debtId: t.debtId || null
    })) : [],
    debts: Array.isArray(raw.debts) ? raw.debts.map(d => ({
      id: d.id || uid(),
      name: d.name || 'Debt',
      original: Number(d.original || d.balance || 0),
      balance: Number(d.balance || 0),
      dueAmount: Number(d.dueAmount || 0),
      dueDate: d.dueDate || todayISO(),
      reminderDays: Number.isFinite(Number(d.reminderDays)) ? Number(d.reminderDays) : 3
    })) : []
  };
}

function uid() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function peso(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

function todayISO() {
  return isoLocal(new Date());
}

function isoLocal(date) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function parseISO(dateStr) {
  return new Date(`${dateStr}T00:00:00`);
}

function formatDate(dateStr, options = {}) {
  const defaults = { month: 'short', day: 'numeric', year: 'numeric' };
  return parseISO(dateStr).toLocaleDateString('en-PH', { ...defaults, ...options });
}

function daysUntil(dateString) {
  const today = parseISO(todayISO());
  const target = parseISO(dateString);
  return Math.round((target - today) / 86400000);
}

function escapeHtml(str = '') {
  return String(str).replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[ch]));
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  syncDebtsToIndexedDB().finally(() => {
    requestDueCheck();
  });
  renderAll();
}

function showPage(pageId, button) {
  document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
  const page = document.getElementById(pageId);
  if (page) page.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.page === pageId);
  });

  if (button) button.classList.add('active');

  if (pageId === 'reports') {
    requestAnimationFrame(() => renderCharts());
  }
  if (pageId === 'calendar') {
    renderCalendar();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

window.showPage = showPage;

function addTransaction() {
  const type = document.getElementById('txType').value;
  if (!['expense', 'income'].includes(type)) {
    alert('Debt payments must be recorded from the Debts section so the remaining balance stays accurate.');
    return;
  }
  const amount = Number(document.getElementById('txAmount').value);
  const category = document.getElementById('txCategory').value;
  const date = document.getElementById('txDate').value;
  const notes = document.getElementById('txNotes').value.trim();

  if (!amount || amount <= 0 || !date) {
    alert('Please enter a valid amount and date.');
    return;
  }

  state.transactions.unshift({
    id: uid(), type, amount, category, date, notes, debtId: null
  });

  document.getElementById('txAmount').value = '';
  document.getElementById('txNotes').value = '';
  saveState();
}
window.addTransaction = addTransaction;

function addDebt() {
  const name = document.getElementById('debtName').value.trim();
  const original = Number(document.getElementById('debtOriginal').value);
  const balance = Number(document.getElementById('debtBalance').value);
  const dueAmount = Number(document.getElementById('debtDueAmount').value);
  const dueDate = document.getElementById('debtDueDate').value;
  const reminderDays = Number(document.getElementById('debtReminder').value);

  if (!name || original <= 0 || balance < 0 || dueAmount <= 0 || !dueDate) {
    alert('Please complete the debt details. Amount Due must be greater than zero.');
    return;
  }

  state.debts.unshift({
    id: uid(), name, original, balance, dueAmount, dueDate, reminderDays
  });

  ['debtName', 'debtOriginal', 'debtBalance', 'debtDueAmount', 'debtDueDate']
    .forEach(id => document.getElementById(id).value = '');

  saveState();
}
window.addDebt = addDebt;

function deleteTransaction(id) {
  if (!confirm('Delete this transaction?')) return;
  state.transactions = state.transactions.filter(t => t.id !== id);
  saveState();
}
window.deleteTransaction = deleteTransaction;

function deleteDebt(id) {
  if (!confirm('Delete this debt?')) return;
  state.debts = state.debts.filter(d => d.id !== id);
  saveState();
}
window.deleteDebt = deleteDebt;

function editDueDate(id) {
  const debt = state.debts.find(d => d.id === id);
  if (!debt) return;
  const next = prompt(`New due date for ${debt.name} (YYYY-MM-DD):`, debt.dueDate);
  if (next === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(next) || Number.isNaN(parseISO(next).getTime())) {
    alert('Please use YYYY-MM-DD.');
    return;
  }
  debt.dueDate = next;
  saveState();
}
window.editDueDate = editDueDate;

function recordPayment(id) {
  const debt = state.debts.find(d => d.id === id);
  if (!debt) return;

  const raw = prompt(`Payment amount for ${debt.name}:`, debt.dueAmount || '');
  if (raw === null) return;

  const amount = Number(raw);
  if (!amount || amount <= 0) {
    alert('Invalid payment amount.');
    return;
  }

  const applied = Math.min(amount, debt.balance);
  debt.balance = Math.max(0, debt.balance - applied);

  state.transactions.unshift({
    id: uid(),
    type: 'debt-payment',
    amount: applied,
    category: 'Debt Payment',
    date: todayISO(),
    notes: `Payment for ${debt.name}`,
    debtId: debt.id
  });

  saveState();
}
window.recordPayment = recordPayment;

function debtStatus(debt) {
  if (debt.balance <= 0) return { text: 'PAID', cls: 'status-paid' };
  const days = daysUntil(debt.dueDate);
  if (days < 0) return { text: 'OVERDUE', cls: 'status-overdue' };
  if (days === 0) return { text: 'DUE TODAY', cls: 'status-today' };
  if (days <= 7) return { text: `DUE IN ${days} DAY${days === 1 ? '' : 'S'}`, cls: 'status-soon' };
  return { text: formatDate(debt.dueDate, { month: 'short', day: 'numeric' }).toUpperCase(), cls: 'status-future' };
}

function renderDashboard() {
  const tx = state.transactions;
  const debts = state.debts;
  const income = sum(tx.filter(t => t.type === 'income').map(t => t.amount));
  const cashOut = sum(tx.filter(t => t.type !== 'income').map(t => t.amount));
  const available = income - cashOut;

  const now = new Date();
  const monthlyExpenses = sum(tx.filter(t => {
    const d = parseISO(t.date);
    return t.type === 'expense' &&
      d.getMonth() === now.getMonth() &&
      d.getFullYear() === now.getFullYear();
  }).map(t => t.amount));

  const activeDebts = debts.filter(d => d.balance > 0);
  const totalDebt = sum(activeDebts.map(d => d.balance));
  const dueSoon = activeDebts.filter(d => {
    const days = daysUntil(d.dueDate);
    return days >= 0 && days <= 7;
  });
  const dueSoonTotal = sum(dueSoon.map(d => Math.min(d.dueAmount, d.balance)));

  text('availableCash', peso(available));
  text('monthlyExpenses', peso(monthlyExpenses));
  text('totalDebt', peso(totalDebt));
  text('dueSoonTotal', peso(dueSoonTotal));
  text('debtCount', `${activeDebts.length} active debt${activeDebts.length === 1 ? '' : 's'}`);
  text('dueSoonCount', `${dueSoon.length} upcoming due${dueSoon.length === 1 ? '' : 's'}`);
  text('monthLabel', now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }));

  const upcoming = [...activeDebts]
    .sort((a, b) => parseISO(a.dueDate) - parseISO(b.dueDate))
    .slice(0, 6);

  document.getElementById('upcomingDues').innerHTML = upcoming.length
    ? upcoming.map(debtListRow).join('')
    : emptyHtml('No upcoming dues yet.');

  document.getElementById('recentTransactions').innerHTML = tx.length
    ? tx.slice(0, 6).map(transactionRow).join('')
    : emptyHtml('No transactions yet.');
}

function transactionRow(t, withDelete = false) {
  const isIncome = t.type === 'income';
  const sign = isIncome ? '+' : '-';
  return `
    <div class="list-item">
      <div class="item-left">
        <div class="item-title">${escapeHtml(t.category)}</div>
        <div class="item-sub">${formatDate(t.date)}${t.notes ? ` • ${escapeHtml(t.notes)}` : ''}</div>
      </div>
      <div>
        <div class="item-amount ${isIncome ? 'amount-income' : 'amount-out'}">${sign}${peso(t.amount)}</div>
        ${withDelete ? (t.type === 'debt-payment' && t.debtId
          ? `<div class="item-actions"><span class="item-sub">Managed in Debts</span></div>`
          : `<div class="item-actions"><button class="mini-btn" onclick="deleteTransaction('${t.id}')">Delete</button></div>`) : ''}
      </div>
    </div>`;
}

function debtListRow(d) {
  const status = debtStatus(d);
  return `
    <div class="list-item">
      <div class="item-left">
        <div class="item-title">${escapeHtml(d.name)}</div>
        <div class="item-sub">Due ${formatDate(d.dueDate)} • Balance ${peso(d.balance)}</div>
        <span class="status ${status.cls}">${status.text}</span>
      </div>
      <div class="item-amount">${peso(Math.min(d.dueAmount, d.balance))}</div>
    </div>`;
}

function renderTransactions() {
  document.getElementById('transactionHistory').innerHTML = state.transactions.length
    ? state.transactions.map(t => transactionRow(t, true)).join('')
    : emptyHtml('No transactions yet.');
}

function renderDebts() {
  const el = document.getElementById('debtList');
  if (!state.debts.length) {
    el.innerHTML = emptyHtml('No debts added yet.');
    return;
  }

  el.innerHTML = state.debts.map(d => {
    const status = debtStatus(d);
    const paidPercent = d.original > 0
      ? Math.min(100, Math.max(0, ((d.original - d.balance) / d.original) * 100))
      : 0;

    return `
      <div class="list-item debt-card">
        <div class="debt-top">
          <div class="item-left">
            <div class="item-title">${escapeHtml(d.name)}</div>
            <div class="item-sub">
              Original ${peso(d.original)} • Remaining ${peso(d.balance)}<br>
              Due ${formatDate(d.dueDate)} • Reminder ${d.reminderDays} day${d.reminderDays === 1 ? '' : 's'} before
            </div>
            <span class="status ${status.cls}">${status.text}</span>
          </div>
          <div class="item-amount">${peso(Math.min(d.dueAmount, d.balance))}</div>
        </div>
        <div class="debt-progress"><div style="width:${paidPercent}%"></div></div>
        <div class="item-actions">
          ${d.balance > 0 ? `<button class="mini-btn" onclick="recordPayment('${d.id}')">Record Payment</button>` : ''}
          <button class="mini-btn" onclick="editDueDate('${d.id}')">Edit Due Date</button>
          <button class="mini-btn" onclick="deleteDebt('${d.id}')">Delete</button>
        </div>
      </div>`;
  }).join('');
}

function renderReports() {
  const income = sum(state.transactions.filter(t => t.type === 'income').map(t => t.amount));
  const expenses = sum(state.transactions.filter(t => t.type === 'expense').map(t => t.amount));
  const debtPayments = sum(state.transactions.filter(t => t.type === 'debt-payment').map(t => t.amount));
  const net = income - expenses - debtPayments;

  text('reportIncome', peso(income));
  text('reportExpenses', peso(expenses));
  text('reportDebtPayments', peso(debtPayments));
  text('reportNet', peso(net));

  const breakdown = aggregate(
    state.transactions.filter(t => t.type === 'expense'),
    t => t.category,
    t => t.amount
  );

  const rows = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  document.getElementById('expenseBreakdown').innerHTML = rows.length
    ? rows.map(([cat, amount]) => `
        <div class="list-item">
          <div class="item-title">${escapeHtml(cat)}</div>
          <div class="item-amount">${peso(amount)}</div>
        </div>`).join('')
    : emptyHtml('No expense data yet.');

  renderCharts();
}

function renderAll() {
  renderDashboard();
  renderTransactions();
  renderDebts();
  renderReports();
  renderCalendar();
  renderNotificationStatus();
}

function sum(values) {
  return values.reduce((a, b) => a + Number(b || 0), 0);
}

function aggregate(items, keyFn, valueFn) {
  const result = {};
  items.forEach(item => {
    const key = keyFn(item) || 'Other';
    result[key] = (result[key] || 0) + Number(valueFn(item) || 0);
  });
  return result;
}

function text(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function emptyHtml(message) {
  return `<div class="empty">${escapeHtml(message)}</div>`;
}

/* ---------------- Calendar ---------------- */

function renderCalendar() {
  const title = document.getElementById('calendarMonthTitle');
  const grid = document.getElementById('calendarGrid');
  if (!title || !grid) return;

  title.textContent = calendarCursor.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });

  const year = calendarCursor.getFullYear();
  const month = calendarCursor.getMonth();
  const first = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - first.getDay());

  const html = [];
  for (let i = 0; i < 42; i++) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const iso = isoLocal(date);
    const inMonth = date.getMonth() === month;
    const dues = state.debts.filter(d => d.balance > 0 && d.dueDate === iso);
    const tx = state.transactions.filter(t => t.date === iso);
    const events = [
      ...dues.map(d => ({ label: d.name, cls: '' })),
      ...tx.slice(0, 2).map(t => ({ label: t.category, cls: 'tx' }))
    ];
    const visible = events.slice(0, 3);
    const extra = Math.max(0, events.length - visible.length);

    html.push(`
      <button class="calendar-day ${inMonth ? '' : 'outside'} ${iso === todayISO() ? 'today' : ''} ${iso === selectedCalendarDate ? 'selected' : ''}"
              type="button" data-date="${iso}">
        <span class="calendar-number">${date.getDate()}</span>
        <span class="calendar-events">
          ${visible.map(e => `<span class="calendar-event ${e.cls}">${escapeHtml(e.label)}</span>`).join('')}
          ${extra ? `<span class="calendar-more">+${extra} more</span>` : ''}
        </span>
      </button>`);
  }

  grid.innerHTML = html.join('');
  grid.querySelectorAll('.calendar-day').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedCalendarDate = btn.dataset.date;
      const selected = parseISO(selectedCalendarDate);
      if (selected.getMonth() !== calendarCursor.getMonth() || selected.getFullYear() !== calendarCursor.getFullYear()) {
        calendarCursor = startOfMonth(selected);
      }
      renderCalendar();
    });
  });

  renderSelectedDate();
}

function renderSelectedDate() {
  text('selectedDateTitle', formatDate(selectedCalendarDate, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  }));

  const dues = state.debts.filter(d => d.balance > 0 && d.dueDate === selectedCalendarDate);
  const tx = state.transactions.filter(t => t.date === selectedCalendarDate);
  const el = document.getElementById('selectedDateItems');
  if (!el) return;

  const pieces = [];
  dues.forEach(d => {
    pieces.push(`
      <div class="list-item">
        <div class="item-left">
          <div class="item-title">Due: ${escapeHtml(d.name)}</div>
          <div class="item-sub">Balance ${peso(d.balance)} • Reminder ${d.reminderDays} day${d.reminderDays === 1 ? '' : 's'} before</div>
        </div>
        <div class="item-amount amount-out">${peso(Math.min(d.dueAmount, d.balance))}</div>
      </div>`);
  });

  tx.forEach(t => pieces.push(transactionRow(t, false)));
  el.innerHTML = pieces.length ? pieces.join('') : emptyHtml('No dues or transactions on this date.');
}

/* ---------------- Charts ---------------- */

function renderCharts() {
  const reportsPage = document.getElementById('reports');
  if (!reportsPage || !reportsPage.classList.contains('active')) return;

  const incomeGroups = aggregate(
    state.transactions.filter(t => t.type === 'income'),
    t => t.category,
    t => t.amount
  );
  drawDonutChart('incomeChart', incomeGroups, 'incomeLegend');

  const bills = sum(state.transactions.filter(t => t.type === 'expense' && t.category === 'Bills').map(t => t.amount));
  const expenses = sum(state.transactions.filter(t => t.type === 'expense' && t.category !== 'Bills').map(t => t.amount));
  const debt = sum(state.transactions.filter(t => t.type === 'debt-payment').map(t => t.amount));
  drawAllocationPie('allocationChart', { Expenses: expenses, Bills: bills, Debt: debt });

  const spending = aggregate(
    state.transactions.filter(t => t.type === 'expense'),
    t => t.category,
    t => t.amount
  );
  drawBarChart('spendingChart', spending);
}

function setupCanvas(canvas) {
  const cssWidth = canvas.clientWidth || Number(canvas.getAttribute('width')) || 400;
  const cssHeight = canvas.clientHeight || Number(canvas.getAttribute('height')) || 300;
  const ratio = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  return { ctx, width: cssWidth, height: cssHeight };
}

function drawDonutChart(canvasId, dataObj, legendId) {
  const canvas = document.getElementById(canvasId);
  const legend = document.getElementById(legendId);
  if (!canvas || !legend) return;

  const entries = Object.entries(dataObj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const { ctx, width, height } = setupCanvas(canvas);
  const total = sum(entries.map(([, v]) => v));

  if (!total) {
    drawEmptyChart(ctx, width, height, 'Add income to see breakdown');
    legend.innerHTML = '';
    return;
  }

  const cx = width * .5;
  const cy = height * .52;
  const radius = Math.min(width, height) * .34;
  const inner = radius * .5;
  let start = -Math.PI / 2;

  entries.forEach(([name, value], i) => {
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, start + angle);
    ctx.arc(cx, cy, inner, start + angle, start, true);
    ctx.closePath();
    ctx.fillStyle = chartPalette[i % chartPalette.length];
    ctx.fill();
    start += angle;
  });

  ctx.fillStyle = '#4b4037';
  ctx.textAlign = 'center';
  ctx.font = '11px Georgia';
  ctx.fillText('TOTAL INCOME', cx, cy - 4);
  ctx.font = '600 13px system-ui';
  ctx.fillText(shortMoney(total), cx, cy + 16);

  legend.innerHTML = entries.map(([name, value], i) => `
    <div class="legend-row">
      <span class="legend-dot" style="background:${chartPalette[i % chartPalette.length]}"></span>
      <span>${escapeHtml(name)} · ${Math.round(value / total * 100)}%</span>
    </div>`).join('');
}

function drawAllocationPie(canvasId, dataObj) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;

  const entries = Object.entries(dataObj).filter(([, v]) => v > 0);
  const { ctx, width, height } = setupCanvas(canvas);
  const total = sum(entries.map(([, v]) => v));

  if (!total) {
    drawEmptyChart(ctx, width, height, 'Add expenses or debt payments');
    return;
  }

  const cx = width * .5;
  const cy = height * .52;
  const radius = Math.min(width, height) * .31;
  let start = -Math.PI / 2;

  entries.forEach(([name, value], i) => {
    const angle = value / total * Math.PI * 2;
    const end = start + angle;
    const mid = start + angle / 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, start, end);
    ctx.closePath();
    ctx.fillStyle = chartPalette[i % chartPalette.length];
    ctx.fill();

    const x1 = cx + Math.cos(mid) * radius * .95;
    const y1 = cy + Math.sin(mid) * radius * .95;
    const x2 = cx + Math.cos(mid) * radius * 1.18;
    const y2 = cy + Math.sin(mid) * radius * 1.18;
    const right = Math.cos(mid) >= 0;
    const x3 = x2 + (right ? 34 : -34);

    ctx.strokeStyle = '#9a8a7a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y2);
    ctx.stroke();

    ctx.fillStyle = '#5c5047';
    ctx.font = '11px Georgia';
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(name, x3 + (right ? 5 : -5), y2 - 2);
    ctx.fillStyle = '#8b7c70';
    ctx.font = '10px Georgia';
    ctx.fillText(`${(value / total * 100).toFixed(1)}%`, x3 + (right ? 5 : -5), y2 + 11);

    start = end;
  });
}

function drawBarChart(canvasId, dataObj) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const entries = Object.entries(dataObj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 20);
  const { ctx, width, height } = setupCanvas(canvas);
  const total = sum(entries.map(([, v]) => v));

  if (!total) {
    drawEmptyChart(ctx, width, height, 'Add spending to see category chart');
    return;
  }

  const left = 48, right = 14, top = 20, bottom = 92;
  const plotW = width - left - right;
  const plotH = height - top - bottom;
  const percentages = entries.map(([, v]) => v / total * 100);
  const rawMax = Math.max(...percentages, 10);
  const maxPct = Math.ceil(rawMax / 10) * 10;
  const ticks = 4;

  ctx.strokeStyle = '#c9bdad';
  ctx.fillStyle = '#66594f';
  ctx.font = '10px Georgia';

  for (let i = 0; i <= ticks; i++) {
    const pct = maxPct * (ticks - i) / ticks;
    const y = top + plotH * i / ticks;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(width - right, y);
    ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(`${pct.toFixed(0)}%`, left - 7, y + 3);
  }

  ctx.strokeStyle = '#4f4137';
  ctx.beginPath();
  ctx.moveTo(left, top + plotH);
  ctx.lineTo(width - right, top + plotH);
  ctx.stroke();

  const slot = plotW / entries.length;
  const barW = Math.max(7, Math.min(24, slot * .55));

  entries.forEach(([name], i) => {
    const pct = percentages[i];
    const h = plotH * pct / maxPct;
    const x = left + slot * i + (slot - barW) / 2;
    const y = top + plotH - h;

    ctx.fillStyle = '#4b382b';
    roundRect(ctx, x, y, barW, h, 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x + barW / 2, top + plotH + 10);
    ctx.rotate(-Math.PI / 3.3);
    ctx.fillStyle = '#5f5349';
    ctx.font = '10px Georgia';
    ctx.textAlign = 'right';
    ctx.fillText(truncate(name, 15), 0, 0);
    ctx.restore();
  });
}

function drawEmptyChart(ctx, width, height, message) {
  ctx.fillStyle = '#8b7c70';
  ctx.font = '12px Georgia';
  ctx.textAlign = 'center';
  ctx.fillText(message, width / 2, height / 2);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function shortMoney(value) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `₱${(value / 1_000).toFixed(1)}K`;
  return peso(value);
}

function truncate(value, max) {
  const s = String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/* ---------------- Notifications + IndexedDB ---------------- */

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DEBT_STORE)) {
        db.createObjectStore(DEBT_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(NOTICE_STORE)) {
        db.createObjectStore(NOTICE_STORE, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function syncDebtsToIndexedDB() {
  if (!('indexedDB' in window)) return;
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DEBT_STORE, 'readwrite');
    const store = tx.objectStore(DEBT_STORE);
    store.clear();
    state.debts.forEach(debt => store.put(debt));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    alert('Notifications are not supported by this browser.');
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    renderNotificationStatus();
    alert('Notification permission was not granted. You can change it in your browser/site settings.');
    return;
  }

  await syncDebtsToIndexedDB();
  await registerPeriodicDueCheck();
  await requestDueCheck();
  renderNotificationStatus();
}

async function registerPeriodicDueCheck() {
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!('periodicSync' in registration)) return false;

    let allowed = true;
    if ('permissions' in navigator && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
        allowed = status.state === 'granted';
      } catch {
        allowed = true;
      }
    }

    if (!allowed) return false;
    await registration.periodicSync.register('check-due-reminders', {
      minInterval: 12 * 60 * 60 * 1000
    });
    return true;
  } catch (err) {
    console.warn('Periodic background sync unavailable:', err);
    return false;
  }
}

async function requestDueCheck() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const worker = registration.active || navigator.serviceWorker.controller;
    if (worker) worker.postMessage({ type: 'CHECK_DUES' });
  } catch (err) {
    console.warn('Due check failed:', err);
  }
}

async function sendTestNotification() {
  if (!('Notification' in window)) {
    alert('Notifications are not supported by this browser.');
    return;
  }

  if (Notification.permission !== 'granted') {
    await enableNotifications();
    if (Notification.permission !== 'granted') return;
  }

  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification('Pera Tracker', {
      body: 'Test successful. Due date reminders are enabled.',
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'pera-tracker-test',
      renotify: false
    });
  } catch (err) {
    alert('Unable to send the test notification on this browser.');
  }
}

async function renderNotificationStatus() {
  const menuStatus = document.getElementById('menuNotificationStatus');
  if (!menuStatus) return;

  if (!('Notification' in window)) {
    menuStatus.textContent = 'Notifications are not supported here';
    return;
  }

  if (Notification.permission === 'granted') {
    menuStatus.textContent = 'Notifications allowed';
  } else if (Notification.permission === 'denied') {
    menuStatus.textContent = 'Blocked — change Chrome site settings';
  } else {
    menuStatus.textContent = 'Allow due-date reminders';
  }
}

/* ---------------- PWA install/update ---------------- */

function initPWA() {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    const btn = document.getElementById('installTopBtn');
    if (btn) btn.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('installTopBtn');
    if (btn) btn.hidden = true;
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('./service-worker.js');
        await navigator.serviceWorker.ready;
        await syncDebtsToIndexedDB();
        await requestDueCheck();

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              const dot = document.getElementById('menuUpdateDot');
              const status = document.getElementById('menuRefreshStatus');
              if (dot) dot.hidden = false;
              if (status) status.textContent = 'New version available — tap to refresh';
            }
          });
        });
      } catch (err) {
        console.error('Service worker registration failed:', err);
      }
    });
  }
}


/* ---------------- V3 menu + refresh ---------------- */

function showToast(message, ms = 2600) {
  const el = document.getElementById('appToast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.textContent = message;
  el.hidden = false;
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

function setMenuOpen(open) {
  const menu = document.getElementById('appMenu');
  const trigger = document.getElementById('menuTrigger');
  if (!menu || !trigger) return;
  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(open));
}

async function refreshForLatestVersion() {
  setMenuOpen(false);
  const status = document.getElementById('menuRefreshStatus');
  if (status) status.textContent = 'Downloading latest app files…';
  showToast('Refreshing Pera Tracker to the latest version…', 3000);

  try {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      for (const registration of registrations) {
        try {
          await registration.update();
          if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
        } catch (err) {
          console.warn('Service worker update failed:', err);
        }
      }
    }

    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key.startsWith('pera-tracker-')).map(key => caches.delete(key)));
    }
  } catch (err) {
    console.warn('Refresh cleanup failed:', err);
  }

  const url = new URL(window.location.href);
  url.searchParams.set('v', Date.now().toString());
  setTimeout(() => window.location.replace(url.toString()), 450);
}

function updateTransactionCategories() {
  const typeEl = document.getElementById('txType');
  const categoryEl = document.getElementById('txCategory');
  if (!typeEl || !categoryEl) return;
  const current = categoryEl.value;
  const categories = typeEl.value === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  categoryEl.innerHTML = categories.map(c => `<option>${escapeHtml(c)}</option>`).join('');
  if (categories.includes(current)) categoryEl.value = current;
}

/* ---------------- V4 Photo -> Text OCR ---------------- */

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
let tesseractLoadPromise = null;

function ensureTesseractLoaded() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractLoadPromise) return tesseractLoadPromise;

  tesseractLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-pera-tesseract]');
    if (existing) {
      existing.addEventListener('load', () => resolve(window.Tesseract), { once: true });
      existing.addEventListener('error', () => reject(new Error('OCR library failed to load')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = TESSERACT_CDN;
    script.async = true;
    script.dataset.peraTesseract = 'true';
    script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('OCR library unavailable'));
    script.onerror = () => reject(new Error('OCR library failed to download'));
    document.head.appendChild(script);
  });

  return tesseractLoadPromise;
}

function setPhotoOcrProgress(percent, status, hint) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(percent || 0))));
  const bar = document.getElementById('photoOcrProgress');
  if (bar) bar.style.width = `${pct}%`;
  text('photoOcrPercent', `${pct}%`);
  if (status) text('photoOcrStatus', status);
  if (hint) text('photoOcrHint', hint);
}

function resetPhotoWorkspace() {
  photoScanData = null;
  if (currentPhotoObjectUrl) {
    URL.revokeObjectURL(currentPhotoObjectUrl);
    currentPhotoObjectUrl = null;
  }
  const workspace = document.getElementById('photoWorkspace');
  const preview = document.getElementById('photoPreview');
  const output = document.getElementById('photoTextOutput');
  const summary = document.getElementById('receiptSummary');
  if (workspace) workspace.hidden = true;
  if (preview) preview.removeAttribute('src');
  if (output) output.value = '';
  if (summary) summary.hidden = true;
  setPhotoOcrProgress(0, 'Waiting for a photo', 'Take a photo or choose an image.');
  ['photoCameraInput', 'photoGalleryInput'].forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
}

async function handlePhotoFile(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    showToast('Please select an image.', 3000);
    return;
  }

  const workspace = document.getElementById('photoWorkspace');
  const preview = document.getElementById('photoPreview');
  const output = document.getElementById('photoTextOutput');
  const summary = document.getElementById('receiptSummary');

  if (workspace) workspace.hidden = false;
  if (summary) summary.hidden = true;
  if (output) output.value = '';

  if (currentPhotoObjectUrl) URL.revokeObjectURL(currentPhotoObjectUrl);
  currentPhotoObjectUrl = URL.createObjectURL(file);
  if (preview) preview.src = currentPhotoObjectUrl;

  setPhotoOcrProgress(3, 'Photo loaded', 'Enhanced receipt scan is preparing the image…');

  try {
    const TesseractLib = await ensureTesseractLoaded();
    setPhotoOcrProgress(8, 'OCR engine ready', 'Upscaling and enhancing faint receipt text…');

    const variants = await preprocessPhotoVariants(file);
    setPhotoOcrProgress(18, 'Image enhanced', 'Running receipt OCR pass 1 of 2…');

    let ocrPhase = 1;
    const worker = await TesseractLib.createWorker('eng', 1, {
      logger: message => {
        if (!message || typeof message.progress !== 'number') return;
        // Each recognition pass updates this callback. The active range is controlled below.
        const phase = Number(ocrPhase || 1);
        const startPct = phase === 1 ? 18 : 57;
        const span = phase === 1 ? 34 : 35;
        const mapped = startPct + (message.progress * span);
        const status = message.status ? titleCaseWords(message.status) : 'Reading receipt';
        setPhotoOcrProgress(mapped, status, `Enhanced receipt scan • pass ${phase} of 2`);
      }
    });

    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '6'
    });

    ocrPhase = 1;
    const first = await worker.recognize(variants.enhanced, { rotateAuto: true });

    setPhotoOcrProgress(56, 'First pass complete', 'Running a second pass for faint totals and dot-matrix text…');
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '11'
    });

    ocrPhase = 2;
    const second = await worker.recognize(variants.binary, { rotateAuto: true });
    await worker.terminate();

    setPhotoOcrProgress(94, 'Comparing OCR passes', 'Choosing the clearest text and receipt details…');

    const candidates = [first, second].map((result, index) => {
      const rawText = result?.data?.text || '';
      const cleanedText = cleanOcrText(rawText);
      return {
        pass: index + 1,
        rawText,
        cleanedText,
        confidence: Number(result?.data?.confidence || 0),
        score: scoreReceiptOcrCandidate(cleanedText, Number(result?.data?.confidence || 0))
      };
    });

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    const alternate = candidates[1];
    const displayText = mergeImportantReceiptLines(best.cleanedText, alternate?.cleanedText || '');
    const parsingText = candidates.map(c => c.cleanedText).filter(Boolean).join('\n');

    if (output) output.value = displayText || '[No readable text detected]';

    const parsed = parsePhotoAsReceipt(parsingText);
    photoScanData = {
      rawText: best.rawText,
      cleanedText: displayText,
      allOcrText: parsingText,
      confidence: best.confidence,
      ...parsed
    };
    renderPhotoReceiptSummary(parsed);

    const quality = best.confidence >= 70 ? 'High' : best.confidence >= 45 ? 'Moderate' : 'Low';
    setPhotoOcrProgress(
      100,
      displayText ? 'Enhanced scan complete' : 'No readable text found',
      displayText
        ? `${quality} OCR confidence. Review the editable notepad before using any amount.`
        : 'Try filling the frame with the receipt, keeping it flat, and avoiding glare.'
    );
    if (displayText) showToast('Enhanced receipt scan complete.', 2800);
  } catch (err) {
    console.error('Photo OCR failed:', err);
    if (output) output.value = 'OCR could not read this image. Please try again with a clearer photo.';
    setPhotoOcrProgress(0, 'OCR failed', 'Internet is needed the first time the OCR engine loads. Try again with a clear, well-lit photo.');
    showToast('Photo OCR failed. Try again while online.', 3500);
  }
}

/**
 * Builds two OCR-friendly canvases:
 * 1) auto-leveled grayscale + sharpening for general receipt text
 * 2) adaptive local threshold for faint thermal/dot-matrix printing and uneven shadows
 *
 * Unlike V4, small phone images are deliberately UPSCALED before OCR.
 */
function preprocessPhotoVariants(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const sourceW = Math.max(1, img.naturalWidth || img.width);
        const sourceH = Math.max(1, img.naturalHeight || img.height);
        const sourceLong = Math.max(sourceW, sourceH);

        // Small receipt photos need significantly more pixels for Tesseract.
        // Keep memory reasonable on mobile while preserving large originals.
        let targetLong;
        if (sourceLong < 900) targetLong = 2400;
        else if (sourceLong < 1500) targetLong = 2500;
        else if (sourceLong < 2300) targetLong = 2500;
        else targetLong = Math.min(sourceLong, 2800);

        let scale = Math.min(6, targetLong / sourceLong);
        const maxPixels = 5_600_000;
        const projectedPixels = sourceW * sourceH * scale * scale;
        if (projectedPixels > maxPixels) {
          scale = Math.sqrt(maxPixels / (sourceW * sourceH));
        }
        const width = Math.max(1, Math.round(sourceW * scale));
        const height = Math.max(1, Math.round(sourceH * scale));

        const base = document.createElement('canvas');
        base.width = width;
        base.height = height;
        const bctx = base.getContext('2d', { willReadFrequently: true });
        bctx.imageSmoothingEnabled = true;
        bctx.imageSmoothingQuality = 'high';
        bctx.fillStyle = '#ffffff';
        bctx.fillRect(0, 0, width, height);
        bctx.drawImage(img, 0, 0, width, height);

        const src = bctx.getImageData(0, 0, width, height);
        const px = src.data;
        const count = width * height;
        const gray = new Uint8ClampedArray(count);
        const histogram = new Uint32Array(256);

        for (let p = 0, i = 0; p < count; p++, i += 4) {
          const g = Math.max(0, Math.min(255, Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])));
          gray[p] = g;
          histogram[g]++;
        }

        const low = histogramPercentile(histogram, count, 0.025);
        const high = histogramPercentile(histogram, count, 0.985);
        const range = Math.max(28, high - low);
        const leveled = new Uint8ClampedArray(count);

        for (let p = 0; p < count; p++) {
          let v = (gray[p] - low) * 255 / range;
          v = Math.max(0, Math.min(255, v));
          // Slight gamma lift keeps faded thermal paper readable.
          v = 255 * Math.pow(v / 255, 0.88);
          leveled[p] = Math.round(v);
        }

        const sharpened = sharpenReceiptGray(leveled, width, height);

        const enhanced = document.createElement('canvas');
        enhanced.width = width;
        enhanced.height = height;
        const ectx = enhanced.getContext('2d', { willReadFrequently: true });
        const enhancedImage = ectx.createImageData(width, height);
        for (let p = 0, i = 0; p < count; p++, i += 4) {
          const v = sharpened[p];
          enhancedImage.data[i] = v;
          enhancedImage.data[i + 1] = v;
          enhancedImage.data[i + 2] = v;
          enhancedImage.data[i + 3] = 255;
        }
        ectx.putImageData(enhancedImage, 0, 0);

        // Adaptive threshold is much better than one global threshold when a receipt
        // has hand shadows, creases, glare or faded dot-matrix printing.
        const binaryGray = adaptiveThresholdReceipt(sharpened, width, height);
        const binary = document.createElement('canvas');
        binary.width = width;
        binary.height = height;
        const binctx = binary.getContext('2d', { willReadFrequently: true });
        const binaryImage = binctx.createImageData(width, height);
        for (let p = 0, i = 0; p < count; p++, i += 4) {
          const v = binaryGray[p];
          binaryImage.data[i] = v;
          binaryImage.data[i + 1] = v;
          binaryImage.data[i + 2] = v;
          binaryImage.data[i + 3] = 255;
        }
        binctx.putImageData(binaryImage, 0, 0);

        URL.revokeObjectURL(url);
        resolve({ enhanced, binary, width, height });
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Image could not be opened'));
    };
    img.src = url;
  });
}

function histogramPercentile(histogram, total, percentile) {
  const target = Math.max(1, Math.floor(total * percentile));
  let running = 0;
  for (let i = 0; i < histogram.length; i++) {
    running += histogram[i];
    if (running >= target) return i;
  }
  return 255;
}

function sharpenReceiptGray(input, width, height) {
  const out = new Uint8ClampedArray(input.length);
  out.set(input);
  if (width < 3 || height < 3) return out;

  // Gentle unsharp cross kernel; enough for thermal/dot-matrix strokes without
  // turning paper texture into heavy black noise.
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const p = row + x;
      const center = input[p] * 5;
      const neighbors = input[p - 1] + input[p + 1] + input[p - width] + input[p + width];
      const v = center - neighbors;
      out[p] = Math.max(0, Math.min(255, v));
    }
  }
  return out;
}

function adaptiveThresholdReceipt(input, width, height) {
  const out = new Uint8ClampedArray(input.length);
  const integralW = width + 1;
  const integral = new Uint32Array((width + 1) * (height + 1));

  for (let y = 1; y <= height; y++) {
    let rowSum = 0;
    const srcRow = (y - 1) * width;
    const intRow = y * integralW;
    const prevRow = (y - 1) * integralW;
    for (let x = 1; x <= width; x++) {
      rowSum += input[srcRow + x - 1];
      integral[intRow + x] = integral[prevRow + x] + rowSum;
    }
  }

  const radius = Math.max(14, Math.min(42, Math.round(Math.min(width, height) / 45)));
  const bias = 10;

  for (let y = 0; y < height; y++) {
    const y1 = Math.max(0, y - radius);
    const y2 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x1 = Math.max(0, x - radius);
      const x2 = Math.min(width - 1, x + radius);
      const A = integral[y1 * integralW + x1];
      const B = integral[y1 * integralW + (x2 + 1)];
      const C = integral[(y2 + 1) * integralW + x1];
      const D = integral[(y2 + 1) * integralW + (x2 + 1)];
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const mean = (D - B - C + A) / area;
      const value = input[y * width + x];
      out[y * width + x] = value < (mean - bias) ? 0 : 255;
    }
  }
  return out;
}

function cleanOcrText(rawText) {
  return String(rawText || '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line, index, arr) => line || (index > 0 && arr[index - 1]))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function scoreReceiptOcrCandidate(textValue, confidence) {
  const text = String(textValue || '');
  if (!text) return 0;
  const chars = (text.match(/[A-Za-z0-9]/g) || []).length;
  const lines = text.split('\n').filter(Boolean).length;
  const receiptWords = (text.match(/\b(total|subtotal|amount|due|cash|change|vat|sales|item|qty|receipt|invoice|tin|cashier)\b/gi) || []).length;
  const moneyValues = findReceiptAmounts(text).length;
  return (Number(confidence || 0) * 1.35) + Math.min(chars, 900) / 7 + Math.min(lines, 45) * 1.6 + receiptWords * 9 + moneyValues * 5;
}

function normalizeComparableOcrLine(line) {
  return String(line || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 80);
}

function mergeImportantReceiptLines(primaryText, secondaryText) {
  const primary = cleanOcrText(primaryText);
  const secondary = cleanOcrText(secondaryText);
  if (!primary) return secondary;
  if (!secondary) return primary;

  const primaryLines = primary.split('\n');
  const normalized = new Set(primaryLines.map(normalizeComparableOcrLine).filter(Boolean));
  const important = /(grand\s*total|total\s*due|amount\s*due|\btotal\b|subtotal|cash\b|change\b|vat\b|discount|date\b|\b20\d{2}[-/.]|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2})/i;
  const extras = [];

  for (const line of secondary.split('\n')) {
    const key = normalizeComparableOcrLine(line);
    if (!key || normalized.has(key)) continue;
    if (important.test(line)) {
      extras.push(line);
      normalized.add(key);
    }
  }

  return extras.length ? `${primary}\n\n${extras.join('\n')}` : primary;
}

function titleCaseWords(value) {
  return String(value || '').replace(/\b\w/g, ch => ch.toUpperCase());
}

function parsePhotoAsReceipt(textValue) {
  const text = String(textValue || '');
  const lines = text.split('\n').map(v => v.trim()).filter(Boolean);
  if (!lines.length) return { isReceipt: false, merchant: '', date: '', total: 0, category: 'Other' };

  const receiptSignals = /(total|subtotal|amount\s*due|vat|invoice|receipt|cash|change|tender|tax|qty|item|cashier|tin\b)/i.test(text);
  const total = detectPhotoTotal(lines);
  const date = detectPhotoDate(lines);
  const merchant = detectPhotoMerchant(lines, text);
  const category = guessPhotoCategory(text);
  return { isReceipt: Boolean(receiptSignals || total), merchant, date, total, category };
}

function detectPhotoMerchant(lines, fullText = '') {
  const t = String(fullText || '').toLowerCase();

  // Common receipt/product clues can recover the merchant even when the header
  // is cropped, faded or obscured by a finger.
  if (/(jollibee|yumburger|burger\s*steak|jolly\s*spag|spag\s*mc|yum\s*wspag|icedtea\s*mc)/i.test(t)) return 'Jollibee';
  if (/(mcdonald|mcdo\b|big\s*mac|mcchicken)/i.test(t)) return "McDonald's";
  if (/(starbucks|frappuccino|caffe\s*latte)/i.test(t)) return 'Starbucks';
  if (/(puregold)/i.test(t)) return 'Puregold';
  if (/(savemore)/i.test(t)) return 'Savemore';
  if (/(sm\s*supermarket)/i.test(t)) return 'SM Supermarket';

  const skip = /(official receipt|sales invoice|invoice|receipt|vat|tin\b|address|tel\b|telephone|date\b|time\b|cashier|order\b|qty\b|subtotal|total|amount|change|cash\b|sales\b|item\b)/i;
  const candidates = lines.filter(line => line.length >= 3 && line.length <= 58 && !skip.test(line) && !/^[-\d\s.,:/$₱P]+$/i.test(line));
  return candidates[0] || '';
}

function normalizeReceiptAmountText(value) {
  return String(value || '')
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0')
    .replace(/[Il](?=\d)/g, '1')
    .replace(/(?<=\d)[Il]/g, '1')
    .replace(/₱/g, 'P')
    .replace(/\bPHP\b/gi, 'P')
    .replace(/(\d)\s*[.,]\s*(\d{2})\b/g, '$1.$2')
    .replace(/P\s+(?=\d)/gi, 'P');
}

function findReceiptAmounts(textValue) {
  const text = normalizeReceiptAmountText(textValue);
  const values = [];
  // Accepts: 524.00, P501.00, P 501.00, 1,234.56 and OCR-spaced decimals.
  const re = /(?:\bP\s*)?((?:\d{1,3}(?:,\d{3})+)|\d+)\.(\d{2})\b/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    const value = Number(`${m[1].replace(/,/g, '')}.${m[2]}`);
    if (Number.isFinite(value) && value > 0 && value < 100000000) values.push(value);
  }
  return values;
}

function detectPhotoTotal(lines) {
  const candidates = [];
  const labelWeights = [
    [/grand\s*total|total\s*due|amount\s*due|amount\s*payable|net\s*total/i, 30],
    [/\btotal\b/i, 18],
    [/subtotal/i, 4],
    [/cash\b|tender/i, -12],
    [/change\b/i, -18],
    [/discount|disc\b|less\b/i, -12],
    [/vat\s*amount|vatable|vat[- ]?exempt|sales\b/i, -9]
  ];

  let cashValue = 0;
  let changeValue = 0;

  lines.forEach((originalLine, index) => {
    const line = normalizeReceiptAmountText(originalLine);
    let weight = 0;
    for (const [pattern, score] of labelWeights) {
      if (pattern.test(line)) weight += score;
    }
    const values = findReceiptAmounts(line);
    values.forEach(value => candidates.push({ value, weight, index, line }));

    // Many POS receipts expose the payable total indirectly as CASH - CHANGE.
    // This is especially useful when the bold TOTAL DUE line is crumpled or faint.
    if (/\bcash\b|tender/i.test(line) && !/cashier/i.test(line) && values.length) cashValue = values[values.length - 1];
    if (/\bchange\b/i.test(line) && values.length) changeValue = values[values.length - 1];
  });

  if (!candidates.length && !(cashValue > changeValue && changeValue >= 0)) return 0;

  candidates.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    if (b.index !== a.index) return b.index - a.index;
    return b.value - a.value;
  });

  const best = candidates[0];
  const cashMinusChange = cashValue > 0 && changeValue >= 0 && cashValue > changeValue
    ? Math.round((cashValue - changeValue) * 100) / 100
    : 0;

  if (cashMinusChange > 0) {
    // If TOTAL was not recognized, use the arithmetic receipt check directly.
    if (!best || best.weight <= 0) return cashMinusChange;

    // A folded/bold total can OCR one digit incorrectly (e.g. 524 -> 824).
    // CASH - CHANGE is a strong independent check, so prefer it when the printed
    // total is materially inconsistent with the payment arithmetic.
    const difference = Math.abs(best.value - cashMinusChange);
    const tolerance = Math.max(1, cashMinusChange * 0.015);
    if (difference > tolerance) return cashMinusChange;
  }

  if (best && best.weight > 0) return best.value;

  const plausible = candidates.filter(c => c.value >= 10).sort((a, b) => b.value - a.value);
  return plausible[0]?.value || best?.value || cashMinusChange || 0;
}

function normalizeReceiptDateText(value) {
  return String(value || '')
    .replace(/[Oo](?=\d)/g, '0')
    .replace(/(?<=\d)[Oo]/g, '0')
    .replace(/[Il](?=\d)/g, '1')
    .replace(/(?<=\d)[Il]/g, '1')
    .replace(/\s*([\/-])\s*/g, '$1');
}

function detectPhotoDate(lines) {
  const patterns = [
    /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/,
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/,
    /\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})\b/
  ];

  for (const rawLine of lines) {
    const line = normalizeReceiptDateText(rawLine);
    let m = line.match(patterns[0]);
    if (m) return normalizeYMD(Number(m[1]), Number(m[2]), Number(m[3]));

    m = line.match(patterns[1]);
    if (m) {
      let a = Number(m[1]), b = Number(m[2]);
      // PH receipts commonly use MM/DD/YYYY. If one side is >12, resolve it safely.
      const month = a > 12 ? b : a;
      const day = a > 12 ? a : b;
      const normalized = normalizeYMD(Number(m[3]), month, day);
      if (normalized) return normalized;
    }

    m = line.match(patterns[2]);
    if (m) {
      const year = 2000 + Number(m[3]);
      let a = Number(m[1]), b = Number(m[2]);
      const month = a > 12 ? b : a;
      const day = a > 12 ? a : b;
      const normalized = normalizeYMD(year, month, day);
      if (normalized) return normalized;
    }
  }
  return '';
}

function normalizeYMD(year, month, day) {
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return '';
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function guessPhotoCategory(value) {
  const t = String(value || '').toLowerCase();
  if (/(restaurant|cafe|coffee|burger|chicken|pizza|food|meal|jollibee|mcdonald|starbucks|yumburger|burger\s*steak|spag)/.test(t)) return 'Food';
  if (/(grocery|supermarket|market|puregold|savemore|waltermart|sm supermarket)/.test(t)) return 'Groceries';
  if (/(gas|fuel|petron|shell|caltex|grab|taxi|transport|parking|toll)/.test(t)) return 'Transportation';
  if (/(meralco|electric|water|internet|globe|smart|pldt|bill)/.test(t)) return 'Bills';
  if (/(pharmacy|drug|medicine|hospital|clinic|health)/.test(t)) return 'Health';
  if (/(cinema|movie|netflix|spotify|entertainment)/.test(t)) return 'Entertainment';
  if (/(store|mall|department|uniqlo|shopee|lazada|shopping)/.test(t)) return 'Shopping';
  return 'Other';
}

function renderPhotoReceiptSummary(parsed) {
  const summary = document.getElementById('receiptSummary');
  if (!summary) return;
  if (!parsed || !parsed.isReceipt) {
    summary.hidden = true;
    return;
  }
  summary.hidden = false;
  text('photoMerchant', parsed.merchant || 'Not detected');
  text('photoDate', parsed.date ? formatDate(parsed.date) : 'Not detected');
  text('photoTotal', parsed.total ? peso(parsed.total) : 'Not detected');
  text('photoCategory', parsed.category || 'Other');
}

async function copyPhotoText() {
  const output = document.getElementById('photoTextOutput');
  const value = output ? output.value.trim() : '';
  if (!value) {
    showToast('No extracted text to copy.');
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    showToast('Extracted text copied.');
  } catch {
    output.focus();
    output.select();
    document.execCommand('copy');
    showToast('Extracted text copied.');
  }
}

function usePhotoAsExpense() {
  if (!photoScanData || !photoScanData.total) {
    showToast('No receipt total was detected.');
    return;
  }
  showPage('tracker');
  document.getElementById('txType').value = 'expense';
  updateTransactionCategories();
  document.getElementById('txAmount').value = photoScanData.total;
  document.getElementById('txCategory').value = EXPENSE_CATEGORIES.includes(photoScanData.category) ? photoScanData.category : 'Other';
  document.getElementById('txDate').value = photoScanData.date || todayISO();
  document.getElementById('txNotes').value = [photoScanData.merchant, 'Imported from Photo → Text'].filter(Boolean).join(' — ');
  showToast('Detected receipt details copied to Daily Tracker. Review before saving.', 3400);
}

/* ---------------- Events ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('txDate').value = todayISO();
  updateTransactionCategories();

  document.getElementById('txType').addEventListener('change', updateTransactionCategories);

  document.getElementById('calendarPrevBtn').addEventListener('click', () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1);
    renderCalendar();
  });
  document.getElementById('calendarNextBtn').addEventListener('click', () => {
    calendarCursor = new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1);
    renderCalendar();
  });
  document.getElementById('calendarTodayBtn').addEventListener('click', () => {
    selectedCalendarDate = todayISO();
    calendarCursor = startOfMonth(new Date());
    renderCalendar();
  });

  document.getElementById('menuTrigger').addEventListener('click', event => {
    event.stopPropagation();
    const menu = document.getElementById('appMenu');
    setMenuOpen(menu.hidden);
  });
  document.getElementById('appMenu').addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', () => setMenuOpen(false));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') setMenuOpen(false); });

  document.getElementById('menuPhotoBtn').addEventListener('click', () => { setMenuOpen(false); showPage('photo'); });
  document.getElementById('menuRefreshBtn').addEventListener('click', refreshForLatestVersion);
  document.getElementById('menuEnableNotificationsBtn').addEventListener('click', async () => {
    setMenuOpen(false);
    await enableNotifications();
    renderNotificationStatus();
  });
  document.getElementById('menuTestNotificationBtn').addEventListener('click', async () => {
    setMenuOpen(false);
    await sendTestNotification();
  });

  document.getElementById('photoCameraBtn').addEventListener('click', () => document.getElementById('photoCameraInput').click());
  document.getElementById('photoGalleryBtn').addEventListener('click', () => document.getElementById('photoGalleryInput').click());
  document.getElementById('photoCameraInput').addEventListener('change', event => handlePhotoFile(event.target.files && event.target.files[0]));
  document.getElementById('photoGalleryInput').addEventListener('change', event => handlePhotoFile(event.target.files && event.target.files[0]));
  document.getElementById('copyPhotoTextBtn').addEventListener('click', copyPhotoText);
  document.getElementById('clearPhotoBtn').addEventListener('click', resetPhotoWorkspace);
  document.getElementById('sendPhotoToExpenseBtn').addEventListener('click', usePhotoAsExpense);

  document.getElementById('installTopBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  window.addEventListener('resize', debounce(() => renderCharts(), 180));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestDueCheck();
  });

  initPWA();
  renderAll();
});

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}


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
        ${withDelete ? `<div class="item-actions"><button class="mini-btn" onclick="deleteTransaction('${t.id}')">Delete</button></div>` : ''}
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
    state.transactions.filter(t => t.type === 'expense' || t.type === 'debt-payment'),
    t => t.type === 'debt-payment' ? 'Debt Payment' : t.category,
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
  const statusEl = document.getElementById('notificationStatusText');
  const backgroundEl = document.getElementById('backgroundStatus');
  if (!statusEl || !backgroundEl) return;

  if (!('Notification' in window)) {
    statusEl.textContent = 'This browser does not support web notifications.';
    backgroundEl.textContent = '';
    return;
  }

  if (Notification.permission === 'granted') {
    statusEl.textContent = 'Notifications are allowed. Due reminders will be checked by the installed PWA.';
  } else if (Notification.permission === 'denied') {
    statusEl.textContent = 'Notifications are blocked. Re-enable them in Chrome site settings.';
  } else {
    statusEl.textContent = 'Enable notifications para ma-alert ka sa due dates.';
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    if ('periodicSync' in reg) {
      backgroundEl.textContent = 'Background check: supported on this device/browser (timing is controlled by Android/Chrome).';
    } else {
      backgroundEl.textContent = 'Background check: unavailable here. The app will still check dues whenever you open it.';
    }
  } catch {
    backgroundEl.textContent = '';
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
              const banner = document.getElementById('updateBanner');
              if (banner) banner.hidden = false;
            }
          });
        });
      } catch (err) {
        console.error('Service worker registration failed:', err);
      }
    });
  }
}

/* ---------------- Events ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('txDate').value = todayISO();

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

  document.getElementById('enableNotificationsBtn').addEventListener('click', enableNotifications);
  document.getElementById('testNotificationBtn').addEventListener('click', sendTestNotification);

  document.getElementById('installTopBtn').addEventListener('click', async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
  });

  document.getElementById('refreshAppBtn').addEventListener('click', () => window.location.reload());

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

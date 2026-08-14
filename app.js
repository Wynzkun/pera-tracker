
'use strict';

const STORAGE_KEY = 'peraTrackerPWA_v2';
const LEGACY_KEYS = ['moneyTrackerPWA_v1', 'moneyTrackerSampleV1'];
const DB_NAME = 'peraTrackerDB';
const DB_VERSION = 1;
const DEBT_STORE = 'debts';
const NOTICE_STORE = 'notificationLog';
const THEME_KEY = 'peraTrackerTheme';

const chartPalette = [
  '#4b382b', '#8c7a5b', '#e5d7b8', '#5f866d',
  '#b69c7c', '#6f6258', '#c8b89c', '#82977f',
  '#9b8066', '#d2c4ad', '#574436', '#9d8e79'
];

const EXPENSE_CATEGORIES = ['Food', 'Bills', 'Transportation', 'Groceries', 'Shopping', 'Health', 'Entertainment', 'Other'];
const INCOME_CATEGORIES = ['Paycheck', 'Business', 'Side Hustle', 'Other Income'];
const CREDIT_PROVIDERS = ['Credit Card', 'Billease', 'Salmon', 'Other Credit'];
let photoScanData = null;
let currentPhotoObjectUrl = null;
let toastTimer = null;

let deferredInstallPrompt = null;
let calendarCursor = startOfMonth(new Date());
let selectedCalendarDate = todayISO();

function freshState() {
  return { transactions: [], debts: [], creditAccounts: [] };
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
const debtTrackingMigrated = migrateDebtTrackingState(state);
if (debtTrackingMigrated) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function safeParse(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
}

function normalizeState(raw) {
  return {
    transactions: Array.isArray(raw.transactions) ? raw.transactions.map(t => ({
      id: t.id || uid(),
      type: ['expense', 'income', 'debt-payment', 'credit-purchase', 'credit-payment'].includes(t.type) ? t.type : 'expense',
      amount: Number(t.amount || 0),
      category: t.category || 'Other',
      date: t.date || todayISO(),
      notes: t.notes || '',
      debtId: t.debtId || null,
      creditId: t.creditId || null
    })) : [],
    debts: Array.isArray(raw.debts) ? raw.debts.map(d => ({
      id: d.id || uid(),
      name: d.name || 'Debt',
      original: Number(d.original || d.balance || 0),
      balance: Number(d.balance || 0),
      dueAmount: Number(d.dueAmount || 0),
      dueDate: d.dueDate || todayISO(),
      reminderDays: Number.isFinite(Number(d.reminderDays)) ? Number(d.reminderDays) : 3,
      dueCycleKey: d.dueCycleKey || null,
      duePaidAmount: Number.isFinite(Number(d.duePaidAmount)) ? Number(d.duePaidAmount) : null
    })) : [],
    creditAccounts: Array.isArray(raw.creditAccounts) ? raw.creditAccounts.map(c => ({
      id: c.id || uid(),
      provider: CREDIT_PROVIDERS.includes(c.provider) ? c.provider : 'Other Credit',
      name: c.name || c.provider || 'Credit Account',
      limit: Number(c.limit || 0),
      balance: Number(c.balance || 0),
      dueAmount: Number(c.dueAmount || 0),
      dueDate: c.dueDate || todayISO(),
      reminderDays: Number.isFinite(Number(c.reminderDays)) ? Number(c.reminderDays) : 3
    })) : []
  };
}


function migrateDebtTrackingState(targetState) {
  let changed = false;
  const tx = Array.isArray(targetState.transactions) ? targetState.transactions : [];

  (targetState.debts || []).forEach(debt => {
    const hasCurrentCycle = debt.dueCycleKey === debt.dueDate && Number.isFinite(Number(debt.duePaidAmount));

    if (!hasCurrentCycle) {
      const dueDate = parseISO(debt.dueDate);
      const windowStart = new Date(dueDate);
      windowStart.setDate(windowStart.getDate() - 14);
      const today = parseISO(todayISO());

      const inferred = sum(tx.filter(t => {
        if (t.type !== 'debt-payment' || t.debtId !== debt.id || !t.date) return false;
        const paidDate = parseISO(t.date);
        return paidDate >= windowStart && paidDate <= today;
      }).map(t => t.amount));

      debt.dueCycleKey = debt.dueDate;
      debt.duePaidAmount = inferred;
      changed = true;
    }
  });

  return changed;
}

function getDebtDueInfo(debt) {
  const paidTowardDue = debt.dueCycleKey === debt.dueDate
    ? Math.max(0, Number(debt.duePaidAmount || 0))
    : 0;

  const minimumDue = Math.max(0, Number(debt.dueAmount || 0));
  const remainingDue = debt.balance <= 0
    ? 0
    : Math.max(0, Math.min(Number(debt.balance || 0), minimumDue - paidTowardDue));

  return {
    minimumDue,
    paidTowardDue,
    remainingDue,
    minimumPaid: debt.balance <= 0 || (minimumDue > 0 && paidTowardDue + 0.005 >= minimumDue)
  };
}

function getDebtProgress(debt) {
  const linkedPaid = sum(state.transactions.filter(t =>
    t.type === 'debt-payment' && t.debtId === debt.id
  ).map(t => t.amount));

  // If some payments happened before this app started tracking linked payments,
  // infer them only when Original Amount is still higher than balance + tracked payments.
  const inferredOlderPaid = Math.max(
    0,
    Number(debt.original || 0) - (Number(debt.balance || 0) + linkedPaid)
  );

  const effectivePaid = linkedPaid + inferredOlderPaid;
  const totalBasis = Number(debt.balance || 0) + effectivePaid;
  const percent = Number(debt.balance || 0) <= 0
    ? 100
    : totalBasis > 0
      ? Math.min(100, Math.max(0, (effectivePaid / totalBasis) * 100))
      : 0;

  return { linkedPaid, inferredOlderPaid, effectivePaid, totalBasis, percent };
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
    id: uid(),
    name,
    original,
    balance,
    dueAmount,
    dueDate,
    reminderDays,
    dueCycleKey: dueDate,
    duePaidAmount: 0
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
  debt.dueCycleKey = next;
  debt.duePaidAmount = 0;
  saveState();
  showToast(`Next due date updated for ${debt.name}.`);
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

  const dueBeforePayment = getDebtDueInfo(debt);
  const applied = Math.min(amount, debt.balance);

  if (debt.dueCycleKey !== debt.dueDate) {
    debt.dueCycleKey = debt.dueDate;
    debt.duePaidAmount = 0;
  }

  debt.balance = Math.max(0, debt.balance - applied);
  debt.duePaidAmount = Math.max(0, Number(debt.duePaidAmount || 0)) + applied;

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

  const dueAfterPayment = getDebtDueInfo(debt);
  if (!dueBeforePayment.minimumPaid && dueAfterPayment.minimumPaid && debt.balance > 0) {
    showToast(`Minimum amount due paid for ${debt.name}.`);
  } else if (debt.balance <= 0) {
    showToast(`${debt.name} is fully paid.`);
  } else {
    showToast(`${peso(applied)} payment recorded for ${debt.name}.`);
  }
}
window.recordPayment = recordPayment;

function addCreditAccount() {
  const provider = document.getElementById('creditProvider').value;
  const name = document.getElementById('creditName').value.trim();
  const limit = Number(document.getElementById('creditLimit').value || 0);
  const balance = Number(document.getElementById('creditBalance').value || 0);
  const dueAmount = Number(document.getElementById('creditDueAmount').value || 0);
  const dueDate = document.getElementById('creditDueDate').value;
  const reminderDays = Number(document.getElementById('creditReminder').value);
  if (!name || limit < 0 || balance < 0 || dueAmount < 0 || !dueDate) {
    alert('Please enter the account name, valid amounts, and next due date.');
    return;
  }
  state.creditAccounts.unshift({ id: uid(), provider, name, limit, balance, dueAmount, dueDate, reminderDays });
  ['creditName','creditLimit','creditBalance','creditDueAmount','creditDueDate'].forEach(id => document.getElementById(id).value = '');
  saveState();
  showToast(`${name} added to Credit.`);
}
window.addCreditAccount = addCreditAccount;

function saveCreditActivity() {
  const creditId = document.getElementById('creditActivityAccount').value;
  const account = state.creditAccounts.find(c => c.id === creditId);
  const activity = document.getElementById('creditActivityType').value;
  const amount = Number(document.getElementById('creditActivityAmount').value);
  const date = document.getElementById('creditActivityDate').value;
  const category = document.getElementById('creditActivityCategory').value;
  const description = document.getElementById('creditActivityDescription').value.trim();
  if (!account) { alert('Please select a credit account.'); return; }
  if (!amount || amount <= 0 || !date) { alert('Please enter a valid amount and date.'); return; }

  if (activity === 'purchase') {
    account.balance += amount;
    state.transactions.unshift({
      id: uid(), type: 'credit-purchase', amount, category: EXPENSE_CATEGORIES.includes(category) ? category : 'Other',
      date, notes: description || `Charge to ${account.name}`, debtId: null, creditId: account.id
    });
    if (account.limit > 0 && account.balance > account.limit) showToast(`${account.name} is now above its recorded credit limit.`, 3800);
    else showToast(`Purchase added to ${account.name}.`);
  } else {
    const applied = Math.min(amount, account.balance);
    account.balance = Math.max(0, account.balance - applied);
    account.dueAmount = Math.max(0, account.dueAmount - applied);
    state.transactions.unshift({
      id: uid(), type: 'credit-payment', amount: applied, category: 'Credit Payment', date,
      notes: description || `Payment for ${account.name}`, debtId: null, creditId: account.id
    });
    showToast(`Payment recorded for ${account.name}.`);
  }
  document.getElementById('creditActivityAmount').value = '';
  document.getElementById('creditActivityDescription').value = '';
  saveState();
}

function quickCreditActivity(id, type) {
  showPage('credit');
  document.getElementById('creditActivityAccount').value = id;
  document.getElementById('creditActivityType').value = type;
  updateCreditActivityForm();
  document.getElementById('creditActivityAmount').focus();
}
window.quickCreditActivity = quickCreditActivity;

function updateCreditDue(id) {
  const account = state.creditAccounts.find(c => c.id === id);
  if (!account) return;
  const amountRaw = prompt(`Current amount due for ${account.name}:`, account.dueAmount || 0);
  if (amountRaw === null) return;
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount < 0) { alert('Invalid amount due.'); return; }
  const dateRaw = prompt(`Next due date for ${account.name} (YYYY-MM-DD):`, account.dueDate);
  if (dateRaw === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateRaw) || Number.isNaN(parseISO(dateRaw).getTime())) { alert('Please use YYYY-MM-DD.'); return; }
  account.dueAmount = amount;
  account.dueDate = dateRaw;
  saveState();
}
window.updateCreditDue = updateCreditDue;

function deleteCreditAccount(id) {
  const account = state.creditAccounts.find(c => c.id === id);
  if (!account) return;
  if (!confirm(`Delete ${account.name}? Existing transaction history will stay in the tracker.`)) return;
  state.creditAccounts = state.creditAccounts.filter(c => c.id !== id);
  saveState();
}
window.deleteCreditAccount = deleteCreditAccount;

function creditStatus(account) {
  if (account.balance <= 0) return { text:'CLEAR', cls:'status-paid' };
  const days = daysUntil(account.dueDate);
  if (days < 0 && account.dueAmount > 0) return { text:'OVERDUE', cls:'status-overdue' };
  if (days === 0 && account.dueAmount > 0) return { text:'DUE TODAY', cls:'status-today' };
  if (days <= 7 && days > 0 && account.dueAmount > 0) return { text:`DUE IN ${days} DAY${days===1?'':'S'}`, cls:'status-soon' };
  return { text: formatDate(account.dueDate,{month:'short',day:'numeric'}).toUpperCase(), cls:'status-future' };
}

function updateCreditActivityForm() {
  const type = document.getElementById('creditActivityType')?.value;
  const field = document.getElementById('creditActivityCategoryField');
  if (field) field.style.display = type === 'payment' ? 'none' : '';
}

function renderCredits() {
  const accounts = state.creditAccounts || [];
  const totalLimit = sum(accounts.map(c => c.limit));
  const outstanding = sum(accounts.map(c => c.balance));
  const available = sum(accounts.map(c => c.limit > 0 ? Math.max(0, c.limit - c.balance) : 0));
  const dueSoon = accounts.filter(c => c.dueAmount > 0 && c.balance > 0 && daysUntil(c.dueDate) >= 0 && daysUntil(c.dueDate) <= 7);
  text('creditTotalLimit', peso(totalLimit));
  text('creditOutstanding', peso(outstanding));
  text('creditAvailable', peso(available));
  text('creditDueSoon', peso(sum(dueSoon.map(c => Math.min(c.dueAmount,c.balance)))));
  text('creditAccountCount', `${accounts.length} credit account${accounts.length===1?'':'s'}`);
  text('creditDueSoonCount', `${dueSoon.length} upcoming due${dueSoon.length===1?'':'s'}`);

  const select = document.getElementById('creditActivityAccount');
  if (select) {
    const current=select.value;
    select.innerHTML = accounts.length ? accounts.map(c => `<option value="${c.id}">${escapeHtml(c.name)} · ${escapeHtml(c.provider)}</option>`).join('') : '<option value="">Add an account first</option>';
    if (accounts.some(c=>c.id===current)) select.value=current;
  }

  const list=document.getElementById('creditList');
  if (!list) return;
  if (!accounts.length) { list.innerHTML='<div class="empty credit-empty">No credit accounts yet. Add your credit card, Billease, Salmon, or other line above.</div>'; return; }
  list.innerHTML=accounts.map(c=>{
    const availableAmount=c.limit>0?c.limit-c.balance:0;
    const usage=c.limit>0?(c.balance/c.limit*100):0;
    const status=creditStatus(c);
    return `<article class="credit-account-card">
      <div class="credit-account-top"><div><span class="credit-provider">${escapeHtml(c.provider)}</span><div class="credit-account-name">${escapeHtml(c.name)}</div><span class="status ${status.cls}">${status.text}</span></div>
      <div class="credit-account-balance">${peso(c.balance)}<small>outstanding</small></div></div>
      <div class="credit-usage ${usage>100?'over':''}"><div style="width:${Math.min(100,Math.max(0,usage))}%"></div></div>
      <div class="credit-metrics">
        <div class="credit-metric"><span>Limit</span><strong>${c.limit>0?peso(c.limit):'Not set'}</strong></div>
        <div class="credit-metric"><span>Available</span><strong>${c.limit>0?peso(availableAmount):'—'}</strong></div>
        <div class="credit-metric"><span>Amount Due</span><strong>${peso(Math.min(c.dueAmount,c.balance))}</strong></div>
        <div class="credit-metric"><span>Due Date</span><strong>${formatDate(c.dueDate,{month:'short',day:'numeric'})}</strong></div>
        <div class="credit-metric"><span>Usage</span><strong>${c.limit>0?`${usage.toFixed(0)}%`:'—'}</strong></div>
        <div class="credit-metric"><span>Reminder</span><strong>${c.reminderDays} day${c.reminderDays===1?'':'s'} before</strong></div>
      </div>
      <div class="credit-actions">
        <button class="mini-btn" onclick="quickCreditActivity('${c.id}','purchase')">+ Purchase</button>
        <button class="mini-btn" onclick="quickCreditActivity('${c.id}','payment')">Record Payment</button>
        <button class="mini-btn" onclick="updateCreditDue('${c.id}')">Update Due</button>
        <button class="mini-btn" onclick="deleteCreditAccount('${c.id}')">Delete</button>
      </div>
    </article>`;
  }).join('');
}

function debtStatus(debt) {
  if (debt.balance <= 0) return { text: 'FULLY PAID', cls: 'status-paid' };

  const dueInfo = getDebtDueInfo(debt);
  if (dueInfo.minimumPaid) {
    return { text: 'MINIMUM DUE PAID', cls: 'status-minpaid' };
  }

  const days = daysUntil(debt.dueDate);
  if (days < 0) return { text: 'OVERDUE', cls: 'status-overdue' };
  if (days === 0) return { text: 'DUE TODAY', cls: 'status-today' };
  if (days <= 7) return { text: `DUE IN ${days} DAY${days === 1 ? '' : 'S'}`, cls: 'status-soon' };
  return { text: formatDate(debt.dueDate, { month: 'short', day: 'numeric' }).toUpperCase(), cls: 'status-future' };
}

function renderDashboard() {
  const tx = state.transactions;
  const debts = state.debts;
  const creditAccounts = state.creditAccounts || [];
  const income = sum(tx.filter(t => t.type === 'income').map(t => t.amount));
  const cashOut = sum(tx.filter(t => ['expense','debt-payment','credit-payment'].includes(t.type)).map(t => t.amount));
  const available = income - cashOut;

  const now = new Date();
  const monthlyExpenses = sum(tx.filter(t => {
    const d = parseISO(t.date);
    return ['expense','credit-purchase'].includes(t.type) && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }).map(t => t.amount));

  const activeDebts = debts.filter(d => d.balance > 0);
  const activeCredits = creditAccounts.filter(c => c.balance > 0);
  const totalDebt = sum(activeDebts.map(d => d.balance)) + sum(activeCredits.map(c => c.balance));
  const debtDueSoon = activeDebts.filter(d => {
    const days = daysUntil(d.dueDate);
    const dueInfo = getDebtDueInfo(d);
    return days >= 0 && days <= 7 && !dueInfo.minimumPaid && dueInfo.remainingDue > 0;
  });
  const creditDueSoon = activeCredits.filter(c => c.dueAmount>0 && daysUntil(c.dueDate)>=0 && daysUntil(c.dueDate)<=7);
  const dueSoonTotal = sum(debtDueSoon.map(d => getDebtDueInfo(d).remainingDue)) + sum(creditDueSoon.map(c => Math.min(c.dueAmount,c.balance)));

  text('availableCash', peso(available));
  text('monthlyExpenses', peso(monthlyExpenses));
  text('totalDebt', peso(totalDebt));
  text('dueSoonTotal', peso(dueSoonTotal));
  text('debtCount', `${activeDebts.length} debt${activeDebts.length===1?'':'s'} + ${activeCredits.length} credit account${activeCredits.length===1?'':'s'}`);
  text('dueSoonCount', `${debtDueSoon.length + creditDueSoon.length} upcoming due${debtDueSoon.length + creditDueSoon.length===1?'':'s'}`);
  text('monthLabel', now.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' }));

  const upcoming = [
    ...activeDebts
      .filter(d => !getDebtDueInfo(d).minimumPaid && getDebtDueInfo(d).remainingDue > 0)
      .map(d => ({
        kind:'debt',
        name:d.name,
        balance:d.balance,
        dueAmount:getDebtDueInfo(d).remainingDue,
        dueDate:d.dueDate,
        status:debtStatus(d)
      })),
    ...activeCredits.filter(c=>c.dueAmount>0).map(c => ({kind:'credit', name:c.name, balance:c.balance, dueAmount:c.dueAmount, dueDate:c.dueDate, status:creditStatus(c)}))
  ].sort((a,b)=>parseISO(a.dueDate)-parseISO(b.dueDate)).slice(0,6);
  document.getElementById('upcomingDues').innerHTML = upcoming.length ? upcoming.map(item => `
    <div class="list-item"><div class="item-left"><div class="item-title">${escapeHtml(item.name)}</div><div class="item-sub">${item.kind==='credit'?'Credit':'Debt'} • Due ${formatDate(item.dueDate)} • Balance ${peso(item.balance)}</div><span class="status ${item.status.cls}">${item.status.text}</span></div><div class="item-amount">${peso(Math.min(item.dueAmount,item.balance))}</div></div>`).join('') : emptyHtml('No unpaid dues within the current cycle.');

  document.getElementById('recentTransactions').innerHTML = tx.length ? tx.slice(0,6).map(transactionRow).join('') : emptyHtml('No transactions yet.');
}

function transactionRow(t, withDelete = false) {
  const isIncome = t.type === 'income';
  const isCreditPurchase = t.type === 'credit-purchase';
  const labels = { expense:'Expense', income:'Income', 'debt-payment':'Debt Payment', 'credit-purchase':'Credit Purchase', 'credit-payment':'Credit Payment' };
  const sign = isIncome ? '+' : '-';
  const linkedManaged = Boolean(t.debtId || t.creditId);
  return `
    <div class="list-item">
      <div class="item-left">
        <div class="item-title">${escapeHtml(t.category)}</div>
        <div class="item-sub">${labels[t.type] || t.type} • ${formatDate(t.date)}${t.notes ? ` • ${escapeHtml(t.notes)}` : ''}${isCreditPurchase ? ' • charged to credit' : ''}</div>
      </div>
      <div>
        <div class="item-amount ${isIncome ? 'amount-income' : 'amount-out'}">${sign}${peso(t.amount)}</div>
        ${withDelete ? (linkedManaged ? `<div class="item-actions"><span class="item-sub">Managed in ${t.creditId?'Credit':'Debts'}</span></div>` : `<div class="item-actions"><button class="mini-btn" onclick="deleteTransaction('${t.id}')">Delete</button></div>`) : ''}
      </div>
    </div>`;
}

function debtListRow(d) {
  const status = debtStatus(d);
  const dueInfo = getDebtDueInfo(d);
  return `
    <div class="list-item">
      <div class="item-left">
        <div class="item-title">${escapeHtml(d.name)}</div>
        <div class="item-sub">Due ${formatDate(d.dueDate)} • Balance ${peso(d.balance)}</div>
        <span class="status ${status.cls}">${status.text}</span>
      </div>
      <div class="item-amount">${peso(dueInfo.remainingDue)}</div>
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
    const progress = getDebtProgress(d);
    const dueInfo = getDebtDueInfo(d);
    const percentLabel = `${progress.percent.toFixed(progress.percent < 10 && progress.percent > 0 ? 1 : 0)}%`;

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
          <div class="item-amount">${dueInfo.minimumPaid ? '₱0.00 due' : `${peso(dueInfo.remainingDue)} due`}</div>
        </div>

        <div class="debt-due-summary">
          <span>Minimum due ${peso(dueInfo.minimumDue)}</span>
          <span>Paid this cycle ${peso(Math.min(dueInfo.paidTowardDue, dueInfo.minimumDue || dueInfo.paidTowardDue))}</span>
        </div>

        <div class="debt-progress-meta">
          <span>Overall payment progress</span>
          <strong>${percentLabel}</strong>
        </div>
        <div class="debt-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent.toFixed(1)}">
          <div style="width:${progress.percent}%"></div>
        </div>

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
  const expenses = sum(state.transactions.filter(t => ['expense','credit-purchase'].includes(t.type)).map(t => t.amount));
  const payments = sum(state.transactions.filter(t => ['debt-payment','credit-payment'].includes(t.type)).map(t => t.amount));
  const cashNet = income - sum(state.transactions.filter(t => ['expense','debt-payment','credit-payment'].includes(t.type)).map(t => t.amount));

  text('reportIncome', peso(income));
  text('reportExpenses', peso(expenses));
  text('reportDebtPayments', peso(payments));
  text('reportNet', peso(cashNet));

  const breakdown = aggregate(state.transactions.filter(t => ['expense','credit-purchase'].includes(t.type)), t => t.category, t => t.amount);
  const rows = Object.entries(breakdown).sort((a,b)=>b[1]-a[1]);
  document.getElementById('expenseBreakdown').innerHTML = rows.length ? rows.map(([cat,amount]) => `<div class="list-item"><div class="item-title">${escapeHtml(cat)}</div><div class="item-amount">${peso(amount)}</div></div>`).join('') : emptyHtml('No expense data yet.');
  renderCharts();
}

function renderAll() {
  renderDashboard();
  renderTransactions();
  renderDebts();
  renderCredits();
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
  title.textContent = calendarCursor.toLocaleDateString('en-PH', { month:'long', year:'numeric' });
  const year=calendarCursor.getFullYear(), month=calendarCursor.getMonth();
  const first=new Date(year,month,1); const gridStart=new Date(year,month,1-first.getDay());
  const html=[];
  for(let i=0;i<42;i++){
    const date=new Date(gridStart); date.setDate(gridStart.getDate()+i); const iso=isoLocal(date); const inMonth=date.getMonth()===month;
    const dues=state.debts.filter(d=>d.balance>0&&d.dueDate===iso);
    const creditDues=(state.creditAccounts||[]).filter(c=>c.balance>0&&c.dueAmount>0&&c.dueDate===iso);
    const tx=state.transactions.filter(t=>t.date===iso);
    const events=[...dues.map(d=>({label:d.name,cls:''})),...creditDues.map(c=>({label:`${c.name} credit`,cls:''})),...tx.slice(0,2).map(t=>({label:t.category,cls:'tx'}))];
    const visible=events.slice(0,3), extra=Math.max(0,events.length-visible.length);
    html.push(`<button class="calendar-day ${inMonth?'':'outside'} ${iso===todayISO()?'today':''} ${iso===selectedCalendarDate?'selected':''}" type="button" data-date="${iso}"><span class="calendar-number">${date.getDate()}</span><span class="calendar-events">${visible.map(e=>`<span class="calendar-event ${e.cls}">${escapeHtml(e.label)}</span>`).join('')}${extra?`<span class="calendar-more">+${extra} more</span>`:''}</span></button>`);
  }
  grid.innerHTML=html.join('');
  grid.querySelectorAll('.calendar-day').forEach(btn=>btn.addEventListener('click',()=>{selectedCalendarDate=btn.dataset.date;const selected=parseISO(selectedCalendarDate);if(selected.getMonth()!==calendarCursor.getMonth()||selected.getFullYear()!==calendarCursor.getFullYear())calendarCursor=startOfMonth(selected);renderCalendar();}));
  renderSelectedDate();
}

function renderSelectedDate() {
  text('selectedDateTitle', formatDate(selectedCalendarDate,{weekday:'long',month:'long',day:'numeric',year:'numeric'}));
  const dues=state.debts.filter(d=>d.balance>0&&d.dueDate===selectedCalendarDate);
  const creditDues=(state.creditAccounts||[]).filter(c=>c.balance>0&&c.dueAmount>0&&c.dueDate===selectedCalendarDate);
  const tx=state.transactions.filter(t=>t.date===selectedCalendarDate);
  const el=document.getElementById('selectedDateItems'); if(!el)return;
  const pieces=[];
  dues.forEach(d=>pieces.push(`<div class="list-item"><div class="item-left"><div class="item-title">Debt due: ${escapeHtml(d.name)}</div><div class="item-sub">Balance ${peso(d.balance)}</div></div><div class="item-amount amount-out">${peso(Math.min(d.dueAmount,d.balance))}</div></div>`));
  creditDues.forEach(c=>pieces.push(`<div class="list-item"><div class="item-left"><div class="item-title">Credit due: ${escapeHtml(c.name)}</div><div class="item-sub">${escapeHtml(c.provider)} • Outstanding ${peso(c.balance)}</div></div><div class="item-amount amount-out">${peso(Math.min(c.dueAmount,c.balance))}</div></div>`));
  tx.forEach(t=>pieces.push(transactionRow(t,false)));
  el.innerHTML=pieces.length?pieces.join(''):emptyHtml('No dues or transactions on this date.');
}

function chartTextColor() { return currentTheme() === 'dark' ? '#d8c9bc' : '#4b4037'; }
function chartMutedColor() { return currentTheme() === 'dark' ? '#a99a8d' : '#8b7c70'; }
function chartGridColor() { return currentTheme() === 'dark' ? '#463b33' : '#c9bdad'; }
function chartBarColor() { return currentTheme() === 'dark' ? '#d1b49b' : '#4b382b'; }

function renderCharts() {
  const reportsPage=document.getElementById('reports'); if(!reportsPage||!reportsPage.classList.contains('active'))return;
  const incomeGroups=aggregate(state.transactions.filter(t=>t.type==='income'),t=>t.category,t=>t.amount);
  drawDonutChart('incomeChart',incomeGroups,'incomeLegend');
  const bills=sum(state.transactions.filter(t=>['expense','credit-purchase'].includes(t.type)&&t.category==='Bills').map(t=>t.amount));
  const expenses=sum(state.transactions.filter(t=>['expense','credit-purchase'].includes(t.type)&&t.category!=='Bills').map(t=>t.amount));
  const payments=sum(state.transactions.filter(t=>['debt-payment','credit-payment'].includes(t.type)).map(t=>t.amount));
  drawAllocationPie('allocationChart',{Expenses:expenses,Bills:bills,Payments:payments});
  const spending=aggregate(state.transactions.filter(t=>['expense','credit-purchase'].includes(t.type)),t=>t.category,t=>t.amount);
  drawBarChart('spendingChart',spending);
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

  ctx.fillStyle = chartTextColor();
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

    ctx.strokeStyle = chartMutedColor();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x3, y2);
    ctx.stroke();

    ctx.fillStyle = chartTextColor();
    ctx.font = '11px Georgia';
    ctx.textAlign = right ? 'left' : 'right';
    ctx.fillText(name, x3 + (right ? 5 : -5), y2 - 2);
    ctx.fillStyle = chartMutedColor();
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

  ctx.strokeStyle = chartGridColor();
  ctx.fillStyle = chartMutedColor();
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

  ctx.strokeStyle = chartTextColor();
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

    ctx.fillStyle = chartBarColor();
    roundRect(ctx, x, y, barW, h, 2);
    ctx.fill();

    ctx.save();
    ctx.translate(x + barW / 2, top + plotH + 10);
    ctx.rotate(-Math.PI / 3.3);
    ctx.fillStyle = chartTextColor();
    ctx.font = '10px Georgia';
    ctx.textAlign = 'right';
    ctx.fillText(truncate(name, 15), 0, 0);
    ctx.restore();
  });
}

function drawEmptyChart(ctx, width, height, message) {
  ctx.fillStyle = chartMutedColor();
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
  await new Promise((resolve,reject)=>{
    const tx=db.transaction(DEBT_STORE,'readwrite'); const store=tx.objectStore(DEBT_STORE); store.clear();
    state.debts.forEach(debt=>store.put(debt));
    (state.creditAccounts||[]).filter(c=>c.balance>0&&c.dueAmount>0).forEach(c=>store.put({
      id:`credit-${c.id}`, name:`${c.name} (${c.provider})`, balance:c.balance, dueAmount:c.dueAmount,
      dueDate:c.dueDate, reminderDays:c.reminderDays
    }));
    tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
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
    updateInstallMenuStatus();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateInstallMenuStatus();
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


/* ---------------- V6 install, theme and data export ---------------- */

function isStandaloneApp() {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
}

function updateInstallMenuStatus() {
  const status = document.getElementById('menuInstallStatus');
  if (!status) return;
  if (isStandaloneApp()) status.textContent = 'Already installed on this device';
  else if (deferredInstallPrompt) status.textContent = 'Ready to install — tap here';
  else status.textContent = 'Install Pera Tracker on this device';
}

async function installPeraTracker() {
  setMenuOpen(false);
  if (isStandaloneApp()) {
    showToast('Pera Tracker is already installed on this device.');
    return;
  }
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    updateInstallMenuStatus();
    return;
  }
  showToast('If no install prompt appears, use your browser menu → Install app / Add to Home screen.', 4300);
}

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function applyTheme(theme, persist = true) {
  const normalized = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = normalized;
  if (persist) localStorage.setItem(THEME_KEY, normalized);
  const status = document.getElementById('menuThemeStatus');
  const icon = document.getElementById('menuThemeIcon');
  if (status) status.textContent = normalized === 'dark' ? 'Currently on — tap for light mode' : 'Currently off — tap for dark mode';
  if (icon) icon.textContent = normalized === 'dark' ? '☾' : '◐';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', normalized === 'dark' ? '#181512' : '#1f1a17');
  requestAnimationFrame(() => renderCharts());
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  applyTheme(saved === 'dark' ? 'dark' : 'light', false);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
  setMenuOpen(false);
  showToast(next === 'dark' ? 'Dark mode enabled.' : 'Light mode enabled.');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1200);
}

function safeExportText(value) {
  const s = String(value ?? '');
  // Prevent spreadsheet formula injection when user-entered notes begin with a formula character.
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function csvCell(value) {
  const s = safeExportText(value).replace(/"/g, '""');
  return `"${s}"`;
}

function buildUnifiedExportRows() {
  const rows=[['Record Type','Date','Type / Status','Name / Category','Amount','Original / Limit','Current Balance','Amount Due','Due Date','Reminder Days','Notes','Linked Debt/Credit ID']];
  state.transactions.forEach(t=>rows.push(['Transaction',t.date||'',t.type||'',t.category||'',Number(t.amount||0),'','','','','',t.notes||'',t.creditId||t.debtId||'']));
  state.debts.forEach(d=>rows.push(['Debt','',d.balance>0?debtStatus(d).text:'PAID',d.name||'','',Number(d.original||0),Number(d.balance||0),Number(d.dueAmount||0),d.dueDate||'',Number(d.reminderDays||0),'',d.id||'']));
  (state.creditAccounts||[]).forEach(c=>rows.push(['Credit','',creditStatus(c).text,`${c.name} (${c.provider})`,'',Number(c.limit||0),Number(c.balance||0),Number(c.dueAmount||0),c.dueDate||'',Number(c.reminderDays||0),'',c.id||'']));
  return rows;
}

function exportCsv() {
  setMenuOpen(false);
  const rows = buildUnifiedExportRows();
  const csv = '\ufeff' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `pera_tracker_${todayISO()}.csv`);
  showToast('CSV export downloaded.');
}

function excelEscape(value) {
  return escapeHtml(safeExportText(value)).replace(/\n/g, '<br>');
}

function exportExcel() {
  setMenuOpen(false);
  const totalIncome=sum(state.transactions.filter(t=>t.type==='income').map(t=>t.amount));
  const actualExpenses=sum(state.transactions.filter(t=>['expense','credit-purchase'].includes(t.type)).map(t=>t.amount));
  const payments=sum(state.transactions.filter(t=>['debt-payment','credit-payment'].includes(t.type)).map(t=>t.amount));
  const totalDebt=sum(state.debts.filter(d=>d.balance>0).map(d=>d.balance))+sum((state.creditAccounts||[]).filter(c=>c.balance>0).map(c=>c.balance));
  const txRows=state.transactions.map(t=>`<tr><td>${excelEscape(t.date)}</td><td>${excelEscape(t.type)}</td><td>${excelEscape(t.category)}</td><td class="num">${Number(t.amount||0).toFixed(2)}</td><td>${excelEscape(t.notes)}</td><td>${excelEscape(t.creditId||t.debtId||'')}</td></tr>`).join('');
  const debtRows=state.debts.map(d=>`<tr><td>${excelEscape(d.name)}</td><td class="num">${Number(d.original||0).toFixed(2)}</td><td class="num">${Number(d.balance||0).toFixed(2)}</td><td class="num">${Number(d.dueAmount||0).toFixed(2)}</td><td>${excelEscape(d.dueDate)}</td><td>${excelEscape(debtStatus(d).text)}</td></tr>`).join('');
  const creditRows=(state.creditAccounts||[]).map(c=>`<tr><td>${excelEscape(c.provider)}</td><td>${excelEscape(c.name)}</td><td class="num">${Number(c.limit||0).toFixed(2)}</td><td class="num">${Number(c.balance||0).toFixed(2)}</td><td class="num">${Number(c.dueAmount||0).toFixed(2)}</td><td>${excelEscape(c.dueDate)}</td><td>${excelEscape(creditStatus(c).text)}</td></tr>`).join('');
  const html=`<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;margin:0 0 22px}th,td{border:1px solid #bbb;padding:6px 9px}th{background:#eee}.num{text-align:right}h2{margin-top:24px}</style></head><body><h1>Pera Tracker Export</h1><p>Exported: ${excelEscape(new Date().toLocaleString('en-PH'))}</p><h2>Summary</h2><table><tr><th>Total Income</th><th>Actual Expenses</th><th>Debt/Credit Payments</th><th>Total Outstanding</th></tr><tr><td class="num">${totalIncome.toFixed(2)}</td><td class="num">${actualExpenses.toFixed(2)}</td><td class="num">${payments.toFixed(2)}</td><td class="num">${totalDebt.toFixed(2)}</td></tr></table><h2>Transactions</h2><table><tr><th>Date</th><th>Type</th><th>Category</th><th>Amount</th><th>Notes</th><th>Linked ID</th></tr>${txRows||'<tr><td colspan="6">No transactions</td></tr>'}</table><h2>Debts</h2><table><tr><th>Name</th><th>Original</th><th>Balance</th><th>Amount Due</th><th>Due Date</th><th>Status</th></tr>${debtRows||'<tr><td colspan="6">No debts</td></tr>'}</table><h2>Credit Accounts</h2><table><tr><th>Provider</th><th>Name</th><th>Limit</th><th>Outstanding</th><th>Amount Due</th><th>Due Date</th><th>Status</th></tr>${creditRows||'<tr><td colspan="7">No credit accounts</td></tr>'}</table></body></html>`;
  downloadBlob(new Blob(['\ufeff',html],{type:'application/vnd.ms-excel;charset=utf-8'}),`pera_tracker_${todayISO()}.xls`);
  showToast('Excel export downloaded.');
}

/* ---------------- V4 Photo -> Text OCR ---------------- */

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

  setPhotoOcrProgress(3, 'Image loaded', 'Preparing receipt and screenshot scan modes…');

  try {
    const TesseractLib = await ensureTesseractLoaded();
    setPhotoOcrProgress(7, 'OCR engine ready', 'Optimizing text for receipts and digital screenshots…');

    const variants = await preprocessPhotoVariantsV6(file);
    setPhotoOcrProgress(14, 'Image optimized', 'Pass 1 of 3: reading screenshot / UI text…');

    let ocrPhase = 1;
    const worker = await TesseractLib.createWorker('eng', 1, {
      logger: message => {
        if (!message || typeof message.progress !== 'number') return;
        const phase = Number(ocrPhase || 1);
        const ranges = {
          1: [14, 38],
          2: [40, 67],
          3: [69, 92]
        };
        const [startPct, endPct] = ranges[phase] || ranges[1];
        const mapped = startPct + message.progress * (endPct - startPct);
        const status = message.status ? titleCaseWords(message.status) : 'Reading image';
        const labels = { 1: 'screenshot text', 2: 'receipt text', 3: 'faint / sparse text' };
        setPhotoOcrProgress(mapped, status, `Smart scan • pass ${phase} of 3 • ${labels[phase]}`);
      }
    });

    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '11'
    });
    ocrPhase = 1;
    const screenResult = await worker.recognize(variants.screen, { rotateAuto: true });

    setPhotoOcrProgress(40, 'Screenshot pass complete', 'Pass 2 of 3: checking structured receipt lines…');
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '6'
    });
    ocrPhase = 2;
    const receiptResult = await worker.recognize(variants.enhanced, { rotateAuto: true });

    setPhotoOcrProgress(69, 'Receipt pass complete', 'Pass 3 of 3: recovering faint totals and separated labels…');
    await worker.setParameters({
      preserve_interword_spaces: '1',
      user_defined_dpi: '300',
      tessedit_pageseg_mode: '11'
    });
    ocrPhase = 3;
    const sparseResult = await worker.recognize(variants.binary, { rotateAuto: true });
    await worker.terminate();

    setPhotoOcrProgress(94, 'Combining scan results', 'Keeping the strongest receipt and transaction lines…');

    const candidates = [screenResult, receiptResult, sparseResult].map((result, index) => {
      const rawText = result?.data?.text || '';
      const cleanedText = cleanOcrText(rawText);
      const confidence = Number(result?.data?.confidence || 0);
      return {
        pass: index + 1,
        rawText,
        cleanedText,
        confidence,
        score: scorePhotoOcrCandidate(cleanedText, confidence)
      };
    }).sort((a, b) => b.score - a.score);

    const best = candidates[0];
    const displayText = mergeImportantPhotoLines(
      best.cleanedText,
      candidates.slice(1).map(c => c.cleanedText).join('\n')
    );
    const parsingText = candidates.map(c => c.cleanedText).filter(Boolean).join('\n');

    if (output) output.value = displayText || '[No readable text detected]';

    const parsed = parsePhotoDocument(parsingText);
    photoScanData = {
      rawText: best.rawText,
      cleanedText: displayText,
      allOcrText: parsingText,
      confidence: best.confidence,
      ...parsed
    };
    renderPhotoSummary(parsed);

    const quality = best.confidence >= 75 ? 'High' : best.confidence >= 50 ? 'Moderate' : 'Low';
    setPhotoOcrProgress(
      100,
      displayText ? 'Smart scan complete' : 'No readable text found',
      displayText
        ? `${quality} OCR confidence. ${parsed.kind === 'transaction' ? 'Transaction screenshot mode detected.' : parsed.kind === 'receipt' ? 'Receipt mode detected.' : 'Review the editable notepad.'}`
        : 'Try the original screenshot or take a closer, sharper photo with less glare.'
    );
    if (displayText) showToast('Smart photo scan complete.', 2800);
  } catch (err) {
    console.error('Photo OCR failed:', err);
    if (output) output.value = 'OCR could not read this image. Please try the original screenshot or a clearer photo.';
    setPhotoOcrProgress(0, 'OCR failed', 'Internet is needed the first time the OCR engine loads. For screenshots, upload the original image instead of a compressed copy.');
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


/** V6 adds a screenshot-oriented grayscale variant while reusing V5 receipt enhancement. */
async function preprocessPhotoVariantsV6(file) {
  const receipt = await preprocessPhotoVariants(file);
  const screen = await buildScreenshotOcrCanvas(file);
  return { ...receipt, screen };
}

function buildScreenshotOcrCanvas(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const sourceW = Math.max(1, img.naturalWidth || img.width);
        const sourceH = Math.max(1, img.naturalHeight || img.height);
        const sourceLong = Math.max(sourceW, sourceH);
        let targetLong = sourceLong < 1800 ? 2200 : Math.min(sourceLong, 3000);
        let scale = Math.min(4.5, targetLong / sourceLong);
        const maxPixels = 6_000_000;
        if (sourceW * sourceH * scale * scale > maxPixels) {
          scale = Math.sqrt(maxPixels / (sourceW * sourceH));
        }
        const width = Math.max(1, Math.round(sourceW * scale));
        const height = Math.max(1, Math.round(sourceH * scale));
        const base = document.createElement('canvas');
        base.width = width; base.height = height;
        const ctx = base.getContext('2d', { willReadFrequently: true });
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);

        const data = ctx.getImageData(0, 0, width, height);
        const px = data.data;
        const count = width * height;
        const gray = new Uint8ClampedArray(count);
        const histogram = new Uint32Array(256);
        let totalLum = 0;
        for (let p = 0, i = 0; p < count; p++, i += 4) {
          const g = Math.round(0.299 * px[i] + 0.587 * px[i+1] + 0.114 * px[i+2]);
          gray[p] = g; histogram[g]++; totalLum += g;
        }
        const mean = totalLum / count;
        const low = histogramPercentile(histogram, count, 0.015);
        const high = histogramPercentile(histogram, count, 0.99);
        const range = Math.max(35, high - low);
        const invert = mean < 118; // common for dark-mode banking / e-wallet screenshots

        const out = ctx.createImageData(width, height);
        for (let p = 0, i = 0; p < count; p++, i += 4) {
          let v = Math.max(0, Math.min(255, (gray[p] - low) * 255 / range));
          if (invert) v = 255 - v;
          // Mild contrast only; UI screenshots have anti-aliased fonts that binary thresholding can destroy.
          v = Math.max(0, Math.min(255, (v - 128) * 1.12 + 128));
          out.data[i] = out.data[i+1] = out.data[i+2] = Math.round(v);
          out.data[i+3] = 255;
        }
        ctx.putImageData(out, 0, 0);
        URL.revokeObjectURL(url);
        resolve(base);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image could not be opened')); };
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


function scorePhotoOcrCandidate(textValue, confidence) {
  const textValueSafe = String(textValue || '');
  if (!textValueSafe) return 0;
  const chars = (textValueSafe.match(/[A-Za-z0-9]/g) || []).length;
  const lines = textValueSafe.split('\n').filter(Boolean).length;
  const financeWords = (textValueSafe.match(/\b(total|subtotal|amount|due|cash|change|vat|receipt|invoice|paid|payment|sent|received|transaction|reference|ref|merchant|recipient|balance|gcash|maya|bank|transfer|successful|completed)\b/gi) || []).length;
  const moneyValues = findFlexibleMoneyAmounts(textValueSafe, false).length;
  return Number(confidence || 0) * 1.25 + Math.min(chars, 1200) / 7 + Math.min(lines, 70) * 1.7 + financeWords * 8 + moneyValues * 5;
}

function mergeImportantPhotoLines(primaryText, secondaryText) {
  const primary = cleanOcrText(primaryText);
  const secondary = cleanOcrText(secondaryText);
  if (!primary) return secondary;
  if (!secondary) return primary;
  const primaryLines = primary.split('\n');
  const normalized = new Set(primaryLines.map(normalizeComparableOcrLine).filter(Boolean));
  const important = /(grand\s*total|total\s*due|amount\s*due|transaction\s*amount|amount\s*(sent|paid)|you\s*(paid|sent)|\btotal\b|subtotal|cash\b|change\b|vat\b|discount|paid\s*to|sent\s*to|recipient|merchant|reference|ref\.?\s*(no|#)?|transaction\s*(id|no)|successful|completed|\b20\d{2}[-/.]|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i;
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

function findFlexibleMoneyAmounts(textValue, allowPlainIntegers = false) {
  const textValueSafe = normalizeReceiptAmountText(textValue);
  const values = [];
  const currency = /(?:₱|\bPHP\b|P(?=\s*\d))\s*((?:\d{1,3}(?:,\d{3})+)|\d+)(?:\.(\d{1,2}))?/gi;
  let m;
  while ((m = currency.exec(textValueSafe)) !== null) {
    const decimals = (m[2] || '00').padEnd(2,'0').slice(0,2);
    const value = Number(`${m[1].replace(/,/g,'')}.${decimals}`);
    if (Number.isFinite(value) && value > 0 && value < 100000000) values.push(value);
  }
  const decimal = /\b((?:\d{1,3}(?:,\d{3})+)|\d+)\.(\d{2})\b/g;
  while ((m = decimal.exec(textValueSafe)) !== null) {
    const value = Number(`${m[1].replace(/,/g,'')}.${m[2]}`);
    if (Number.isFinite(value) && value > 0 && value < 100000000) values.push(value);
  }
  if (allowPlainIntegers) {
    const ints = textValueSafe.match(/\b(?:\d{1,3}(?:,\d{3})+|\d{1,7})\b/g) || [];
    ints.forEach(raw => {
      const value = Number(raw.replace(/,/g,''));
      if (Number.isFinite(value) && value > 0 && value < 100000000) values.push(value);
    });
  }
  return [...new Set(values)];
}

function detectTransactionAmount(lines) {
  const candidates = [];
  const positive = [
    [/amount\s*(sent|paid|received)|transaction\s*amount|payment\s*amount|total\s*amount|amount\s*paid|amount\s*due|you\s*(paid|sent)|paid\s*amount/i, 45],
    [/\bamount\b/i, 28],
    [/\bpaid\b|\bsent\b|\breceived\b|\bpayment\b|\bpurchase\b/i, 18],
    [/\btotal\b/i, 15]
  ];
  const negative = [
    [/available\s*balance|current\s*balance|remaining\s*balance|wallet\s*balance|\bbalance\b/i, -42],
    [/service\s*fee|convenience\s*fee|transaction\s*fee|\bfee\b/i, -28],
    [/cashback|points|reward/i, -25],
    [/reference|ref\.?\s*(no|#)?|account\s*(no|number)|mobile\s*(no|number)/i, -45]
  ];

  lines.forEach((raw, i) => {
    const line = normalizeReceiptAmountText(raw);
    const prev = i > 0 ? normalizeReceiptAmountText(lines[i-1]) : '';
    const context = `${prev} ${line}`;
    let weight = 0;
    positive.forEach(([re, score]) => { if (re.test(context)) weight += score; });
    negative.forEach(([re, score]) => { if (re.test(context)) weight += score; });
    const allowInteger = weight >= 25;
    const vals = findFlexibleMoneyAmounts(line, allowInteger);
    vals.forEach(v => candidates.push({ value: v, weight, index: i }));
  });
  if (!candidates.length) return 0;
  candidates.sort((a,b) => b.weight - a.weight || b.index - a.index || b.value - a.value);
  const best = candidates[0];
  if (best.weight > 0) return best.value;
  const currencyLike = candidates.filter(c => c.value >= 1).sort((a,b) => b.value-a.value);
  return currencyLike[0]?.value || 0;
}

function detectTransactionReference(lines) {
  const joined = lines.join('\n');
  const patterns = [
    /(?:reference|ref\.?)(?:\s*(?:no\.?|number|#))?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
    /transaction\s*(?:id|no\.?|number|#)\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})/i,
    /(?:confirmation|trace)\s*(?:id|no\.?|number|#)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9-]{4,})/i
  ];
  for (const re of patterns) {
    const m = joined.match(re);
    if (m) return m[1];
  }
  return '';
}

function detectTransactionParty(lines, fullText = '') {
  const label = /^(?:paid\s*to|sent\s*to|recipient|merchant|biller|payee|transferred\s*to|to)\s*[:\-]?\s*(.*)$/i;
  for (let i=0;i<lines.length;i++) {
    const line = lines[i].trim();
    const m = line.match(label);
    if (!m) continue;
    let value = (m[1] || '').trim();
    if (!value && lines[i+1]) value = lines[i+1].trim();
    if (value && value.length >= 2 && value.length <= 70 && !/^(amount|date|reference|ref|transaction|successful|completed)$/i.test(value)) return value;
  }
  const textLow = String(fullText || '').toLowerCase();
  if (/\bgcash\b/.test(textLow)) return 'GCash';
  if (/\bmaya\b|paymaya/.test(textLow)) return 'Maya';
  if (/\bunionbank\b/.test(textLow)) return 'UnionBank';
  if (/\bmetrobank\b/.test(textLow)) return 'Metrobank';
  if (/\bbpi\b/.test(textLow)) return 'BPI';
  if (/\bbdo\b/.test(textLow)) return 'BDO';
  return detectPhotoMerchant(lines, fullText);
}

function detectPhotoDateV6(lines) {
  const numeric = detectPhotoDate(lines);
  if (numeric) return numeric;
  const monthMap = {jan:1,january:1,feb:2,february:2,mar:3,march:3,apr:4,april:4,may:5,jun:6,june:6,jul:7,july:7,aug:8,august:8,sep:9,sept:9,september:9,oct:10,october:10,nov:11,november:11,dec:12,december:12};
  for (const raw of lines) {
    const line = String(raw || '').replace(/,/g,' ').replace(/\s+/g,' ').trim();
    let m = line.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})\s+(20\d{2})\b/i);
    if (m) return normalizeYMD(Number(m[3]), monthMap[m[1].toLowerCase()], Number(m[2]));
    m = line.match(/\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b/i);
    if (m) return normalizeYMD(Number(m[3]), monthMap[m[2].toLowerCase()], Number(m[1]));
  }
  return '';
}

function detectPhotoDescription(lines, kind, merchant = '') {
  const normalized=lines.map(v=>String(v||'').trim()).filter(Boolean);
  const labeled=/^(?:description|details|purpose|remarks?|note|message|item|purchase)\s*[:\-]?\s*(.*)$/i;
  for(let i=0;i<normalized.length;i++){
    const m=normalized[i].match(labeled);
    if(m){ const value=(m[1]||normalized[i+1]||'').trim(); if(value && value.length>2 && value.length<140) return value; }
  }
  if(kind==='receipt'){
    const ignore=/(subtotal|total|cash|change|vat|sales|discount|amount|due|invoice|receipt|cashier|date|time|tin|qty|item\(s\)|senior|reference|ref\b)/i;
    const items=[];
    for(const line of normalized){
      if(ignore.test(line)) continue;
      const amounts=findReceiptAmounts(line);
      if(!amounts.length) continue;
      let name=normalizeReceiptAmountText(line).replace(/(?:\bP\s*)?(?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2}\b.*$/i,'').replace(/^\s*\d+\s+/,'').trim();
      if(name && name.length>=2 && !/^[-\d\s.,]+$/.test(name) && name.toLowerCase()!==String(merchant).toLowerCase()) items.push(name);
      if(items.length>=4) break;
    }
    if(items.length) return items.join(', ');
  }
  if(kind==='transaction'){
    const labelsToSkip=/(transaction|successful|completed|reference|ref\b|amount|date|time|balance|fee|account|mobile|gcash|maya|unionbank|metrobank|bpi|bdo)/i;
    const candidates=normalized.filter(v=>v.length>=3&&v.length<=100&&!labelsToSkip.test(v)&&!findFlexibleMoneyAmounts(v,true).length);
    const merchantLow=String(merchant||'').toLowerCase();
    const useful=candidates.find(v=>v.toLowerCase()!==merchantLow);
    if(useful) return useful;
    if(merchant) return `Transaction with ${merchant}`;
  }
  return merchant ? `Purchase from ${merchant}` : 'Scanned transaction';
}

function parsePhotoDocument(textValue) {
  const textValueSafe=String(textValue||'');
  const lines=textValueSafe.split('\n').map(v=>v.trim()).filter(Boolean);
  if(!lines.length)return {kind:'document',isReceipt:false,isFinancial:false,merchant:'',date:'',total:0,reference:'',category:'Other',description:''};
  const receiptSignals=/(subtotal|total\s*due|cashier|vatable|vat[- ]?exempt|cash\b|change\b|qty\b|item\(s\)|sales\s*invoice|official\s*receipt)/i.test(textValueSafe);
  const transactionSignals=/(transaction\s*(successful|complete|details|id|no)|payment\s*(successful|complete|details)|amount\s*(sent|paid|received)|paid\s*to|sent\s*to|recipient|transfer\s*(successful|complete)|reference\s*(no|number|#)|gcash|maya|paymaya|bank\s*transfer|card\s*ending|purchase\s*successful)/i.test(textValueSafe);
  let kind=transactionSignals&&!receiptSignals?'transaction':receiptSignals?'receipt':'document';
  const receiptTotal=detectPhotoTotal(lines), transactionAmount=detectTransactionAmount(lines);
  const total=kind==='transaction'?(transactionAmount||receiptTotal):(receiptTotal||transactionAmount);
  const date=detectPhotoDateV6(lines);
  const merchant=kind==='transaction'?detectTransactionParty(lines,textValueSafe):detectPhotoMerchant(lines,textValueSafe);
  const reference=detectTransactionReference(lines);
  const category=guessPhotoCategory(textValueSafe);
  const description=detectPhotoDescription(lines,kind,merchant);
  const isFinancial=Boolean(total||receiptSignals||transactionSignals);
  if(kind==='document'&&transactionSignals)kind='transaction';
  return {kind,isReceipt:kind==='receipt',isFinancial,merchant,date,total,reference,category,description};
}

function renderPhotoSummary(parsed) {
  const summary=document.getElementById('receiptSummary'); if(!summary)return;
  if(!parsed||!parsed.isFinancial){summary.hidden=true;return;}
  summary.hidden=false;
  text('photoSummaryTitle',parsed.kind==='transaction'?'Transaction screenshot detected':parsed.kind==='receipt'?'Receipt details detected':'Possible expense detected');
  text('photoMerchant',parsed.merchant||'Not detected');
  text('photoDate',parsed.date?formatDate(parsed.date):'Not detected');
  text('photoTotal',parsed.total?peso(parsed.total):'Not detected');
  text('photoReference',parsed.reference||'Not detected');
  text('photoCategory',parsed.category||'Other');
  text('photoDescription',parsed.description||'Not detected');
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
  if(!photoScanData||!photoScanData.total){showToast('No total amount was detected. You can edit the scanned text and try a clearer image.');return;}
  showPage('tracker');
  document.getElementById('txType').value='expense'; updateTransactionCategories();
  document.getElementById('txAmount').value=photoScanData.total;
  document.getElementById('txCategory').value=EXPENSE_CATEGORIES.includes(photoScanData.category)?photoScanData.category:'Other';
  document.getElementById('txDate').value=photoScanData.date||todayISO();
  document.getElementById('txNotes').value=[photoScanData.merchant,photoScanData.description,photoScanData.reference?`Ref ${photoScanData.reference}`:''].filter(Boolean).join(' — ');
  showToast('Merchant, amount, date and description copied to Daily Expense. Review then Save Transaction.',4200);
}

/* ---------------- Events ---------------- */

/* ---------------- Events ---------------- */

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('txDate').value = todayISO();
  document.getElementById('creditActivityDate').value = todayISO();
  updateTransactionCategories();
  updateCreditActivityForm();

  document.getElementById('txType').addEventListener('change', updateTransactionCategories);
  document.getElementById('creditActivityType').addEventListener('change', updateCreditActivityForm);
  document.getElementById('saveCreditActivityBtn').addEventListener('click', saveCreditActivity);

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
  document.getElementById('menuInstallBtn').addEventListener('click', installPeraTracker);
  document.getElementById('menuThemeBtn').addEventListener('click', toggleTheme);
  document.getElementById('menuExportCsvBtn').addEventListener('click', exportCsv);
  document.getElementById('menuExportExcelBtn').addEventListener('click', exportExcel);
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


  window.addEventListener('resize', debounce(() => renderCharts(), 180));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestDueCheck();
  });

  initTheme();
  initPWA();
  updateInstallMenuStatus();
  renderAll();
});

function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

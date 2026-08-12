
'use strict';

const CACHE_NAME = 'pera-tracker-v2.1';
const DB_NAME = 'peraTrackerDB';
const DB_VERSION = 1;
const DEBT_STORE = 'debts';
const NOTICE_STORE = 'notificationLog';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put('./index.html', copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'CHECK_DUES') {
    event.waitUntil(checkDueReminders());
  }
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-due-reminders') {
    event.waitUntil(checkDueReminders());
  }
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DEBT_STORE)) db.createObjectStore(DEBT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(NOTICE_STORE)) db.createObjectStore(NOTICE_STORE, { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getAllDebts(db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DEBT_STORE, 'readonly');
    const req = tx.objectStore(DEBT_STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function hasNotice(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTICE_STORE, 'readonly');
    const req = tx.objectStore(NOTICE_STORE).get(key);
    req.onsuccess = () => resolve(Boolean(req.result));
    req.onerror = () => reject(req.error);
  });
}

function saveNotice(db, key) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(NOTICE_STORE, 'readwrite');
    tx.objectStore(NOTICE_STORE).put({ key, createdAt: Date.now() });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function localISO(date = new Date()) {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function parseISO(value) {
  return new Date(`${value}T00:00:00`);
}

function diffDays(targetISO, currentISO) {
  return Math.round((parseISO(targetISO) - parseISO(currentISO)) / 86400000);
}

function money(value) {
  return new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 2
  }).format(Number(value || 0));
}

async function checkDueReminders() {
  if (Notification.permission !== 'granted') return;

  let db;
  try {
    db = await openDB();
    const debts = await getAllDebts(db);
    const today = localISO();

    for (const debt of debts) {
      if (!debt || Number(debt.balance) <= 0 || !debt.dueDate) continue;

      const days = diffDays(debt.dueDate, today);
      const reminderDays = Number(debt.reminderDays || 0);
      let kind = null;
      let title = '';
      let body = '';

      if (days === 0) {
        kind = 'due';
        title = `${debt.name} is due today`;
        body = `Amount due: ${money(Math.min(Number(debt.dueAmount || 0), Number(debt.balance || 0)))}.`;
      } else if (days > 0 && days === reminderDays && reminderDays > 0) {
        kind = 'reminder';
        title = `${debt.name} due in ${days} day${days === 1 ? '' : 's'}`;
        body = `Amount due: ${money(Math.min(Number(debt.dueAmount || 0), Number(debt.balance || 0)))} on ${debt.dueDate}.`;
      } else if (days === -1) {
        kind = 'overdue';
        title = `${debt.name} is overdue`;
        body = `Due date was ${debt.dueDate}. Remaining balance: ${money(Number(debt.balance || 0))}.`;
      }

      if (!kind) continue;

      const key = `${debt.id}|${today}|${kind}`;
      if (await hasNotice(db, key)) continue;

      await self.registration.showNotification(title, {
        body,
        icon: './icons/icon-192.png',
        badge: './icons/icon-192.png',
        tag: `debt-${debt.id}-${kind}-${today}`,
        renotify: false,
        data: { debtId: debt.id, dueDate: debt.dueDate, kind }
      });

      await saveNotice(db, key);
    }
  } catch (err) {
    console.error('Due reminder check failed:', err);
  } finally {
    if (db) db.close();
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';

const BASE = 'https://kolan.kendineiyibak.app/api/proxy';
const FACILITY_ID = '3a07267e-766b-39cc-e33f-003cc1a50381'; // Kolan Şişli
const DEPARTMENT_ID = '1078'; // Endokrinoloji
const PHYSICIAN_ID = '6182'; // Doç. Dr. Ramazan Çakmak
const APPOINTMENT_TYPE = '1'; // Clinic
const RANGE_DAYS = 31;
const FAILURE_ALERT_THRESHOLD = 4; // ~1 saat
const HEARTBEAT_DAYS = 7;
const STATE_URL = new URL('../state.json', import.meta.url);

const BOOKING_URL =
  `https://kolan.kendineiyibak.app/randevu?type=clinic&facilityId=${FACILITY_ID}` +
  `&departmentId=${DEPARTMENT_ID}&physicianId=${PHYSICIAN_ID}`;

const args = new Set(process.argv.slice(2));
const TEST = args.has('--test');
const MOCK = args.has('--mock-available');

const log = (...a) => console.log(new Date().toISOString(), ...a);

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

async function api(path, query) {
  const url = `${BASE}${path}?${new URLSearchParams(query)}`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'accept-language': 'tr', accept: 'application/json' },
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw lastErr;
}

function slotKeys(data) {
  return (data?.events ?? [])
    .filter((e) => e.isAvailable === true)
    .map((e) => `${String(e.day).slice(0, 10)} ${String(e.from).slice(0, 5)}`);
}

async function fetchAvailableSlots() {
  const base = {
    facilityId: FACILITY_ID,
    appointmentType: APPOINTMENT_TYPE,
    departmentId: DEPARTMENT_ID,
    physicianId: PHYSICIAN_ID,
  };
  const from = new Date();
  const to = new Date(from.getTime() + RANGE_DAYS * 86400000);

  const range = await api('/appointment-service/calendars/physician-slots', {
    ...base,
    from: isoDate(from),
    to: isoDate(to),
  });
  const totalSlots = range?.events?.length ?? 0;
  const keys = new Set(slotKeys(range));

  // Çapraz kontrol: en yakın boş slot uç noktası. Başarısız olursa ana sonucu bozmasın.
  try {
    const closest = await api('/appointment-service/calendars/closest-available-slots', base);
    slotKeys(closest).forEach((k) => keys.add(k));
  } catch (err) {
    log('closest-available-slots hatası (yoksayıldı):', err.message);
  }

  if (MOCK) keys.add('2099-01-01 10:00');
  return { slots: [...keys].sort(), totalSlots };
}

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_URL, 'utf8'));
  } catch {
    return { notifiedSlots: [], consecutiveFailures: 0, failureNotified: false, lastHeartbeat: null };
  }
}

async function saveState(state) {
  await writeFile(STATE_URL, JSON.stringify(state, null, 2) + '\n');
}

// --- Bildirim ---------------------------------------------------------------

const env = process.env;
const hasMail = env.SMTP_USER && env.SMTP_PASS && env.MAIL_TO;
const hasTelegram = env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID;

async function sendMail(subject, text) {
  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  await transporter.sendMail({ from: env.SMTP_USER, to: env.MAIL_TO, subject, text });
}

async function sendTelegram(text) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text }),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Telegram HTTP ${res.status}`);
}

/** Tüm kanalları dener; en az biri başarılıysa true döner. */
async function notify(subject, text) {
  if (!hasMail && !hasTelegram) {
    log('Bildirim kanalı tanımlı değil, yalnızca loglanıyor:\n' + subject + '\n' + text);
    return true;
  }
  let ok = false;
  const errors = [];
  if (hasMail) {
    try {
      await sendMail(subject, text);
      ok = true;
      log('E-posta gönderildi');
    } catch (err) {
      errors.push(`mail: ${err.message}`);
    }
  }
  if (hasTelegram) {
    try {
      await sendTelegram(`${subject}\n\n${text}`);
      ok = true;
      log('Telegram mesajı gönderildi');
    } catch (err) {
      errors.push(`telegram: ${err.message}`);
    }
  }
  if (errors.length) log('Bildirim hataları:', errors.join(' | '));
  if (!ok) throw new Error('Hiçbir bildirim kanalı başarılı olmadı');
  return ok;
}

// --- Ana akış ---------------------------------------------------------------

async function main() {
  const state = await loadState();
  let result;

  try {
    result = await fetchAvailableSlots();
  } catch (err) {
    state.consecutiveFailures = (state.consecutiveFailures ?? 0) + 1;
    log(`API hatası (${state.consecutiveFailures}. kez):`, err.message);
    if (state.consecutiveFailures >= FAILURE_ALERT_THRESHOLD && !state.failureNotified) {
      await notify(
        '⚠️ Kolan takipçisi çalışmıyor',
        `Randevu API'sine ${state.consecutiveFailures} kez art arda ulaşılamadı.\nSon hata: ${err.message}\n` +
          `Siteyi elle kontrol et: ${BOOKING_URL}`,
      );
      state.failureNotified = true;
    }
    await saveState(state);
    return;
  }

  if (state.failureNotified) {
    await notify('✅ Kolan takipçisi tekrar çalışıyor', 'API erişimi düzeldi, kontroller devam ediyor.');
  }
  state.consecutiveFailures = 0;
  state.failureNotified = false;

  const { slots, totalSlots } = result;
  log(`Toplam slot: ${totalSlots}, boş slot: ${slots.length}`);

  const previous = new Set(state.notifiedSlots ?? []);
  const fresh = slots.filter((s) => !previous.has(s));

  if (fresh.length > 0) {
    const list = slots.map((s) => `• ${s}`).join('\n');
    await notify(
      '🩺 Doç. Dr. Ramazan Çakmak - BOŞ RANDEVU VAR!',
      `Kolan Şişli / Endokrinoloji için ${slots.length} boş slot bulundu:\n\n${list}\n\n` +
        `Hemen al: ${BOOKING_URL}`,
    );
  }
  // Yalnızca bildirim başarılı olduktan sonra state güncellenir; kapanan slotlar listeden düşer.
  state.notifiedSlots = slots;

  if (TEST) {
    await notify(
      '🔔 Kolan takipçisi test bildirimi',
      `Kurulum çalışıyor. Şu an ${slots.length} boş slot var (toplam ${totalSlots} slot tarandı).\n${BOOKING_URL}`,
    );
  }

  const hb = state.lastHeartbeat ? new Date(state.lastHeartbeat).getTime() : 0;
  if (Date.now() - hb > HEARTBEAT_DAYS * 86400000) {
    state.lastHeartbeat = new Date().toISOString();
  }

  await saveState(state);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

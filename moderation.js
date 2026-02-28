// ============================================================
// EL JASUS — MODERATION SYSTEM v3  (complete rewrite)
// Yellow Card / Red Card — Warn → Ban → Full Lockout
// Uses Firebase Realtime Database for ban state and synchronization.
// Features:
//   To scan a chat message before sending:
//     const blocked = await MOD.scan(messageText);
//     if (blocked) return;   // don't send, warning/ban handled internally
//
// ============================================================

(function () {
'use strict';

// ══════════════════════════════════════════════════════════
// BLOCKED WORDS  (Arabic + transliterated Latin)
// Normaliser strips diacritics and unifies alef variants so
// كِلٌبً  ==  كلب,  and  klab  ==  klab, etc.
// ══════════════════════════════════════════════════════════
const BLOCKED = [
    // ── Arabic profanity (Direct & Regional) ──────────────────────────────────
    'كس','كوس','بص','بصص','زبر','أير','اير','زب','لحس',
    'فشخ','فشخك','يفشخ','تفشيخ','طيز','مكوة','خرق','سوءة',
    'نيك','ينيك','انيك','تنيك','مناك','منيوك','تناك',
    'شرموط','شرموطة','شرموته','عرص','عرصة','معرص','خول','خولة',
    'قواد','قحبة','قحب','متناك','منيوكة','تناكة','عاهرة','مومس',
    'وسخ','حقير','كلب','ابن كلب','ابن متناكة','ابن القحبة','ابن الشرموطة',
    'يلعن','العن','لعنة','ملعون','تبا','جحش','خنزير','حمار',
    'غبي','غبية','أهبل','عبيط','بهيمة','حيوان','زبالة','زبل','زق','خرا','خري',
    'نعل','أبوك','أمك','أختك','ابن الـ','يبن الـ','يعرص','تعرص',
    'لواط','لوطي','شاذ','منحرف','مخنث','ديوث','زامل','عطاي','طحان','لبوة',
    'كسختك','كسمك','كسامك','مكوتك','طيزك','بزاز','حلمة',

    // ── Arabic obfuscated / bypass attempts ────────────────────────────
    'ك.س', 'خ.ول', 'ز.ب', 'ق.ح.ب.ة', 'ش.ر.م.و.ط', 'م.ت.ن.ا.ك', 'ع.ر.ص',
    'ك_س', 'خ_ول', 'ز_ب', 'ك س', 'خ ول', 'ز ب', 'ق ح ب ة', 'ش ر م و ط',
    'ك..س', 'ك/س', 'ك-س', 'ك~س',
    'ك1س', 'ك0س', 'كوسمك', 'كـس', 'ز.ب.ر', 'ا.ي.ر', 'ن.ي.ك',
    
    // ── Hate / discriminatory ────────────────────────────
    'عبد','زنجي','متخلف','عنصري','بربري','همجي',

    // ── Threats & Violence ──────────────────────────────────────────
    'اقتلك','اقتله','اذبحك','اذبحه','سأقتلك','هاجمك','ارهابي','تفجير','اغتيال','ادعسك','امسحك',

    // ── English profanity ────────────────────────────────
    'fuck','fucking','fucker','fck','f*ck','f u c k','f.u.c.k',
    'motherfucker','mofo','cocksucker',
    'shit','sh*t','sh1t','bullshit','horseshit',
    'bitch','bitches','b!tch','b1tch','b i t c h',
    'ass','asshole','assholes','a$$','a$$hole',
    'bastard','cunt','cock','dick','pussy','penis','vagina','twat',
    'whore','slut','skank','nigger','nigga','n1gga','n!gga','faggot','fag','retard',
    'wanker','prick','douche','douchebag','dipshit','dumbass','jackass','pedo','pedophile',

    // ── English threats ──────────────────────────────────
    'kill you','rape','murder','beat you','cut your', 'strangle',

    // ── Transliterated bypass attempts (Franco-Arabic) ───────────────────
    'kosomak','ksomak','ksmk','metnak','metnaka','sharmota','sharmouta','mnyok',
    'mnywk','a7a','aha','khawal','khwal','ars','3ars','mo3ars','mzabber',
    'zeby','zebby','tezy','teezy','qahba','kahba','kahba',
];

// دالة لتنظيف النص من الرموز والمسافات قبل فحصه
function cleanText(text) {
    // إزالة المسافات، النقاط، الشرطات، والرموز الخاصة
    return text.replace(/[.,\/#!$%\^&\*;:{}=\-_`~() ]/g, "").toLowerCase();
}

function containsProfanity(userInput) {
    const cleanedInput = cleanText(userInput);
    for (let word of BLOCKED) {
        // فحص الكلمة الممنوعة بدون الرموز
        const cleanedWord = cleanText(word);
        if (cleanedInput.includes(cleanedWord)) {
            return true;
        }
    }
    return false;
}

// Patterns: same char ×7 or more = spam
const SPAM_PATTERN = /(.)\1{6,}/;

// ── Word categories (for ban screen) ─────────────────────
const CATEGORIES = {
    profanity:      { ar: 'ألفاظ نابية',           icon: '🤬', color: '#f97316' },
    spam:           { ar: 'رسائل مزعجة',            icon: '📵', color: '#8b5cf6' },
    hate_speech:    { ar: 'خطاب كراهية / عنصرية',  icon: '🚫', color: '#dc2626' },
    threats:        { ar: 'تهديدات',                icon: '💀', color: '#991b1b' },
    harassment:     { ar: 'تحرش وإيذاء',            icon: '⚠️',  color: '#ef4444' },
    cheating:       { ar: 'غش في اللعبة',           icon: '🎰', color: '#0891b2' },
    admin_decision: { ar: 'قرار إداري',             icon: '🔨', color: '#1d4ed8' },
    permanent:      { ar: 'حظر دائم',               icon: '⛔', color: '#000' },
};

// ── Thresholds ────────────────────────────────────────────
const WARN_LIMIT          = 2;           // warnings before ban
const BAN_DURATION_MS     = 7 * 864e5;  // 7 days default
const PERM_BAN_THRESHOLD  = 3;          // bans before permanent
const RECHECK_INTERVAL_MS = 30_000;     // re-check Firebase every 30 s

// ── LocalStorage keys ─────────────────────────────────────
const LS_BAN  = 'eljasus_ban_v3';
const LS_WARN = 'eljasus_warnings_v3';

// ── Internal state ────────────────────────────────────────
let _db          = null;
let _user        = null;      // full Firebase user object
let _unsubBan    = null;      // Firebase onValue unsubscribe
let _recheckTimer = null;
let _screenShown = false;
let _navLocked   = false;

// ══════════════════════════════════════════════════════════
// TEXT NORMALISER
// ══════════════════════════════════════════════════════════
function norm(s) {
    return s
        .toLowerCase()
        .replace(/[\u064b-\u065f\u0670]/g, '')  // diacritics
        .replace(/[أإآٱ]/g, 'ا')
        .replace(/ة/g, 'ه')
        .replace(/ى/g, 'ي')
        .replace(/\s+/g, ' ')
        .trim();
}

function classify(text) {
    const n = norm(text);
    if (SPAM_PATTERN.test(n)) return 'spam';

    const THREAT_WORDS = ['اقتلك','اقتله','اذبحك','اذبحه','سأقتلك','kill you','murder','rape'];
    if (THREAT_WORDS.some(w => n.includes(norm(w)))) return 'threats';

    const HATE_WORDS = ['عبد','زنجي','متخلف','nigger','nigga','faggot'];
    if (HATE_WORDS.some(w => n.includes(norm(w)))) return 'hate_speech';

    return 'profanity';
}

function isBlocked(text) {
    const n = norm(text);
    if (SPAM_PATTERN.test(n)) return true;
    return BLOCKED.some(w => n.includes(norm(w)));
}

// ══════════════════════════════════════════════════════════
// FIREBASE HELPERS
// Works with both modular v9 (window._firebaseFns) and compat
// ══════════════════════════════════════════════════════════
function fbFns() {
    // Prefer injected helpers (set in room.html / index.html)
    if (window._firebaseFns) return window._firebaseFns;
    // Compat SDK fallback
    if (window.firebase?.database) return {
        ref:      (db, path) => firebase.database().ref(path),
        get:      r          => r.once('value'),
        update:   (r, v)     => r.update(v),
        onValue:  (r, cb)    => { r.on('value', cb); return () => r.off('value', cb); },
        serverTimestamp: ()  => firebase.database.ServerValue.TIMESTAMP,
    };
    return null;
}

async function dbGet(path) {
    const f = fbFns(); if (!f || !_db) return null;
    try { const s = await f.get(f.ref(_db, path)); return s.exists() ? s.val() : null; }
    catch { return null; }
}

async function dbUpdate(path, value) {
    const f = fbFns(); if (!f || !_db) return;
    try { await f.update(f.ref(_db, path), value); } catch(e) { console.warn('[MOD] update failed', e); }
}

// ══════════════════════════════════════════════════════════
// LOCAL STORAGE  (offline fallback — Firebase is source of truth)
// ══════════════════════════════════════════════════════════
function lsBan(obj) {
    if (obj === null) { localStorage.removeItem(LS_BAN); return; }
    localStorage.setItem(LS_BAN, JSON.stringify(obj));
}
function lsGetBan() {
    try { const v = localStorage.getItem(LS_BAN); return v ? JSON.parse(v) : null; } catch { return null; }
}
function lsWarnings()  { return parseInt(localStorage.getItem(LS_WARN) || '0', 10); }
function lsSetWarn(n)  { localStorage.setItem(LS_WARN, String(n)); }

// ══════════════════════════════════════════════════════════
// WARNINGS
// Firebase is the master. LocalStorage is cache only.
// ══════════════════════════════════════════════════════════
async function getWarnings() {
    if (!_user) return lsWarnings();
    const fb = await dbGet(`players/${_user.uid}/moderationWarnings`);
    const count = fb ?? 0;
    lsSetWarn(count);   // keep local in sync
    return count;
}

async function addWarning() {
    const current = await getWarnings();
    const next    = current + 1;
    lsSetWarn(next);
    if (_user) await dbUpdate(`players/${_user.uid}`, { moderationWarnings: next });
    return next;
}

async function resetWarnings() {
    lsSetWarn(0);
    if (_user) await dbUpdate(`players/${_user.uid}`, { moderationWarnings: 0 });
}

// ══════════════════════════════════════════════════════════
// BAN OBJECT SCHEMA
// {
//   reason:      string,
//   category:    keyof CATEGORIES,
//   bannedAt:    timestamp ms,
//   expiresAt:   timestamp ms  | -1 for permanent,
//   durationMs:  number | -1,
//   bannedBy:    'system' | admin_uid,
//   isPermanent: bool,
//   banCount:    number   (how many bans this user has had total)
// }
// ══════════════════════════════════════════════════════════
async function buildBanObj(reason, category, durationMs, bannedBy) {
    // Check how many previous bans this user has
    let banCount = 1;
    if (_user) {
        banCount = (await dbGet(`players/${_user.uid}/totalBans`) ?? 0) + 1;
    }
    const isPermanent = (durationMs === -1) || (banCount >= PERM_BAN_THRESHOLD);
    const expiresAt   = isPermanent ? -1 : Date.now() + (durationMs ?? BAN_DURATION_MS);

    return {
        reason:      reason   || 'انتهاك قواعد المجتمع',
        category:    category || 'profanity',
        bannedAt:    Date.now(),
        expiresAt,
        durationMs:  isPermanent ? -1 : (durationMs ?? BAN_DURATION_MS),
        bannedBy:    bannedBy || 'system',
        isPermanent,
        banCount,
    };
}

// ══════════════════════════════════════════════════════════
// BAN / LIFT BAN
// ══════════════════════════════════════════════════════════
async function issueBan(reason, category, durationMs, bannedBy) {
    const ban = await buildBanObj(reason, category, durationMs, bannedBy);

    // Save to Firebase (three paths: per-player + ban history + global banned_users)
    if (_user) {
        // Also write to banHistory so fetchOffenseHistory() detects repeat offenders
        // even after their active ban expires and is cleared from players/{uid}/ban
        const histKey = `players/${_user.uid}/banHistory/${ban.bannedAt}`;
        await dbUpdate(histKey, {
            reason:    ban.reason,
            category:  ban.category,
            bannedAt:  ban.bannedAt,
            expiresAt: ban.expiresAt,
            durationMs: ban.durationMs,
        });
        await dbUpdate(`players/${_user.uid}`, {
            ban:       ban,
            totalBans: ban.banCount,
        });
        await dbUpdate(`banned_users/${_user.uid}`, {
            ...ban,
            uid:      _user.uid,
            username: _user.displayName || localStorage.getItem('eljasus_user_name') || 'مجهول',
            email:    _user.email || '',
        });
    }

    // Save locally
    lsBan(ban);
    await resetWarnings();

    // Show screen immediately
    showBanScreen(ban);
}

async function liftBan() {
    // Called when ban expired or admin removed it
    lsBan(null);
    lsSetWarn(0);
    if (_user) {
        await dbUpdate(`players/${_user.uid}`,   { ban: null, moderationWarnings: 0 });
        await dbUpdate(`banned_users/${_user.uid}`, null);
    }
    removeBanScreen();
}

// ══════════════════════════════════════════════════════════
// BAN CHECK  (returns ban obj or null)
// Priority: Firebase > localStorage
// ══════════════════════════════════════════════════════════
async function fetchActiveBan() {
    let ban = null;

    // 1. Try Firebase
    if (_user) {
        ban = await dbGet(`players/${_user.uid}/ban`);
    }

    // 2. Fallback to local
    if (!ban) ban = lsGetBan();

    if (!ban) return null;

    // Check expiry
    if (!ban.isPermanent && ban.expiresAt !== -1 && Date.now() >= ban.expiresAt) {
        await liftBan();
        return null;
    }

    // Keep local in sync
    lsBan(ban);
    return ban;
}

// ══════════════════════════════════════════════════════════
// NAVIGATION LOCKOUT
// Intercepts back/forward, popstate, beforeunload, hashchange
// ══════════════════════════════════════════════════════════
function lockNavigation() {
    if (_navLocked) return;
    _navLocked = true;

    // Push a dummy history state so back button stays on this page
    history.pushState({ banned: true }, '', location.href);

    const blockNav = (e) => {
        history.pushState({ banned: true }, '', location.href);
        e.preventDefault?.();
        return false;
    };

    window.addEventListener('popstate',    blockNav);
    window.addEventListener('hashchange',  blockNav);
    window.addEventListener('beforeunload', (e) => {
        // Don't block actual page unload, just re-show ban on return
        // (localStorage ensures ban screen returns on next load)
    });

    // Override history methods
    const _pushState    = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);

    history.pushState = function(state, title, url) {
        // Allow only same-page state changes (our own lockout pushes)
        if (state?.banned) return _pushState(state, title, url);
        // Block all other navigation attempts
        console.warn('[MOD] Navigation blocked — user is banned');
    };

    history.replaceState = function(state, title, url) {
        if (state?.banned) return _replaceState(state, title, url);
        console.warn('[MOD] Navigation blocked — user is banned');
    };
}

// ══════════════════════════════════════════════════════════
// FORMAT HELPERS
// ══════════════════════════════════════════════════════════
function fmtDuration(ms) {
    if (ms === -1 || ms === Infinity) return 'دائم ♾️';
    const d = Math.floor(ms / 864e5);
    const h = Math.floor((ms % 864e5) / 36e5);
    const m = Math.floor((ms % 36e5)  / 6e4);
    const parts = [];
    if (d > 0) parts.push(`${d} يوم`);
    if (h > 0) parts.push(`${h} ساعة`);
    if (m > 0) parts.push(`${m} دقيقة`);
    return parts.join(' و ') || 'أقل من دقيقة';
}

function fmtDate(ts) {
    if (!ts || ts === -1) return '—';
    return new Date(ts).toLocaleString('ar-SA', {
        year:'numeric', month:'long', day:'numeric',
        hour:'2-digit', minute:'2-digit'
    });
}

function fmtRemaining(expiresAt) {
    if (expiresAt === -1) return '♾️ دائم';
    const diff = expiresAt - Date.now();
    if (diff <= 0) return 'انتهى';
    return fmtDuration(diff);
}

// ══════════════════════════════════════════════════════════
// BAN SCREEN
// Full-page overlay — no escape, no back button
// ══════════════════════════════════════════════════════════
function showBanScreen(ban) {
    // Lock scrolling & interaction on everything beneath
    document.documentElement.style.cssText += ';overflow:hidden!important';
    document.body.style.cssText            += ';overflow:hidden!important;pointer-events:none!important';

    lockNavigation();

    // Remove stale screen if re-showing (e.g. after an update)
    document.getElementById('_ej_ban')?.remove();

    const cat   = CATEGORIES[ban.category] || CATEGORIES.profanity;
    const isPerm = ban.isPermanent || ban.expiresAt === -1;

    const overlay = document.createElement('div');
    overlay.id = '_ej_ban';
    overlay.style.cssText = `
        position:fixed;inset:0;z-index:2147483647;
        background:radial-gradient(ellipse at 50% 0%,#2a0008 0%,#0a0e1a 55%,#07000d 100%);
        display:flex;align-items:center;justify-content:center;
        font-family:'Cairo',sans-serif;overflow-y:auto;padding:20px;box-sizing:border-box;
        pointer-events:all;`;

    const remainingId = `_rem_${Date.now()}`;

    overlay.innerHTML = `
<style>
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;900&family=Orbitron:wght@700;900&display=swap');
    @keyframes _bpulse{0%,100%{opacity:.03}50%{opacity:.09}}
    @keyframes _bspin {from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes _bfade {from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
    #_ej_ban *{box-sizing:border-box}
    #_ej_ban a:hover{opacity:.85}
</style>

<div style="
    max-width:520px;width:100%;
    background:linear-gradient(160deg,rgba(25,4,10,.98) 0%,rgba(12,4,20,.98) 100%);
    border:2px solid rgba(239,68,68,.45);border-radius:28px;
    padding:36px 28px 28px;text-align:center;
    box-shadow:0 0 80px rgba(239,68,68,.25),0 0 160px rgba(139,0,0,.15),inset 0 1px 0 rgba(255,255,255,.06);
    position:relative;overflow:hidden;
    animation:_bfade .6s ease both;">

    <!-- animated background pulse -->
    <div style="position:absolute;inset:0;border-radius:28px;
        background:rgba(239,68,68,.04);animation:_bpulse 2.5s ease-in-out infinite;pointer-events:none;"></div>

    <!-- spinning ring decoration -->
    <div style="position:absolute;top:-60px;right:-60px;width:180px;height:180px;border-radius:50%;
        border:2px solid rgba(239,68,68,.08);animation:_bspin 18s linear infinite;pointer-events:none;"></div>
    <div style="position:absolute;bottom:-40px;left:-40px;width:120px;height:120px;border-radius:50%;
        border:2px solid rgba(239,68,68,.06);animation:_bspin 12s linear infinite reverse;pointer-events:none;"></div>

    <!-- icon -->
    <div style="font-size:72px;margin-bottom:10px;line-height:1;
        filter:drop-shadow(0 0 24px rgba(239,68,68,.7));">🚫</div>

    <!-- title -->
    <h1 style="font-family:'Orbitron',sans-serif;font-size:clamp(18px,5vw,26px);
        font-weight:900;color:#ef4444;margin:0 0 4px;
        text-shadow:0 0 24px rgba(239,68,68,.8);">تم حظر حسابك</h1>
    <p style="font-family:'Orbitron',sans-serif;font-size:10px;color:rgba(239,68,68,.5);
        letter-spacing:.25em;text-transform:uppercase;margin:0 0 24px;">ACCOUNT BANNED</p>

    <!-- category badge -->
    <div style="display:inline-flex;align-items:center;gap:8px;
        background:${cat.color}18;border:1.5px solid ${cat.color}55;
        border-radius:30px;padding:6px 16px;margin-bottom:20px;">
        <span style="font-size:18px;">${cat.icon}</span>
        <span style="font-size:13px;font-weight:900;color:${cat.color};">${cat.ar}</span>
    </div>

    <!-- reason -->
    <div style="background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);
        border-radius:14px;padding:16px 18px;margin-bottom:16px;">
        <p style="font-size:10px;color:rgba(255,255,255,.3);font-family:'Orbitron',sans-serif;
            letter-spacing:.15em;margin:0 0 6px;">سبب الحظر</p>
        <p style="font-size:15px;font-weight:900;color:#fff;margin:0;line-height:1.5;">
            ${ban.reason}
        </p>
    </div>

    <!-- time grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px;">

        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
            border-radius:12px;padding:13px 10px;">
            <p style="font-size:9px;color:rgba(255,255,255,.3);font-family:'Orbitron',sans-serif;
                letter-spacing:.12em;margin:0 0 5px;">تاريخ الحظر</p>
            <p style="font-size:12px;font-weight:700;color:rgba(255,255,255,.75);margin:0;line-height:1.4;">
                ${fmtDate(ban.bannedAt)}
            </p>
        </div>

        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
            border-radius:12px;padding:13px 10px;">
            <p style="font-size:9px;color:rgba(255,255,255,.3);font-family:'Orbitron',sans-serif;
                letter-spacing:.12em;margin:0 0 5px;">ينتهي في</p>
            <p style="font-size:12px;font-weight:700;color:${isPerm ? '#ef4444' : 'rgba(255,255,255,.75)'};margin:0;line-height:1.4;">
                ${isPerm ? '♾️ دائم' : fmtDate(ban.expiresAt)}
            </p>
        </div>

        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
            border-radius:12px;padding:13px 10px;">
            <p style="font-size:9px;color:rgba(255,255,255,.3);font-family:'Orbitron',sans-serif;
                letter-spacing:.12em;margin:0 0 5px;">مدة الحظر</p>
            <p style="font-size:12px;font-weight:700;color:rgba(255,255,255,.75);margin:0;line-height:1.4;">
                ${fmtDuration(ban.durationMs)}
            </p>
        </div>

        <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
            border-radius:12px;padding:13px 10px;">
            <p style="font-size:9px;color:rgba(255,255,255,.3);font-family:'Orbitron',sans-serif;
                letter-spacing:.12em;margin:0 0 5px;">نفّذه</p>
            <p style="font-size:12px;font-weight:700;color:rgba(255,255,255,.75);margin:0;">
                ${ban.bannedBy === 'system' ? '🤖 النظام التلقائي' : '👤 الإدارة'}
            </p>
        </div>
    </div>

    <!-- live countdown -->
    ${isPerm ? `
    <div style="background:rgba(0,0,0,.4);border:2px solid rgba(239,68,68,.2);
        border-radius:16px;padding:16px;margin-bottom:20px;">
        <p style="font-size:11px;color:rgba(239,68,68,.6);font-family:'Orbitron',sans-serif;
            letter-spacing:.15em;margin:0 0 6px;">نوع الحظر</p>
        <p style="font-size:22px;font-weight:900;font-family:'Orbitron',sans-serif;
            color:#ef4444;text-shadow:0 0 16px rgba(239,68,68,.6);margin:0;">⛔ دائم</p>
    </div>
    ` : `
    <div style="background:rgba(0,0,0,.4);border:2px solid rgba(239,68,68,.25);
        border-radius:16px;padding:16px;margin-bottom:20px;">
        <p style="font-size:10px;color:rgba(239,68,68,.55);font-family:'Orbitron',sans-serif;
            letter-spacing:.15em;margin:0 0 8px;">الوقت المتبقي</p>
        <div id="${remainingId}" style="font-family:'Orbitron',sans-serif;
            font-size:clamp(16px,4.5vw,24px);font-weight:900;color:#ef4444;
            text-shadow:0 0 16px rgba(239,68,68,.6);letter-spacing:.05em;">
            ${fmtRemaining(ban.expiresAt)}
        </div>
    </div>
    `}

    <!-- ban count (if more than 1) -->
    ${ban.banCount > 1 ? `
    <p style="font-size:11px;color:rgba(239,68,68,.5);margin:0 0 16px;">
        هذا حظرك رقم <strong style="color:#ef4444;">${ban.banCount}</strong>
        ${ban.banCount >= PERM_BAN_THRESHOLD ? ' — الحظر التالي سيكون دائماً' : ''}
    </p>` : ''}

    <!-- note -->
    <p style="font-size:12px;color:rgba(255,255,255,.3);line-height:1.8;margin:0 0 20px;">
        لا يمكنك اللعب أونلاين أو محلياً خلال فترة الحظر.<br>
        إذا اعتقدت أن هذا خطأ تواصل معنا عبر ديسكورد.
    </p>

    <!-- discord appeal -->
    <a href="https://discord.gg/xBQ3ewVVHk" target="_blank" rel="noopener" style="
        display:inline-flex;align-items:center;gap:8px;
        padding:11px 26px;border-radius:12px;text-decoration:none;
        background:rgba(88,101,242,.12);border:2px solid rgba(88,101,242,.35);
        color:#fff;font-weight:900;font-size:13px;font-family:'Cairo',sans-serif;
        transition:opacity .2s;">
        <svg width="18" height="18" viewBox="0 0 71 55" fill="none">
            <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.44077 45.4204 0.52529C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.52529C25.5141 0.44359 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943561 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4377C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6034 51.2554 52.5699 52.5959 54.4349C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978Z" fill="#5865F2"/>
        </svg>
        استأنف قرار الحظر
    </a>
</div>`;

    document.body.appendChild(overlay);
    _screenShown = true;

    // Live countdown ticker
    if (!isPerm) {
        const el = document.getElementById(remainingId);
        if (el) {
            const tick = () => {
                const rem = ban.expiresAt - Date.now();
                if (rem <= 0) {
                    el.textContent = '⏳ انتهى — جارٍ التحقق...';
                    // Re-check Firebase (admin might have extended ban)
                    fetchActiveBan().then(b => {
                        if (!b) {
                            removeBanScreen();
                            location.reload();
                        } else {
                            // Ban was extended — refresh screen
                            showBanScreen(b);
                        }
                    });
                    return;
                }
                const d = Math.floor(rem / 864e5);
                const h = Math.floor((rem % 864e5) / 36e5);
                const m = Math.floor((rem % 36e5)  / 6e4);
                const s = Math.floor((rem % 6e4)   / 1e3);
                el.textContent = d > 0
                    ? `${d}ي ${h}س ${m}د ${s}ث`
                    : `${h}س ${m}د ${s}ث`;
                setTimeout(tick, 1000);
            };
            tick();
        }
    }
}

function removeBanScreen() {
    document.getElementById('_ej_ban')?.remove();
    _screenShown = false;
    document.documentElement.style.overflow = '';
    document.body.style.overflow        = '';
    document.body.style.pointerEvents   = '';
    _navLocked = false;
}

// ══════════════════════════════════════════════════════════
// YELLOW CARD TOAST  (warning notice)
// ══════════════════════════════════════════════════════════
function showWarningToast(warningNumber, isLastWarning) {
    document.querySelectorAll('._ej_warn').forEach(e => e.remove());

    const toast = document.createElement('div');
    toast.className = '_ej_warn';
    toast.style.cssText = `
        position:fixed;top:20px;left:50%;transform:translateX(-50%) translateY(-20px);
        z-index:2147483646;font-family:'Cairo',sans-serif;text-align:center;
        background:${isLastWarning
            ? 'linear-gradient(135deg,rgba(239,68,68,.22),rgba(180,0,0,.18))'
            : 'linear-gradient(135deg,rgba(245,158,11,.2),rgba(200,100,0,.15))'};
        border:2px solid ${isLastWarning ? 'rgba(239,68,68,.6)' : 'rgba(245,158,11,.55)'};
        border-radius:20px;padding:14px 22px;
        box-shadow:0 8px 40px rgba(0,0,0,.55);backdrop-filter:blur(16px);
        min-width:260px;max-width:90vw;
        transition:transform .4s cubic-bezier(.34,1.56,.64,1),opacity .4s;`;

    const cardIcons = warningNumber === 1
        ? '🟨'
        : isLastWarning
            ? '🟥'
            : '🟨🟨';

    toast.innerHTML = `
        <div style="font-size:30px;margin-bottom:6px;line-height:1;">${cardIcons}</div>
        <p style="font-size:15px;font-weight:900;
            color:${isLastWarning ? '#ef4444' : '#f59e0b'};margin:0 0 4px;">
            ${isLastWarning ? '🚨 آخر تحذير قبل الحظر!' : `بطاقة صفراء — تحذير ${warningNumber}`}
        </p>
        <p style="font-size:12px;color:rgba(255,255,255,.65);margin:0;line-height:1.6;">
            رسالتك تحتوي على كلمات محظورة وتم حذفها.<br>
            ${isLastWarning
                ? '<strong style="color:#ef4444;">التحذير التالي سيتسبب في حظرك فوراً.</strong>'
                : `${warningNumber} من ${WARN_LIMIT} تحذيرات مسموحة.`
            }
        </p>`;

    document.body.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });

    // Auto-dismiss after 4s
    setTimeout(() => {
        toast.style.opacity   = '0';
        toast.style.transform = 'translateX(-50%) translateY(-20px)';
        setTimeout(() => toast.remove(), 400);
    }, 4000);
}

// ══════════════════════════════════════════════════════════
// REAL-TIME BAN LISTENER
// If admin removes ban from Firebase console → screen disappears live
// If admin adds ban → screen appears live
// ══════════════════════════════════════════════════════════
function startRealtimeListener() {
    if (!_user) return;
    const f = fbFns();
    if (!f?.onValue || !_db) return;

    // Unsubscribe previous if any
    if (_unsubBan) { try { _unsubBan(); } catch {} }

    const banRef = f.ref(_db, `players/${_user.uid}/ban`);
    _unsubBan = f.onValue(banRef, (snap) => {
        const ban = snap?.val?.() ?? snap?.exists?.() ? snap.val() : null;

        if (!ban) {
            // Ban removed or never existed
            if (_screenShown) {
                lsBan(null);
                removeBanScreen();
                location.reload(); // fresh start
            }
            return;
        }

        // Ban exists — check expiry
        if (!ban.isPermanent && ban.expiresAt !== -1 && Date.now() >= ban.expiresAt) {
            liftBan();
            return;
        }

        // Show/refresh ban screen
        lsBan(ban);
        showBanScreen(ban);
    });
}

// ══════════════════════════════════════════════════════════
// PERIODIC RE-CHECK  (belt-and-suspenders for offline/missed events)
// ══════════════════════════════════════════════════════════
function startPeriodicCheck() {
    if (_recheckTimer) clearInterval(_recheckTimer);
    _recheckTimer = setInterval(async () => {
        const ban = await fetchActiveBan();
        if (ban && !_screenShown) {
            showBanScreen(ban);
        } else if (!ban && _screenShown) {
            removeBanScreen();
        }
    }, RECHECK_INTERVAL_MS);
}

// ══════════════════════════════════════════════════════════
// PUBLIC API
// ══════════════════════════════════════════════════════════

/**
 * init(db, user)
 * Call right after onAuthStateChanged gives you a user.
 * db   = getDatabase(app)
 * user = Firebase User object
 */
async function init(db, user) {
    _db   = db;
    _user = user;

    // Inject Firebase fns into window._firebaseFns if not already there
    // (some pages set this, others don't — we handle both)

    // 1. Check for existing ban immediately
    const ban = await fetchActiveBan();
    if (ban) {
        showBanScreen(ban);
    }

    // 2. Start real-time listener (handles admin ban/unban live)
    startRealtimeListener();

    // 3. Start periodic re-check (fallback)
    startPeriodicCheck();
}

// ══════════════════════════════════════════════════════════
// OFFENSE HISTORY
// Reads the player's full record: current warnings + previous
// bans (even expired ones) from Firebase/localStorage.
// This determines whether a new violation is a first-time
// yellow card or an instant ban.
// ══════════════════════════════════════════════════════════
async function fetchOffenseHistory() {
    let currentWarnings = 0;
    let previousBans    = 0;
    let lastBanReason   = null;
    let lastBanDate     = null;

    if (_user) {
        // Firebase is source of truth
        const playerData = await dbGet(`players/${_user.uid}`);
        currentWarnings  = playerData?.moderationWarnings ?? 0;
        previousBans     = playerData?.totalBans          ?? 0;
        // grab last ban record even if it's expired/cleared
        // Check active ban first, then banHistory for any past bans (even expired)
        const activeBan  = playerData?.ban;
        const banHistory = playerData?.banHistory;
        const histEntries = banHistory ? Object.values(banHistory) : [];
        const lastRecord  = activeBan || (histEntries.length
            ? histEntries.sort((a,b) => b.bannedAt - a.bannedAt)[0]
            : null);
        if (lastRecord) {
            lastBanReason = lastRecord.reason;
            lastBanDate   = lastRecord.bannedAt;
        }
        // totalBans from Firebase counts ALL bans including expired
        previousBans = playerData?.totalBans ?? histEntries.length ?? 0;
    } else {
        // Offline fallback — localStorage
        currentWarnings = lsWarnings();
        // If there was ever a ban stored locally, count it
        const localBan  = lsGetBan();
        if (localBan) { previousBans = 1; lastBanReason = localBan.reason; lastBanDate = localBan.bannedAt; }
    }

    return { currentWarnings, previousBans, lastBanReason, lastBanDate };
}

/**
 * scan(text)
 * Call before sending ANY chat message, at any point in the game.
 * Returns true  → message BLOCKED  (warn/ban handled internally, do NOT send)
 * Returns false → message is CLEAN (safe to send)
 *
 * Decision tree:
 *   Clean text                              → false  (send normally)
 *   Bad word + no history at all            → 🟨 yellow card warning
 *   Bad word + already has 1 warning        → 🟥 red card → ban immediately
 *   Bad word + has any previous ban         → 🟥 red card → ban immediately (zero tolerance)
 *   Bad word + both warning AND prev ban    → 🟥 permanent ban
 */
async function scan(text) {
    if (!isBlocked(text)) return false; // ✅ clean — nothing to do

    const category = classify(text);

    // ── Pull full history before deciding anything ────────
    const { currentWarnings, previousBans, lastBanReason, lastBanDate } =
        await fetchOffenseHistory();

    // ── Zero-tolerance condition ──────────────────────────
    // User goes straight to ban if they have ANY previous ban
    // OR already have at least one active warning.
    const hasAnyWarning  = currentWarnings >= 1;
    const hasAnyPrevBan  = previousBans    >= 1;
    const zerotoleranceUser = hasAnyWarning || hasAnyPrevBan;

    if (zerotoleranceUser) {
        // Build an informative reason that includes the history
        let reasonParts = ['كتابة كلمات محظورة'];
        if (hasAnyWarning) reasonParts.push(`سبق إنذاره ${currentWarnings} ${currentWarnings === 1 ? 'مرة' : 'مرات'}`);
        if (hasAnyPrevBan) {
            const prevBanInfo = lastBanDate
                ? `(آخر حظر: ${new Date(lastBanDate).toLocaleDateString('ar-SA')} — ${lastBanReason || 'انتهاك سابق'})`
                : 'سبق حظره من قبل';
            reasonParts.push(prevBanInfo);
        }
        const reason = reasonParts.join(' — ');

        // Permanent ban if they have BOTH a warning AND a previous ban
        const isPermanentNow = hasAnyWarning && hasAnyPrevBan;
        const duration       = isPermanentNow ? -1 : BAN_DURATION_MS;

        // Flash the red card toast for 800ms so they see WHY before the screen locks
        showWarningToast(WARN_LIMIT, true);
        await new Promise(r => setTimeout(r, 800));

        await issueBan(reason, category, duration, 'system');
        return true; // BLOCKED
    }

    // ── First-ever offense: yellow card ───────────────────
    const newWarningCount = await addWarning();
    showWarningToast(newWarningCount, newWarningCount >= WARN_LIMIT - 1);

    // Edge case: if WARN_LIMIT is 1, one offense = immediate ban
    if (newWarningCount >= WARN_LIMIT) {
        await new Promise(r => setTimeout(r, 800));
        await issueBan(
            `كتابة كلمات محظورة (${newWarningCount} تحذير)`,
            category, BAN_DURATION_MS, 'system'
        );
    }

    return true; // BLOCKED (but only warned, not banned yet)
}

/**
 * banUserManual(uid, reason, category, durationMs)
 * For admin panel use — ban any user directly.
 */
async function banUserManual(targetUid, reason, category, durationMs) {
    // If banning current user, issueBan() handles it
    if (_user && targetUid === _user.uid) {
        await issueBan(reason, category, durationMs, 'admin');
        return;
    }
    // Otherwise write directly to Firebase for the target user
    const ban = {
        reason:      reason || 'قرار إداري',
        category:    category || 'admin_decision',
        bannedAt:    Date.now(),
        expiresAt:   durationMs === -1 ? -1 : Date.now() + (durationMs ?? BAN_DURATION_MS),
        durationMs:  durationMs ?? BAN_DURATION_MS,
        bannedBy:    _user?.uid || 'admin',
        isPermanent: durationMs === -1,
        banCount:    1,
    };
    if (_db) {
        const f = fbFns();
        if (f) {
            await f.update(f.ref(_db, `players/${targetUid}`), { ban });
            await f.update(f.ref(_db, `banned_users/${targetUid}`), ban);
        }
    }
}

/**
 * liftBanManual(targetUid)
 * Admin removes a ban.
 */
async function liftBanManual(targetUid) {
    if (!_db) return;
    const f = fbFns(); if (!f) return;
    await f.update(f.ref(_db, `players/${targetUid}`), { ban: null, moderationWarnings: 0 });
    await f.update(f.ref(_db, `banned_users/${targetUid}`), null);
    if (_user && targetUid === _user.uid) {
        lsBan(null);
        lsSetWarn(0);
        removeBanScreen();
    }
}

// Expose globals
window.MOD = {
    init,
    scan,
    banUserManual,
    liftBanManual,
    isBlocked,        // utility — check without side effects
    showBanScreen,    // utility — render a ban object directly
    CATEGORIES,       // useful for admin dropdowns
};

// Provide legacy alias (old code called MOD.checkAndHandleMessage)
window.MOD.checkAndHandleMessage = async (text) => window.MOD.scan(text);
window.MOD.checkOnLoad = () => {}; // handled inside init() now
window.MOD.banUser     = (r, d)   => issueBan(r, 'admin_decision', d, 'admin');

})();
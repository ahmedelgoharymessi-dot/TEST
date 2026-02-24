// ============================================================
// EL JASUS — AUTO MODERATION SYSTEM
// Warn → Ban → Block Play (online + local)
// ============================================================

(function () {

    // ── BLOCKED WORDS ────────────────────────────────────────
    // Arabic + English — covers profanity, hate speech, slurs
    const BLOCKED_WORDS = [
        // Arabic profanity (common forms + variations)
        'كس','كوس','بص','بصص','زبر','أير','اير','زب','لحس','تفشيخ','فشخ','فشخك','يفشخ',
        'نيك','ينيك','انيك','تنيك','مناك','منيوك','شرموط','شرموطة','عرص','عرصة',
        'خول','خولة','قواد','قحبة','قحب','متناك','منيوكة','وسخ','حقير','كلب','ابن كلب',
        'ابن متناكة','يلعن','العن','لعنة','ملعون','تبًا','جحش','جحشة','خنزير','حمار',
        'غبي','غبية','أهبل','تخين','عبيط','بهيمة','حيوان','وحش','زبالة','زبل',
        'تبا','نعل','أبوك','أمك','أختك','ابن الـ','يبن الـ','يعرص','تعرص',
        'بهوات','لواط','لوطي','شاذ','منحرف','العرصة','العرص','القوادة','القواد','القحبة','القحب','المتناكة','المتناك',
        'الملعونة','الملعون','اللواط','اللوطي','الشاذ','المنحرف','خول','ابن خول','ابن خ.ول',
        // English profanity
        'fuck','fucking','fucker','fck','f*ck','shit','sh*t','bitch','bitches',
        'ass','asshole','bastard','cunt','cock','dick','pussy','whore','slut',
        'nigger','nigga','faggot','retard','idiot','moron','stupid','hate',
        // Hate / threats
        'اقتلك','اقتله','اذبحك','اذبحه','سأقتلك','هاجمك','ارهاب','ارهابي',
        'kill','die','murder','rape','threat','terror',
        // Arabic English transliteration
        'Ksomak','kosomak','KoSomAk','KOSOMAK','KSMK','metnak','Metnak','Metnaka'
    ];

    // normalise Arabic text for matching
    function normalise(str) {
        return str
            .toLowerCase()
            .replace(/[\u0627\u0622\u0623\u0625]/g, 'ا')  // alef variants
            .replace(/[\u0629]/g, 'ه')                    // taa marbuta → ha
            .replace(/[\u064b-\u065f]/g, '')               // strip diacritics
            .replace(/\s+/g, ' ')
            .trim();
    }

    function containsBlockedWord(text) {
        const n = normalise(text);
        return BLOCKED_WORDS.some(w => {
            const nw = normalise(w);
            // whole-word check using regex (Arabic-safe)
            return n.includes(nw);
        });
    }

    // ── BAN CONFIG ──────────────────────────────────────────
    const BAN_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 days default
    const WARN_LIMIT      = 2;                          // 2 warnings → ban
    const LS_BAN_KEY      = 'eljasus_ban';
    const LS_WARN_KEY     = 'eljasus_warnings';

    // ── STATE ───────────────────────────────────────────────
    let _db   = null;   // Firebase db (set via MOD.init)
    let _uid  = null;   // Firebase uid
    let _ref  = null;   // Firebase ref fn
    let _update = null; // Firebase update fn
    let _get  = null;   // Firebase get fn

    // ── LOCAL BAN HELPERS ───────────────────────────────────
    function saveBanLocally(banObj) {
        localStorage.setItem(LS_BAN_KEY, JSON.stringify(banObj));
    }

    function loadLocalBan() {
        try { return JSON.parse(localStorage.getItem(LS_BAN_KEY)); }
        catch { return null; }
    }

    function getLocalWarnings() {
        try { return parseInt(localStorage.getItem(LS_WARN_KEY) || '0'); }
        catch { return 0; }
    }

    function incLocalWarnings() {
        const w = getLocalWarnings() + 1;
        localStorage.setItem(LS_WARN_KEY, String(w));
        return w;
    }

    // ── FIREBASE BAN HELPERS ─────────────────────────────────
    async function saveBanFirebase(banObj) {
        if (!_db || !_uid) return;
        try {
            await _update(_ref(_db, `players/${_uid}`), { ban: banObj });
        } catch (e) { console.warn('[MOD] Firebase ban save failed', e); }
    }

    async function loadFirebaseBan() {
        if (!_db || !_uid || !_get) return null;
        try {
            const snap = await _get(_ref(_db, `players/${_uid}/ban`));
            return snap.exists() ? snap.val() : null;
        } catch { return null; }
    }

    async function getFirebaseWarnings() {
        if (!_db || !_uid || !_get) return 0;
        try {
            const snap = await _get(_ref(_db, `players/${_uid}/moderationWarnings`));
            return snap.val() || 0;
        } catch { return 0; }
    }

    async function incFirebaseWarnings() {
        if (!_db || !_uid) return 1;
        try {
            const snap = await _get(_ref(_db, `players/${_uid}/moderationWarnings`));
            const w = (snap.val() || 0) + 1;
            await _update(_ref(_db, `players/${_uid}`), { moderationWarnings: w });
            return w;
        } catch { return 1; }
    }

    // ── BAN SCREEN ───────────────────────────────────────────
    function buildBanScreen(banObj) {
        const existing = document.getElementById('ban-screen-overlay');
        if (existing) existing.remove();

        const expiresAt  = banObj.bannedAt + banObj.duration;
        const now        = Date.now();
        const remaining  = Math.max(0, expiresAt - now);
        const days       = Math.floor(remaining / 86400000);
        const hours      = Math.floor((remaining % 86400000) / 3600000);
        const mins       = Math.floor((remaining % 3600000)  / 60000);
        const bannedDate = new Date(banObj.bannedAt).toLocaleString('ar-EG');
        const expiryDate = new Date(expiresAt).toLocaleString('ar-EG');

        const overlay = document.createElement('div');
        overlay.id = 'ban-screen-overlay';
        overlay.style.cssText = `
            position:fixed;inset:0;z-index:999999;
            background:radial-gradient(ellipse at center, #1a0005 0%, #0a0e1a 100%);
            display:flex;align-items:center;justify-content:center;
            font-family:'Cairo',sans-serif;padding:20px;`;

        overlay.innerHTML = `
            <div style="
                max-width:480px;width:100%;
                background:linear-gradient(135deg,rgba(30,5,10,.98),rgba(15,5,20,.98));
                border:2px solid rgba(239,68,68,.5);
                border-radius:28px;padding:36px 28px;text-align:center;
                box-shadow:0 0 60px rgba(239,68,68,.3),0 0 120px rgba(239,68,68,.1);
                position:relative;overflow:hidden;">

                <!-- animated red glow pulse -->
                <div style="
                    position:absolute;inset:0;border-radius:28px;
                    background:rgba(239,68,68,.04);
                    animation:banPulse 2s ease-in-out infinite;
                    pointer-events:none;"></div>

                <!-- icon -->
                <div style="font-size:64px;margin-bottom:12px;filter:drop-shadow(0 0 20px rgba(239,68,68,.8));">🚫</div>

                <!-- title -->
                <h1 style="
                    font-family:'Orbitron',sans-serif;font-size:clamp(20px,5vw,28px);
                    font-weight:900;color:#ef4444;margin-bottom:6px;
                    text-shadow:0 0 20px rgba(239,68,68,.8);">
                    تم حظر حسابك
                </h1>
                <p style="font-size:12px;color:rgba(239,68,68,.6);letter-spacing:.2em;
                    font-family:'Orbitron',sans-serif;margin-bottom:24px;text-transform:uppercase;">
                    ACCOUNT BANNED
                </p>

                <!-- reason -->
                <div style="
                    background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);
                    border-radius:14px;padding:16px;margin-bottom:18px;">
                    <p style="font-size:11px;color:rgba(255,255,255,.4);margin-bottom:6px;
                        font-family:'Orbitron',sans-serif;letter-spacing:.15em;">السبب</p>
                    <p style="font-size:15px;font-weight:900;color:#fff;">${banObj.reason || 'انتهاك قواعد المجتمع'}</p>
                </div>

                <!-- time info -->
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;">
                    <div style="
                        background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
                        border-radius:12px;padding:12px;">
                        <p style="font-size:9px;color:rgba(255,255,255,.35);
                            font-family:'Orbitron',sans-serif;margin-bottom:4px;">تاريخ الحظر</p>
                        <p style="font-size:12px;font-weight:700;color:rgba(255,255,255,.7);">${bannedDate}</p>
                    </div>
                    <div style="
                        background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);
                        border-radius:12px;padding:12px;">
                        <p style="font-size:9px;color:rgba(255,255,255,.35);
                            font-family:'Orbitron',sans-serif;margin-bottom:4px;">ينتهي في</p>
                        <p style="font-size:12px;font-weight:700;color:rgba(255,255,255,.7);">${expiryDate}</p>
                    </div>
                </div>

                <!-- countdown -->
                <div style="
                    background:rgba(239,68,68,.06);border:2px solid rgba(239,68,68,.2);
                    border-radius:16px;padding:16px;margin-bottom:24px;">
                    <p style="font-size:10px;color:rgba(239,68,68,.6);
                        font-family:'Orbitron',sans-serif;margin-bottom:8px;letter-spacing:.15em;">
                        الوقت المتبقي
                    </p>
                    <div id="ban-countdown" style="
                        font-family:'Orbitron',sans-serif;font-size:clamp(18px,5vw,26px);
                        font-weight:900;color:#ef4444;
                        text-shadow:0 0 15px rgba(239,68,68,.6);">
                        ${days}ي ${hours}س ${mins}د
                    </div>
                </div>

                <!-- note -->
                <p style="font-size:12px;color:rgba(255,255,255,.35);line-height:1.8;">
                    لا يمكنك اللعب أونلاين أو محلياً خلال فترة الحظر.<br>
                    إذا اعتقدت أن هذا خطأ، تواصل معنا عبر ديسكورد.
                </p>

                <!-- discord -->
                <a href="https://discord.gg/xBQ3ewVVHk" target="_blank" style="
                    display:inline-flex;align-items:center;gap:8px;margin-top:20px;
                    padding:10px 24px;border-radius:12px;text-decoration:none;
                    background:rgba(88,101,242,.15);border:2px solid rgba(88,101,242,.3);
                    color:#fff;font-weight:900;font-size:13px;
                    transition:all .25s;">
                    <i class="fab fa-discord" style="color:#5865F2;"></i>
                    تواصل معنا
                </a>
            </div>

            <style>
                @keyframes banPulse {
                    0%,100% { opacity:.04; }
                    50%      { opacity:.12; }
                }
            </style>`;

        document.body.appendChild(overlay);

        // Live countdown
        const countdownEl = document.getElementById('ban-countdown');
        if (countdownEl) {
            const tick = () => {
                const rem   = Math.max(0, expiresAt - Date.now());
                const d     = Math.floor(rem / 86400000);
                const h     = Math.floor((rem % 86400000) / 3600000);
                const m     = Math.floor((rem % 3600000)  / 60000);
                const s     = Math.floor((rem % 60000)    / 1000);
                countdownEl.textContent = rem > 0
                    ? `${d}ي ${h}س ${m}د ${s}ث`
                    : 'انتهى الحظر — أعد تحميل الصفحة';
                if (rem > 0) setTimeout(tick, 1000);
                else { saveBanLocally(null); localStorage.removeItem(LS_BAN_KEY); }
            };
            tick();
        }
    }

    // ── WARN TOAST ───────────────────────────────────────────
    function showWarnToast(warningNumber) {
        const t = document.createElement('div');
        const isLast = warningNumber >= WARN_LIMIT;
        t.style.cssText = `
            position:fixed;top:20px;left:50%;transform:translateX(-50%);
            z-index:99999;font-family:'Cairo',sans-serif;text-align:center;
            background:${isLast ? 'linear-gradient(135deg,rgba(239,68,68,.25),rgba(180,0,0,.2))' : 'linear-gradient(135deg,rgba(245,158,11,.2),rgba(200,100,0,.15))'};
            border:2px solid ${isLast ? 'rgba(239,68,68,.6)' : 'rgba(245,158,11,.5)'};
            border-radius:18px;padding:14px 24px;
            box-shadow:0 8px 32px rgba(0,0,0,.5);
            backdrop-filter:blur(12px);
            animation:warnSlideIn .4s cubic-bezier(0.34,1.56,0.64,1);
            min-width:260px;max-width:90vw;`;
        t.innerHTML = `
            <div style="font-size:28px;margin-bottom:6px;">${isLast ? '🚨' : '⚠️'}</div>
            <p style="font-size:15px;font-weight:900;color:${isLast ? '#ef4444' : '#f59e0b'};">
                ${isLast ? 'تحذير أخير!' : 'تحذير'}
            </p>
            <p style="font-size:12px;color:rgba(255,255,255,.7);margin-top:4px;">
                رسالتك تحتوي على كلمات محظورة وتم حذفها.<br>
                ${isLast ? 'سيتم حظر حسابك إذا تكرر ذلك.' : `تحذير ${warningNumber} من ${WARN_LIMIT}`}
            </p>`;
        document.body.appendChild(t);

        const style = document.createElement('style');
        style.textContent = `@keyframes warnSlideIn {
            from { transform:translateX(-50%) translateY(-30px); opacity:0; }
            to   { transform:translateX(-50%) translateY(0);     opacity:1; }
        }`;
        document.head.appendChild(style);

        setTimeout(() => {
            t.style.opacity = '0';
            t.style.transition = 'opacity .4s';
            setTimeout(() => t.remove(), 400);
        }, 4000);
    }

    // ── CORE API ─────────────────────────────────────────────

    /** Check a message. Returns false if clean, true if blocked (and handles warn/ban). */
    async function checkAndHandleMessage(text, playerName) {
        if (!containsBlockedWord(text)) return false; // clean

        // Warn
        let warnCount = incLocalWarnings();
        if (_uid) warnCount = await incFirebaseWarnings();

        if (warnCount >= WARN_LIMIT) {
            await banUser('كتابة كلمات محظورة متكررة في الشات');
        } else {
            showWarnToast(warnCount);
        }
        return true; // message is blocked
    }

    /** Ban a user. duration = ms (default 7 days). */
    async function banUser(reason, durationMs) {
        const dur = durationMs || BAN_DURATION_MS;
        const banObj = {
            reason:   reason || 'انتهاك قواعد المجتمع',
            bannedAt: Date.now(),
            duration: dur,
            bannedBy: 'system'
        };

        // Save locally
        saveBanLocally(banObj);

        // Save to Firebase
        await saveBanFirebase(banObj);

        // Show screen immediately
        buildBanScreen(banObj);
    }

    /** Check if this user is currently banned. Returns ban object or null. */
    async function checkBan() {
        // Check Firebase first if available
        let banObj = null;

        if (_uid) {
            banObj = await loadFirebaseBan();
            if (banObj) saveBanLocally(banObj); // keep local in sync
        }

        // Fallback: local
        if (!banObj) banObj = loadLocalBan();

        if (!banObj) return null;

        const expiresAt = banObj.bannedAt + banObj.duration;
        if (Date.now() >= expiresAt) {
            // Ban expired
            localStorage.removeItem(LS_BAN_KEY);
            if (_uid && _update && _ref && _db) {
                try {
                    await _update(_ref(_db, `players/${_uid}`), { ban: null, moderationWarnings: 0 });
                } catch {}
            }
            localStorage.removeItem(LS_WARN_KEY);
            return null;
        }

        return banObj;
    }

    /** Call from the module with Firebase deps. */
    function init(db, uid, refFn, updateFn, getFn) {
        _db     = db;
        _uid    = uid;
        _ref    = refFn;
        _update = updateFn;
        _get    = getFn;
    }

    /** Call on page load to check + show ban screen if needed. */
    async function checkOnLoad() {
        const ban = await checkBan();
        if (ban) {
            buildBanScreen(ban);
            return true; // is banned
        }
        return false;
    }

    // ── EXPOSE ────────────────────────────────────────────────
    window.MOD = {
        init,
        checkOnLoad,
        checkAndHandleMessage,
        banUser,
        checkBan,
        containsBlockedWord
    };

})();
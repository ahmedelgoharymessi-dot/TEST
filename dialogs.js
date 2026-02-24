// ============================================================
// EL JASUS — CUSTOM DIALOG SYSTEM
// Replaces browser alert / prompt / confirm with designed UI
// API:
//   await UIAlert(message, { title, icon, type })
//   await UIPrompt(message, { title, placeholder, icon, defaultValue })
//   await UIConfirm(message, { title, icon, confirmText, cancelText, type })
// types: 'info' | 'success' | 'warning' | 'error'
// ============================================================

(function () {

    // ── THEME PALETTE ────────────────────────────────────────
    const THEMES = {
        info:    { color: '#00f2ff', bg: 'rgba(0,242,255,.08)',    border: 'rgba(0,242,255,.35)',    shadow: 'rgba(0,242,255,.25)',    icon: 'ℹ️' },
        success: { color: '#34d399', bg: 'rgba(52,211,153,.08)',   border: 'rgba(52,211,153,.35)',   shadow: 'rgba(52,211,153,.25)',   icon: '✅' },
        warning: { color: '#f59e0b', bg: 'rgba(245,158,11,.08)',   border: 'rgba(245,158,11,.35)',   shadow: 'rgba(245,158,11,.25)',   icon: '⚠️' },
        error:   { color: '#ef4444', bg: 'rgba(239,68,68,.08)',    border: 'rgba(239,68,68,.35)',    shadow: 'rgba(239,68,68,.25)',    icon: '🚫' },
    };

    // ── INJECT STYLES (once) ─────────────────────────────────
    if (!document.getElementById('ui-dialog-styles')) {
        const s = document.createElement('style');
        s.id = 'ui-dialog-styles';
        s.textContent = `
            .uid-overlay {
                position: fixed; inset: 0; z-index: 999990;
                background: rgba(5, 7, 20, 0.82);
                backdrop-filter: blur(8px);
                -webkit-backdrop-filter: blur(8px);
                display: flex; align-items: center; justify-content: center;
                padding: 20px;
                animation: uid-fadeIn .18s ease;
            }
            @keyframes uid-fadeIn  { from { opacity:0 }              to { opacity:1 } }
            @keyframes uid-slideUp { from { transform:translateY(28px) scale(.96); opacity:0 }
                                     to   { transform:translateY(0)    scale(1);   opacity:1 } }
            @keyframes uid-slideDown { from { transform:translateY(0)    scale(1);   opacity:1 }
                                       to   { transform:translateY(24px) scale(.96); opacity:0 } }

            .uid-box {
                width: 100%; max-width: 400px;
                background: linear-gradient(145deg, rgba(12,16,32,.98), rgba(20,14,40,.98));
                border-radius: 24px;
                padding: 32px 28px 24px;
                border: 2px solid;
                box-shadow: 0 24px 80px rgba(0,0,0,.6);
                font-family: 'Cairo', sans-serif;
                color: #fff;
                position: relative;
                overflow: hidden;
                animation: uid-slideUp .22s cubic-bezier(0.34,1.4,0.64,1);
            }

            .uid-box.closing {
                animation: uid-slideDown .18s ease forwards;
            }

            /* shimmer sheen */
            .uid-box::before {
                content:'';
                position:absolute; top:-60%; left:-60%;
                width:220%; height:220%;
                background: linear-gradient(45deg, transparent, rgba(255,255,255,.03), transparent);
                animation: uid-sheen 4s linear infinite;
                pointer-events:none;
            }
            @keyframes uid-sheen {
                0%   { transform: translateX(-100%) translateY(-100%) rotate(45deg); }
                100% { transform: translateX(100%)  translateY(100%)  rotate(45deg); }
            }

            .uid-icon  { font-size: 40px; margin-bottom: 12px; display:block; text-align:center; }
            .uid-title { font-size: 17px; font-weight: 900; text-align:center; margin-bottom: 8px;
                         font-family:'Orbitron',sans-serif; letter-spacing:.03em; }
            .uid-msg   { font-size: 14px; text-align: center; color: rgba(255,255,255,.72);
                         line-height: 1.7; margin-bottom: 22px; }

            /* input for prompt */
            .uid-input {
                width: 100%; padding: 12px 16px;
                background: rgba(0,0,0,.4);
                border: 2px solid rgba(255,255,255,.12);
                border-radius: 14px;
                color: #fff; font-size: 15px; font-weight: 700;
                font-family: 'Cairo', sans-serif;
                outline: none; margin-bottom: 20px;
                transition: border-color .2s, box-shadow .2s;
                box-sizing: border-box;
                text-align: center;
                direction: auto;
            }
            .uid-input:focus {
                border-color: var(--uid-accent, #00f2ff);
                box-shadow: 0 0 0 3px rgba(0,242,255,.15);
            }
            .uid-input::placeholder { color: rgba(255,255,255,.25); }

            /* button row */
            .uid-btns { display: flex; gap: 10px; justify-content: center; }

            .uid-btn {
                flex: 1; padding: 12px 20px;
                border-radius: 14px;
                font-size: 14px; font-weight: 900;
                font-family: 'Cairo', sans-serif;
                cursor: pointer; border: 2px solid;
                transition: all .2s ease;
                position: relative; overflow: hidden;
                letter-spacing: .02em;
            }
            .uid-btn:hover  { transform: translateY(-2px); }
            .uid-btn:active { transform: translateY(0) scale(.97); }

            .uid-btn-primary {
                color: #fff;
                border-color: transparent;
            }
            .uid-btn-primary::after {
                content:''; position:absolute; inset:0;
                background: rgba(255,255,255,.15);
                opacity:0; transition:opacity .2s;
            }
            .uid-btn-primary:hover::after { opacity:1; }

            .uid-btn-cancel {
                background: rgba(255,255,255,.05);
                border-color: rgba(255,255,255,.12);
                color: rgba(255,255,255,.55);
            }
            .uid-btn-cancel:hover {
                background: rgba(255,255,255,.1);
                border-color: rgba(255,255,255,.25);
                color: rgba(255,255,255,.85);
            }

            /* colour strip at top */
            .uid-strip {
                position: absolute; top:0; left:0; right:0; height: 3px;
                border-radius: 24px 24px 0 0;
            }
        `;
        document.head.appendChild(s);
    }

    // ── CORE BUILDER ─────────────────────────────────────────
    function buildDialog({ icon, title, message, type = 'info', buttons = [], inputCfg = null }) {
        return new Promise((resolve) => {
            const theme = THEMES[type] || THEMES.info;

            const overlay = document.createElement('div');
            overlay.className = 'uid-overlay';

            const box = document.createElement('div');
            box.className = 'uid-box';
            box.style.borderColor = theme.border;
            box.style.boxShadow   = `0 24px 80px rgba(0,0,0,.6), 0 0 60px ${theme.shadow}`;
            box.style.setProperty('--uid-accent', theme.color);

            // top colour strip
            const strip = document.createElement('div');
            strip.className = 'uid-strip';
            strip.style.background = `linear-gradient(90deg, transparent, ${theme.color}, transparent)`;
            box.appendChild(strip);

            // icon
            if (icon || theme.icon) {
                const ic = document.createElement('span');
                ic.className = 'uid-icon';
                ic.textContent = icon || theme.icon;
                box.appendChild(ic);
            }

            // title
            if (title) {
                const t = document.createElement('div');
                t.className = 'uid-title';
                t.style.color = theme.color;
                t.style.textShadow = `0 0 20px ${theme.shadow}`;
                t.textContent = title;
                box.appendChild(t);
            }

            // message
            if (message) {
                const m = document.createElement('div');
                m.className = 'uid-msg';
                m.innerHTML = message; // allow simple HTML like <br>
                box.appendChild(m);
            }

            // input (for prompt)
            let inputEl = null;
            if (inputCfg) {
                inputEl = document.createElement('input');
                inputEl.className = 'uid-input';
                inputEl.type = 'text';
                inputEl.placeholder = inputCfg.placeholder || '';
                inputEl.value       = inputCfg.defaultValue || '';
                box.appendChild(inputEl);
            }

            // buttons
            const btnRow = document.createElement('div');
            btnRow.className = 'uid-btns';

            function close(value) {
                box.classList.add('closing');
                overlay.style.animation = 'uid-fadeIn .15s ease reverse forwards';
                setTimeout(() => overlay.remove(), 170);
                resolve(value);
            }

            buttons.forEach(({ label, value, primary, style: extraStyle }) => {
                const b = document.createElement('button');
                b.className = `uid-btn ${primary ? 'uid-btn-primary' : 'uid-btn-cancel'}`;
                b.textContent = label;
                if (primary) {
                    b.style.background = `linear-gradient(135deg, ${theme.color}cc, ${theme.color}88)`;
                    b.style.borderColor = theme.color;
                    b.style.boxShadow   = `0 4px 20px ${theme.shadow}`;
                    b.style.color = '#fff';
                }
                if (extraStyle) Object.assign(b.style, extraStyle);

                b.onclick = () => {
                    if (inputEl !== null) {
                        // prompt mode — return input value or null
                        close(value === '__input__' ? inputEl.value.trim() : null);
                    } else {
                        close(value);
                    }
                };
                btnRow.appendChild(b);
            });

            box.appendChild(btnRow);
            overlay.appendChild(box);
            document.body.appendChild(overlay);

            // Focus input if present
            if (inputEl) setTimeout(() => inputEl.focus(), 80);

            // Enter key submits primary
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    close(inputEl ? null : false);
                }
                if (e.key === 'Enter' && inputEl) {
                    close(inputEl.value.trim());
                }
            });
        });
    }

    // ── PUBLIC API ────────────────────────────────────────────

    /**
     * UIAlert — replaces alert()
     * @param {string} message
     * @param {object} opts  { title, icon, type }
     */
    window.UIAlert = function (message, opts = {}) {
        return buildDialog({
            icon:    opts.icon,
            title:   opts.title || '',
            message,
            type:    opts.type || 'info',
            buttons: [
                { label: opts.confirmText || 'حسناً', value: true, primary: true }
            ]
        });
    };

    /**
     * UIConfirm — replaces confirm()
     * resolves true (confirm) or false (cancel)
     */
    window.UIConfirm = function (message, opts = {}) {
        return buildDialog({
            icon:    opts.icon,
            title:   opts.title || 'تأكيد',
            message,
            type:    opts.type || 'warning',
            buttons: [
                { label: opts.cancelText  || 'إلغاء',  value: false },
                { label: opts.confirmText || 'تأكيد',  value: true,  primary: true }
            ]
        });
    };

    /**
     * UIPrompt — replaces prompt()
     * resolves the entered string or null if cancelled
     */
    window.UIPrompt = function (message, opts = {}) {
        return buildDialog({
            icon:     opts.icon || '✏️',
            title:    opts.title || '',
            message,
            type:     opts.type || 'info',
            inputCfg: {
                placeholder:  opts.placeholder  || '',
                defaultValue: opts.defaultValue || ''
            },
            buttons: [
                { label: opts.cancelText  || 'إلغاء',   value: null },
                { label: opts.confirmText || 'تأكيد',   value: '__input__', primary: true }
            ]
        });
    };

})();
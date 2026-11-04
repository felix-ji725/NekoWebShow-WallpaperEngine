// One document, one WebGL device; each selection owns a disposable model session.
(() => {
    const links = [...document.querySelectorAll('a[data-model][data-config]')];
    const models = new Map(links.map(link => [link.hash.slice(1), link]));
    const cookieName = 'nekoWebShowCharacter';
    const fallback = 'chocola-lolita';
    const loading = document.getElementById('loading');
    const status = document.getElementById('character-status');
    let selection = fallback;
    let revision = 0;
    const translate = key => window.languageManager.get(key);

    function savedSelection() {
        // file:// 下浏览器禁用 cookie，壁纸场景改用 localStorage 记住上次选的角色。
        try {
            const stored = localStorage.getItem(cookieName);
            if (stored) return stored;
        } catch (_) { /* ignore */ }
        try {
            const value = document.cookie.split('; ').find(value => value.startsWith(cookieName + '='));
            return value ? decodeURIComponent(value.slice(cookieName.length + 1)) : '';
        } catch (_) { return ''; }
    }

    async function select(id) {
        const link = models.get(id);
        const model = window.NekoModels[id];
        if (!link || !model) return;
        selection = id;
        const request = ++revision;
        loading.textContent = translate('loading');
        loading.style.visibility = 'visible';
        document.body.dataset.characterState = 'loading';
        status.textContent = '';
        // Capture this selection's layout and touch parameters before starting its session.
        window.NekoCurrentModel = model;
        Object.assign(window.languageManager, {
            characterName: model.character, characterCostume: model.costume, characterVariants: model.variants
        });
        window.languageManager.applyTranslations();
        try {
            await start(link.dataset.model, window.NekoConfigs[link.dataset.config]());
            if (request !== revision) return;
            // Persist only successfully loaded, allow-listed selections.
            try {
                const path = location.pathname.slice(0, location.pathname.lastIndexOf('/') + 1);
                document.cookie = `${cookieName}=${encodeURIComponent(id)}; Max-Age=31536000; Path=${path}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
            } catch (_) { /* Cookie-disabled browsers can still switch models. */ }
            try { localStorage.setItem(cookieName, id); } catch (_) { /* file:// 无 storage 时忽略 */ }
            for (const item of links) {
                if (item === link) item.setAttribute('aria-current', 'true');
                else item.removeAttribute('aria-current');
            }
            window.languageManager.applyTranslations();
            document.body.dataset.character = id;
            document.body.dataset.characterState = 'ready';
            loading.style.visibility = 'hidden';
        } catch (error) {
            if (request !== revision) return;
            // 被后一次点击顶掉的加载会以 abort 结束，不该报错
            if (error && (error.name === 'AbortError' || /abort/i.test(String(error.message || '')))) return;
            console.error('Character load failed:', error);
            document.body.dataset.characterState = 'error';
            loading.style.visibility = 'hidden';
            status.textContent = translate('characterLoadError');
        }
    }

    document.getElementById('topbar').addEventListener('click', event => {
        const link = event.target.closest('a[data-model]');
        if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        if (location.hash === link.hash) select(link.hash.slice(1));
        else location.hash = link.hash;
    });
    // 快速连点会连续触发 select，导致并发加载互相打架：合并成最后一次\n    var selectTimer = null;\n    var pendingSelect = null;\n    function scheduleSelect(id) {\n        pendingSelect = id;\n        if (selectTimer !== null) clearTimeout(selectTimer);\n        selectTimer = setTimeout(function () {\n            selectTimer = null;\n            var next = pendingSelect;\n            pendingSelect = null;\n            if (next) select(next);\n        }, 120);\n    }\n\n    window.addEventListener('hashchange', function () {\n        scheduleSelect(models.has(location.hash.slice(1)) ? location.hash.slice(1) : fallback);\n    });
    window.addEventListener('load', () => {
        const hash = location.hash.slice(1);
        const saved = savedSelection();
        const id = models.has(hash) ? hash : models.has(saved) ? saved : fallback;
        history.replaceState(null, '', '#' + id);
        select(id);
    }, { once: true });
})();

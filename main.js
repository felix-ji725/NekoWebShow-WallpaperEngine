// 最低渲染分辨率（渲染画布高度下限，单位像素）。
// 渲染分辨率在页面加载时确定后无法在运行中改变（驱动里 WebGL 帧缓冲/纹理/顶点缓冲在初始化时一次性烘焙，
// 且缺少干净的设备重建路径），因此预设一个下限，给“放大”留出清晰度余量。按需调大（如 2160）更清晰，但 GPU/显存占用更高。
const RENDER_MIN_HEIGHT = 1440;

let activeCharacterSession = null;

// file:// 下 Chromium 的 fetch() 只接受 http(s)；Wallpaper Engine 给 CEF 传了
// --allow-file-access-from-files，该开关只对 XHR 生效，所以本地壁纸走 XHR 读二进制。
function fetchBinary(url, signal) {
    if (location.protocol !== 'file:') {
        return fetch(url, { signal });
    }
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        const onAbort = () => {
            xhr.abort();
            reject((signal && signal.reason) || new Error('aborted'));
        };
        if (signal) {
            if (signal.aborted) { onAbort(); return; }
            signal.addEventListener('abort', onAbort, { once: true });
        }
        xhr.onload = () => {
            if (signal) signal.removeEventListener('abort', onAbort);
            if (xhr.status === 200 || xhr.status === 0) {
                resolve({ ok: true, status: 200, arrayBuffer: async () => xhr.response });
            } else {
                reject(new Error(`HTTP ${xhr.status} for ${url}`));
            }
        };
        xhr.onerror = () => {
            if (signal) signal.removeEventListener('abort', onAbort);
            reject(new Error(`Failed to load ${url}`));
        };
        xhr.send();
    });
}

function start(zipUrl, reactionConfig) {
    const canvas = document.getElementById('canvas');
    // 加载阶段先铺满整个窗口作为占位，避免默认样式在两侧留白
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.transform = 'none';

    const displaySize = getDisplaySize();
    const renderSize = getRenderSize(displaySize);
    return run(renderSize.width, renderSize.height, zipUrl, reactionConfig);
}

function getViewportSize() {
    let width = window.innerWidth || document.body?.clientWidth || 0;
    let height = window.innerHeight || document.body?.clientHeight || 0;

    if (document.documentElement?.clientHeight && document.documentElement?.clientWidth) {
        height = document.documentElement.clientHeight;
        width = document.documentElement.clientWidth;
    }

    return {
        width: Math.max(1, width),
        height: Math.max(1, height)
    };
}

function getDisplaySize() {
    const viewport = getViewportSize();

    return {
        width: viewport.width,
        height: viewport.height,
        viewportWidth: viewport.width,
        viewportHeight: viewport.height
    };
}

function getRenderSize(displaySize = getDisplaySize()) {
    // 渲染画布按“窗口宽高比 + 最小高度”计算：铺满窗口（拖动不会越出画布被裁），
    // 且不低于 RENDER_MIN_HEIGHT，为放大留出清晰度余量。
    const aspectRatio = displaySize.height > 0 ? displaySize.width / displaySize.height : 16 / 9;
    const renderHeight = Math.max(Math.ceil(displaySize.height), RENDER_MIN_HEIGHT);
    const renderWidth = Math.ceil(renderHeight * aspectRatio);

    return {
        width: renderWidth,
        height: renderHeight
    };
}

function applyCanvasLayout(canvas, displaySize = getDisplaySize()) {
    if (!canvas) {
        return;
    }

    const renderWidth = canvas.width || 0;
    const renderHeight = canvas.height || 0;

    // 渲染分辨率固定。这里用桌面壁纸“缩放并裁切(cover)”的思路：
    // 画布始终铺满整个窗口（最窄的一边对齐，另一边超出的部分被裁掉），
    // 所以无论窗口是横向、方形还是竖向，人物都能被拖到窗口任意位置，不会被画布边界截断。
    if (!renderWidth || !renderHeight) {
        canvas.style.position = 'fixed';
        canvas.style.top = '0';
        canvas.style.left = '0';
        canvas.style.width = '100%';
        canvas.style.height = '100%';
        canvas.style.transform = 'none';
        return;
    }

    const vw = displaySize.viewportWidth;
    const vh = displaySize.viewportHeight;
    const scale = Math.max(vw / renderWidth, vh / renderHeight);
    const cw = Math.ceil(renderWidth * scale);
    const ch = Math.ceil(renderHeight * scale);

    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = `${cw}px`;
    canvas.style.height = `${ch}px`;
    canvas.style.transform = `translate(${Math.floor((vw - cw) / 2)}px, ${Math.floor((vh - ch) / 2)}px)`;
}

function getHeightRatio(height) {
    const height1 = 600;
    const ratio1 = 0.3;
    const height2 = 1600;
    const ratio2 = 0.9;
    const m = (ratio2 - ratio1) / (height2 - height1);
    const b = ratio1 - m * height1;
    return Math.max(0.05, m * height + b);
}

// 最后已知的鼠标位置：换皮肤/开双人后要立刻让角色看向鼠标，不能等下一次 mousemove
const lastPointer = { x: null, y: null };
window.addEventListener('mousemove', (ev) => {
    lastPointer.x = ev.clientX;
    lastPointer.y = ev.clientY;
}, { passive: true });
async function run(width, height, zipUrl, reactionConfig) {
    // Render directly to the visible canvas. Set its size before creating the
    // WebGL device: resizing afterwards would reset the drawing buffer/state.
    const canvas = document.getElementById('canvas');
    activeCharacterSession?.dispose();

    // Never resize the initialized WebGL drawing buffer during a model switch.
    if (!EmotePlayer.device) {
        canvas.width = width;
        canvas.height = height;
    }
    EmotePlayer.setRenderCanvas(canvas);
    // 应用用户在“设置”里选择的帧率限制（默认 60，可设无上限）
    if (window.NekoUI && typeof window.NekoUI.applyFps === 'function') {
        window.NekoUI.applyFps();
    }
    const player = new EmotePlayer(canvas);
    window.__nekoPlayer = player;
    const controller = new AbortController();
    const { signal } = controller;
    const timers = new Map();
    const listen = (target, type, callback, options = {}) => target.addEventListener(
        type, callback, { ...(typeof options === 'boolean' ? { capture: options } : options), signal });
    const later = (callback, ms, onCancel = () => {}) => {
        const id = window.setTimeout(() => {
            timers.delete(id);
            if (!signal.aborted) callback();
        }, ms);
        timers.set(id, onCancel);
        return id;
    };
    const cancelLater = id => { window.clearTimeout(id); timers.delete(id); };
    const session = { dispose() {
        if (signal.aborted) return;
        controller.abort();
        for (const [id, resolve] of timers) { window.clearTimeout(id); resolve(); }
        timers.clear();
        if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
        lipSync.dispose();
        canvas.onclick = canvas.onmousemove = null;
        // 先放掉第二个模型，但不要 destroy()（那会连共享设备一起释放）
        if (duoPlayer) {
            try { duoPlayer.unloadData(); } catch (e) { /* ignore */ }
            duoPlayer = null;
        }
        if (duoLipSync) {
            try { duoLipSync.dispose(); } catch (e) { /* ignore */ }
            duoLipSync = null;
        }
        player.destroy();
    }};
    activeCharacterSession = session;
    const baseCoord = player.coord.slice();

    // 用户自定义偏移（解锁后拖动）与缩放倍率（鼠标滚轮），在响应式布局之上叠加
    let userOffsetX = 0;
    let userOffsetY = 0;
    // 角色位置也跨模型/跨重启记忆：换皮肤不该把人物甩回屏幕中间
    try {
        const savedPos = JSON.parse(localStorage.getItem('nekoWebShowCharPos') || 'null');
        if (savedPos && Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y)) {
            userOffsetX = savedPos.x;
            userOffsetY = savedPos.y;
        }
    } catch (e) { /* file:// 下可能无 storage */ }
    let userScale = 1;
    // 设置里的「角色大小」跨模型、跨重启记忆
    try {
        const savedScale = parseFloat(localStorage.getItem('nekoWebShowCharScale'));
        if (Number.isFinite(savedScale) && savedScale >= 0.25 && savedScale <= 5) {
            userScale = savedScale;
        }
    } catch (e) { /* file:// 下可能无 storage */ }
    let transformPending = false;
    let layoutScale = 1;
    let layoutPlayerScale = 1;
    let modelPixelRatio = 1;
    let defaultOffsetY = 0;
    const presentation = window.NekoCurrentModel?.presentation || {};

    // ---------- 双人模式 ----------
    // 设备是共享的（EmoteDevice.playerList），第二个 player 注册进去就会一起绘制。
    // 注意不能用 destroy()——它会 releaseDevice() 把主 player 的设备也拆掉，只能 unloadData()。
    let duoPlayer = null;
    let duoId = null;
    let duoActive = false;            // true 时菜单/拖动/缩放作用于角色二
    let duoReactionConfig = null;
    let duoLipSync = null;
    let duoBusy = false;            // 角色二换装进行中
    let duoPending = null;          // 期间又点了一个，排队取最后一次
    let duoScaleMul = 1;
    let duoOffsetX = 0;
    let duoOffsetY = 0;
    let duoEnabled = false;
    try {
        duoEnabled = localStorage.getItem('nekoWebShowDuo') === '1';
        duoId = localStorage.getItem('nekoWebShowDuoId') || null;
        const ds = parseFloat(localStorage.getItem('nekoWebShowDuoScale'));
        if (Number.isFinite(ds) && ds >= 0.25 && ds <= 5) duoScaleMul = ds;
        const dp = JSON.parse(localStorage.getItem('nekoWebShowDuoPos') || 'null');
        if (dp && Number.isFinite(dp.x) && Number.isFinite(dp.y)) {
            duoOffsetX = dp.x;
            duoOffsetY = dp.y;
        }
        duoActive = duoEnabled && localStorage.getItem('nekoWebShowDuoSlot') === '2';
    } catch (e) { /* ignore */ }

    // 切角色前先把角色二卸掉：堆里同时只有一个模型，避免反复切换把 256MB 撑爆
    if (duoPlayer) {
        try { duoPlayer.unloadData(); } catch (e) { /* ignore */ }
        duoPlayer = null;
        if (duoLipSync) {
            try { duoLipSync.dispose(); } catch (e) { /* ignore */ }
            duoLipSync = null;
        }
    }

    function applyResponsivePlayerLayout() {
        const displaySize = getDisplaySize();
        const renderWidth = canvas.width;
        const renderHeight = canvas.height;

        applyCanvasLayout(canvas, displaySize);

        // 渲染分辨率固定：1 屏幕像素 = 1/scale 渲染单位。
        // 人物屏幕尺寸保持为 getHeightRatio(视口高度)，与之前的一致；userScale 为滚轮缩放倍率。
        const scale = Math.max(
            displaySize.viewportWidth / renderWidth,
            displaySize.viewportHeight / renderHeight
        );

        layoutScale = scale;
        layoutPlayerScale = getHeightRatio(displaySize.viewportHeight) / scale;
        modelPixelRatio = renderWidth / Math.ceil(renderWidth * scale);
        player.scale = layoutPlayerScale * userScale;
        transformPending = false;

        // Use the visible thigh cutoff, not the PSB's export/texture bounds.
        // Some models have shorter drawings; keep their cut edge below the viewport.
        defaultOffsetY = -40 / scale;
        const cutoff = presentation.cutoffY;
        if (Number.isFinite(cutoff)) {
            const rect = canvas.getBoundingClientRect();
            const floor = (displaySize.viewportHeight + 40 - rect.top) / scale - renderHeight / 2;
            defaultOffsetY = Math.max(defaultOffsetY, floor - cutoff * layoutPlayerScale - baseCoord[1]);
        }

        const c = player.coord;
        c[0] = baseCoord[0] + userOffsetX;
        c[1] = baseCoord[1] + defaultOffsetY + userOffsetY;
        player.coord = c;

        if (duoPlayer) {
            duoPlayer.scale = layoutPlayerScale * duoScaleMul;
            const d = duoPlayer.coord;
            d[0] = baseCoord[0] + duoOffsetX;
            d[1] = baseCoord[1] + defaultOffsetY + duoOffsetY;
            duoPlayer.coord = d;
        }

        if (EmotePlayer.device) {
            EmotePlayer.device.invalidateAnimation();
        }
    }

    applyResponsivePlayerLayout();
    player.diffTimelineSlot4 = '差分用_waiting_loop';

    let resizeFrame = null;
    listen(window, 'resize', () => {
        if (resizeFrame !== null) {
            cancelAnimationFrame(resizeFrame);
        }
        resizeFrame = requestAnimationFrame(() => {
            resizeFrame = null;
            applyResponsivePlayerLayout();
        });
    });

    const sleep = (ms) => signal.aborted ? Promise.resolve() : new Promise(resolve => later(resolve, ms, resolve));
    const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

    function pickSupported(labels, supportedLabels) {
        if (!supportedLabels?.length) {
            return '';
        }
        const supported = labels.filter(label => supportedLabels.includes(label));
        return supported.length ? supported[Math.floor(Math.random() * supported.length)] : '';
    }

    function createLipSync(target) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        const decodedAudioCache = new Map();
        let audioContext = null;
        let rafId = null;
        let activeSource = null;
        let fallbackTimer = null;
        let fallbackAudio = null;

        function stop() {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
                rafId = null;
            }
            if (fallbackTimer !== null) {
                clearInterval(fallbackTimer);
                fallbackTimer = null;
            }
            if (activeSource) {
                try {
                    activeSource.stop();
                } catch (error) {
                    // The source may already be stopped by natural playback end.
                }
                activeSource = null;
            }
            if (fallbackAudio) { fallbackAudio.pause(); fallbackAudio.removeAttribute('src'); fallbackAudio.load(); fallbackAudio = null; }
            if (!signal.aborted) target.setVariableDiff('lipSync', 'face_talk', 0, 120, -1);
        }

        async function getDecodedAudio(url) {
            if (!AudioContextClass) {
                return null;
            }
            if (!audioContext) {
                audioContext = new AudioContextClass();
            }
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }
            if (decodedAudioCache.has(url)) {
                return decodedAudioCache.get(url);
            }

            const response = await fetchBinary(url, signal);
            if (!response.ok) {
                throw new Error(`Failed to load audio ${url}`);
            }
            const buffer = await response.arrayBuffer();
            const decoded = await audioContext.decodeAudioData(buffer.slice(0));
            signal.throwIfAborted();
            decodedAudioCache.set(url, decoded);
            return decoded;
        }

        function driveMouthFromAnalyser(analyser) {
            const data = new Uint8Array(analyser.fftSize);
            let smoothed = 0;
            const talkMax = target.variableList.find(v => v.label === 'face_talk')?.maxValue || 5;

            const update = () => {
                analyser.getByteTimeDomainData(data);
                let sum = 0;
                for (const sample of data) {
                    const centered = (sample - 128) / 128;
                    sum += centered * centered;
                }
                const rms = Math.sqrt(sum / data.length);
                const talk = Math.min(talkMax, Math.max(0, (rms - 0.015) * 50));
                smoothed = smoothed * 0.62 + talk * 0.38;
                target.setVariableDiff('lipSync', 'face_talk', smoothed, 70, -1);
                rafId = requestAnimationFrame(update);
            };

            update();
        }

        function driveMouthFallback(durationMs) {
            const startedAt = performance.now();
            const talkMax = target.variableList.find(v => v.label === 'face_talk')?.maxValue || 5;
            fallbackTimer = setInterval(() => {
                const elapsed = performance.now() - startedAt;
                if (elapsed > durationMs) {
                    stop();
                    return;
                }
                const wave = Math.sin(elapsed / 55) * 0.5 + 0.5;
                const jitter = Math.random() * 2;
                target.setVariableDiff('lipSync', 'face_talk', Math.min(talkMax, wave * 3 + jitter), 80, -1);
            }, 90);
        }

        async function play(url) {
            stop();
            if (!url) {
                return { durationMs: 0, ended: Promise.resolve() };
            }
            // 静音开关：开启后不播放角色声音（嘴型仍由动作变量驱动）
            if (window.NekoUI && typeof window.NekoUI.isMuted === 'function' && window.NekoUI.isMuted()) {
                return { durationMs: 0, ended: Promise.resolve() };
            }

            if (!AudioContextClass) {
                const audio = new Audio(url);
                fallbackAudio = audio;
                const metadataLoaded = new Promise(resolve => {
                    audio.addEventListener('loadedmetadata', resolve, { once: true });
                    audio.addEventListener('error', resolve, { once: true });
                    signal.addEventListener('abort', resolve, { once: true });
                });
                await metadataLoaded;
                signal.throwIfAborted();
                const durationMs = Number.isFinite(audio.duration) ? audio.duration * 1000 : 1200;
                driveMouthFallback(durationMs);
                const ended = new Promise(resolve => {
                    audio.addEventListener('ended', resolve, { once: true });
                    audio.addEventListener('error', resolve, { once: true });
                    signal.addEventListener('abort', resolve, { once: true });
                }).finally(stop);
                audio.play().catch(error => console.error('Audio playback error:', error));
                return { durationMs, ended, startedAt: performance.now() };
            }

            const decoded = await getDecodedAudio(url);
            signal.throwIfAborted();
            const source = audioContext.createBufferSource();
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 512;
            analyser.smoothingTimeConstant = 0.34;
            source.buffer = decoded;
            source.connect(analyser);
            analyser.connect(audioContext.destination);
            activeSource = source;
            driveMouthFromAnalyser(analyser);

            const ended = new Promise(resolve => {
                source.onended = resolve;
            }).finally(stop);
            source.start(0);
            return { durationMs: decoded.duration * 1000, ended, startedAt: performance.now() };
        }

        return { play, stop, dispose() {
            stop();
            decodedAudioCache.clear();
            if (audioContext) audioContext.close().catch(() => {});
        }};
    }

    const lipSync = createLipSync(player);

    try {
        let zipData = null;
        let files = null;
        let modelData = null;

        try {
            const resp = await fetchBinary(zipUrl, signal);
            if (!resp.ok) {
                throw new Error(`Failed to load ${zipUrl}`);
            }
            zipData = new Uint8Array(await resp.arrayBuffer());
            signal.throwIfAborted();
            files = await new Promise((resolve, reject) => {
                const abort = () => { terminate(); reject(signal.reason); };
                const terminate = fflate.unzip(zipData, (err, unzipped) => {
                    signal.removeEventListener('abort', abort);
                    if (err) {
                        reject(err);
                    } else {
                        resolve(unzipped);
                    }
                });
                signal.addEventListener('abort', abort, { once: true });
            });

            zipData = null;

            const binFileName = Object.keys(files).find(name => name.endsWith('.psb'));
            if (!binFileName) {
                throw new Error('No .psb file found in ZIP');
            }

            modelData = files[binFileName];
            files = null;

            signal.throwIfAborted();
            player.loadData(modelData);
            // Retained A poses lost the hand-authored interaction markers in conversion.
            player.setPresentation(presentation);
            applyResponsivePlayerLayout();
            if (duoEnabled) {
                setDuo(true);
            }
        } finally {
            modelData = null;
            files = null;
            zipData = null;
        }


        const mainTimelineLabels = player.mainTimelineLabels;
        const diffTimelineLabels = player.diffTimelineLabels;
        const variableLabels = player.variableList.map(variable => variable.label);

        function safeMainTimeline(label) {
            return !label || mainTimelineLabels.includes(label) ? label : '';
        }

        function safeDiffTimeline(label) {
            return !label || diffTimelineLabels.includes(label) ? label : '';
        }

        function touchExtraDiff(zone) {
            const candidates = {
                bust: ['はじらい2', 'わなわな', '戸惑い'],
                eye: ['びっくり2', 'うつむき', '疑問'],
                face: ['にっこり2', 'ごきげん', 'うん'],
                head: ['うんうん', 'ごきげん', 'にっこり'],
                pant: ['戸惑い', 'ひく', 'わなわな']
            };
            return pickSupported(candidates[zone] || [], diffTimelineLabels);
        }

        function cloneVariablesForPlayback(config, phase) {
            const variables = (config.variables || [])
                .filter(variable => variableLabels.includes(variable.name))
                .map(variable => {
                    const result = { ...variable };
                    if (phase === 'reaction' && config.audio && result.name === 'face_talk') {
                        // The analyser supplies opening as a diff; a nonzero base leaves the mouth open in pauses.
                        result.value = 0;
                        result.duration = Math.min(result.duration || 180, 220);
                    }
                    return result;
                });

            if (
                phase === 'reaction' &&
                config.audio &&
                variableLabels.includes('face_talk') &&
                !variables.some(variable => variable.name === 'face_talk')
            ) {
                variables.push({ name: 'face_talk', value: 0, duration: 120 });
            }

            return variables;
        }

        function buildPlaybackConfig(config = {}, zone = '', phase = 'reaction') {
            const playback = { ...config };
            playback.mainTimelineLabel = safeMainTimeline(playback.mainTimelineLabel || '');
            playback.variables = cloneVariablesForPlayback(playback, phase);

            if (!Array.isArray(playback.diffTimelineSlots)) {
                for (let i = 1; i <= 6; i += 1) {
                    const key = `diffTimelineSlot${i}`;
                    if (hasOwn(playback, key)) {
                        playback[key] = safeDiffTimeline(playback[key] || '');
                    }
                }
                if (phase === 'reaction' && !hasOwn(playback, 'diffTimelineSlot3')) {
                    const extra = touchExtraDiff(zone);
                    if (extra) {
                        playback.diffTimelineSlot3 = extra;
                    }
                }
                if (phase === 'recovery' && !hasOwn(playback, 'diffTimelineSlot3')) {
                    playback.diffTimelineSlot3 = '';
                }
            } else {
                playback.diffTimelineSlots = playback.diffTimelineSlots.map(safeDiffTimeline);
            }

            return playback;
        }

        function applyDiffTimelineConfig(config, target = player) {
            if (Array.isArray(config.diffTimelineSlots)) {
                for (let i = 1; i <= 6; i += 1) {
                    target[`diffTimelineSlot${i}`] = config.diffTimelineSlots[i - 1] || '';
                }
                return;
            }

            for (let i = 1; i <= 6; i += 1) {
                const key = `diffTimelineSlot${i}`;
                if (hasOwn(config, key)) {
                    target[key] = config[key] || '';
                }
            }
        }

        function applyVariables(config, target = player) {
            for (const variable of config.variables || []) {
                const duration = variable.duration ?? 0;
                const easing = variable.easing ?? variable.delay ?? 0;
                target.setVariable(variable.name, variable.value, duration, easing);
            }
        }

        function applyReactionConfig(config, options = {}, target = player) {
            if (signal.aborted) return Promise.resolve({ durationMs: 0 });
            const playAudio = options.playAudio !== false;
            if (hasOwn(config, 'mainTimelineLabel')) {
                target.mainTimelineLabel = config.mainTimelineLabel || '';
            }
            applyDiffTimelineConfig(config, target);
            applyVariables(config, target);

            if (playAudio && config.audio) {
                const sync = (target === duoPlayer && duoLipSync) ? duoLipSync : lipSync;
                return sync.play(config.audio);
            }
            return Promise.resolve({ durationMs: 0, ended: Promise.resolve() });
        }

        function getTimelineWaitMs(config, target = player) {
            if (!config.mainTimelineLabel) {
                return 0;
            }
            const ms = target.getTimelineTotalMilliSeconds(config.mainTimelineLabel);
            return Number.isFinite(ms) ? ms : 0;
        }

        async function waitForReaction(selected, reaction, audioPlaybackPromise, startedAt, target = player) {
            let audioDuration = 0;
            let audioEnded = Promise.resolve();
            let audioStartedAt = performance.now();

            try {
                const audioPlayback = await audioPlaybackPromise;
                audioDuration = audioPlayback.durationMs || 0;
                audioEnded = audioPlayback.ended || Promise.resolve();
                audioStartedAt = audioPlayback.startedAt || performance.now();
            } catch (error) {
                console.error('Audio playback error:', error);
            }

            const configuredDuration = selected.duration || 0;
            const timelineDuration = getTimelineWaitMs(reaction, target);
            const actionDuration = Math.max(configuredDuration, timelineDuration, 650);
            const actionRemainingMs = Math.max(0, actionDuration - (performance.now() - startedAt));
            const audioElapsedMs = performance.now() - audioStartedAt;
            const audioRemainingMs = Math.max(0, audioDuration - audioElapsedMs);
            const remainingMs = Math.max(actionRemainingMs, audioRemainingMs);
            await sleep(remainingMs);

            if (audioDuration > 0) {
                await Promise.race([audioEnded, sleep(250)]);
            }
        }

        async function playSelectedReaction(selected, zone, target = player, silent = false) {
            const startedAt = performance.now();
            const reaction = buildPlaybackConfig(selected.reaction, zone, 'reaction');
            const recovery = buildPlaybackConfig(selected.recovery, zone, 'recovery');
            const timers = [];
            try {
                const audioPlaybackPromise = applyReactionConfig(reaction, { playAudio: !silent }, target);
                // Start the mid-line changes only once fetching/decoding has finished.
                await audioPlaybackPromise;
                if (signal.aborted) return;
                for (const beat of selected.beats || []) {
                    if (!Number.isFinite(beat.at) || beat.at < 0 || beat.at >= selected.duration) continue;
                    timers.push(later(() => {
                        applyReactionConfig(buildPlaybackConfig(beat, zone, 'beat'), { playAudio: false }, target);
                    }, beat.at));
                }
                await waitForReaction(selected, reaction, audioPlaybackPromise, startedAt, target);
            } finally {
                timers.forEach(cancelLater);
                const syncToStop = (target === duoPlayer && duoLipSync) ? duoLipSync : lipSync;
                syncToStop.stop();
                applyReactionConfig(recovery, { playAudio: false }, target);
            }
            await sleep(selected.recoveryDuration ?? 180);
        }

        // 注视增益：把"鼠标到眼睛的距离"归一化到 [-1,1]，再乘变量自己的量程。
        // 原实现直接 offset/3，但 face_eye_* 的量程只有 ±30，偏移超过 90px 就顶死，
        // 屏幕上离角色稍远的地方全都不跟手。改成以屏幕短边为参考距离。
        const gazeRange = (label, fallback) => {
            try {
                const v = player.variableList.find(x => x.label === label);
                if (v && Number.isFinite(v.minValue) && Number.isFinite(v.maxValue)) {
                    const r = Math.max(Math.abs(v.minValue), Math.abs(v.maxValue));
                    if (r > 0) {
                        return r;
                    }
                }
            } catch (e) { /* 读不到就用回落值 */ }
            return fallback;
        };
        const clampUnit = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

        const eyetracking_reaction = (ev) => {
            const base = Math.max(240, Math.min(window.innerWidth, window.innerHeight));
            // 两个模型各自用自己的眼睛锚点算偏移，这样站哪边都会看向鼠标
            const targets = duoPlayer ? [player, duoPlayer] : [player];
            targets.forEach((target) => {
                const eyePosition = target.getMarkerPosition('eye');
                if (!eyePosition) {
                    return;
                }
                const mouseOffsetX = ev.clientX - eyePosition.clientX;
                const mouseOffsetY = ev.clientY - eyePosition.clientY;
                const distanceSquared = mouseOffsetX ** 2 + mouseOffsetY ** 2;
                // 眼睛最先动、头次之、身体最后跟上，越往后需要越远的距离才打满
                const nxEye = clampUnit(mouseOffsetX / (base * 0.35));
                const nyEye = clampUnit(mouseOffsetY / (base * 0.35));
                const nxHead = clampUnit(mouseOffsetX / (base * 0.55));
                const nyHead = clampUnit(mouseOffsetY / (base * 0.55));
                const nxBody = clampUnit(mouseOffsetX / (base * 0.75));
                const nyBody = clampUnit(mouseOffsetY / (base * 0.75));


                target.setVariableDiff('eyetrack', 'face_eye_LR', nxEye * gazeRange('face_eye_LR', 30), 500, -1);
                target.setVariableDiff('eyetrack', 'face_eye_UD', nyEye * gazeRange('face_eye_UD', 30), 500, -1);

                if (distanceSquared > 60 * 60) {
                    target.setVariableDiff('eyetrack', 'head_slant', nxHead * gazeRange('head_slant', 30), 1000, -1);
                    target.setVariableDiff('eyetrack', 'head_LR', nxHead * gazeRange('head_LR', 30), 1000, -1);
                    target.setVariableDiff('eyetrack', 'head_UD', nyHead * gazeRange('head_UD', 30), 1000, -1);
                }

                if (distanceSquared > 120 * 120) {
                    target.setVariableDiff('eyetrack', 'body_slant', nxBody * gazeRange('body_slant', 30), 2000, -1);
                    target.setVariableDiff('eyetrack', 'body_LR', nxBody * gazeRange('body_LR', 30), 2000, -1);
                    target.setVariableDiff('eyetrack', 'body_UD', nyBody * gazeRange('body_UD', 30), 2000, -1);
                }
            });
        };

        // ---------- 鼠标注视"影子"平滑过渡 ----------
        // 鼠标在 canvas 上时直接注视鼠标本体（完全跟手）；鼠标离开 canvas（切到其他窗口）
        // 时记录离开点，重新进入时让注视沿"影子"路径用 1 秒从离开点 ease-out 追到当前
        // 鼠标位置，过渡中影子终点随鼠标实时更新。首帧影子=离开点=角色当前注视位置，
        // 无跳变，从而消除重新进入时的抽搐，且正常移动不被插值、保持跟手。
        const SHADOW_TRANSITION_MS = 1000;
        let lastMouseX = lastPointer.x, lastMouseY = lastPointer.y;
        let leaveX = null, leaveY = null;
        let pendingGaze = null;
        // 设置里的「跟随鼠标」开关：缓存成局部变量，避免每帧读 localStorage
        let gazeEnabled = true;
        try { gazeEnabled = localStorage.getItem('nekoWebShowGaze') !== '0'; } catch (e) { /* ignore */ }
        let shadowState = null;
        const runShadowStep = (now) => {
            const t = Math.max(0, Math.min(1, (now - shadowState.startTime) / SHADOW_TRANSITION_MS));
            const e = 1 - Math.pow(1 - t, 3);
            const sx = shadowState.fromX + (shadowState.toX - shadowState.fromX) * e;
            const sy = shadowState.fromY + (shadowState.toY - shadowState.fromY) * e;
            shadowState.curX = sx;
            shadowState.curY = sy;
            eyetracking_reaction({ clientX: sx, clientY: sy });
            if (t >= 1) shadowState = null;
        };
        // 注视要跟到整个窗口：控制面板盖在 canvas 上，只听 canvas 的话
        // 鼠标一移到面板上角色就不动了（面板 z-index 比画布高）。
        listen(document, 'mouseleave', () => {
            if (shadowState) {
                leaveX = shadowState.curX;
                leaveY = shadowState.curY;
                shadowState = null;
            } else if (lastMouseX !== null) {
                leaveX = lastMouseX;
                leaveY = lastMouseY;
            }
        });
        listen(document, 'mouseenter', (ev) => {
            if (!gazeEnabled || leaveX === null) {
                return;
            }
            shadowState = {
                fromX: leaveX, fromY: leaveY,
                toX: ev.clientX, toY: ev.clientY,
                curX: leaveX, curY: leaveY,
                startTime: performance.now(),
            };
            leaveX = null;
            leaveY = null;
            pendingGaze = null;
        });
        listen(window, 'mousemove', (ev) => {
            lastMouseX = ev.clientX;
            lastMouseY = ev.clientY;
            if (shadowState) {
                shadowState.toX = ev.clientX;
                shadowState.toY = ev.clientY;
                return;
            }
            pendingGaze = { clientX: ev.clientX, clientY: ev.clientY };
        }, { passive: true });
        listen(canvas, 'touchmove', (ev) => {
            shadowState = null;
            pendingGaze = { clientX: ev.touches[0].clientX, clientY: ev.touches[0].clientY };
            ev.preventDefault();
        }, false);

        // 每个角色各自上锁：同一个角色同时只演一个动作，但两个角色可以同时演
        const busyTargets = new Set();
        const touch_reaction = (ev) => {
            flushUserTransform();
            const canvasRect = canvas.getBoundingClientRect();

            const tryReactOn = (target, config) => {
                if (!config || busyTargets.has(target)) return false;
                const regions = target.getTouchRegions(canvasRect);
                const tryReact = (zone, reactions) => {
                    if (!EmotePlayer.pointInRegion(regions[zone], ev.clientX, ev.clientY) || !reactions?.length) {
                        return false;
                    }
                    busyTargets.add(target);
                    const selected = reactions[Math.floor(Math.random() * reactions.length)];
                    playSelectedReaction(selected, zone, target)
                        .catch(error => { if (!signal.aborted) console.error('Touch reaction error:', error); })
                        .finally(() => {
                            busyTargets.delete(target);
                        });
                    return true;
                };
                return tryReact('bust', config.bust) ||
                    tryReact('eye', config.eye) ||
                    tryReact('face', config.face) ||
                    tryReact('head', config.head) ||
                    tryReact('pant', config.pant);
            };

            // 角色二画在上层，先测它；都点不到就不响应
            if (duoPlayer && tryReactOn(duoPlayer, duoReactionConfig)) {
                return;
            }
            tryReactOn(player, reactionConfig);
        };

        // ---------- 角色拖动与缩放（未锁定时生效） ----------
        const isLocked = () => {
            return !!(window.NekoUI && typeof window.NekoUI.isLocked === 'function' && window.NekoUI.isLocked());
        };

        const dragState = { active: false, moved: false, startX: 0, startY: 0 };

        function flushUserTransform() {
            if (!transformPending) return;
            transformPending = false;
            player.scale = layoutPlayerScale * userScale;
            player.coord = [baseCoord[0] + userOffsetX, baseCoord[1] + defaultOffsetY + userOffsetY];
            if (duoPlayer) {
                duoPlayer.scale = layoutPlayerScale * duoScaleMul;
                duoPlayer.coord = [baseCoord[0] + duoOffsetX, baseCoord[1] + defaultOffsetY + duoOffsetY];
            }
        }

        // Consume the latest input once per rendered frame, including at 30 FPS.
        // Idle frames do no gaze work; the one-second return transition shares
        // the renderer's clock instead of running a second animation loop.
        if (lastPointer.x !== null && gazeEnabled) {
            pendingGaze = { clientX: lastPointer.x, clientY: lastPointer.y };
        }

        player.onUpdate = (timeStamp) => {
            flushUserTransform();
            if (shadowState) {
                runShadowStep(timeStamp);
            } else if (pendingGaze) {
                const gaze = pendingGaze;
                pendingGaze = null;
                if (gazeEnabled) {
                    eyetracking_reaction(gaze);
                }
            }
        };

        listen(canvas, 'mousedown', (ev) => {
            if (ev.button !== 0) return;         // 仅响应左键
            dragState.moved = false;
            if (isLocked()) return;              // 锁定后禁止拖动
            // 双人模式下拖的是"当前选中"的那个角色
            dragState.slot = (duoPlayer && duoActive) ? 2 : 1;
            dragState.active = true;
            dragState.startX = ev.clientX;
            dragState.startY = ev.clientY;
        });

        listen(window, 'mousemove', (ev) => {
            if (!dragState.active) return;
            const dx = ev.clientX - dragState.startX;
            const dy = ev.clientY - dragState.startY;
            if (!dragState.moved && (Math.abs(dx) + Math.abs(dy)) > 3) {
                dragState.moved = true;
            }
            if (!dragState.moved) return;
            const mp = modelPixelRatio;
            if (dragState.slot === 2) {
                duoOffsetX += dx * mp;
                duoOffsetY += dy * mp;
            } else {
                userOffsetX += dx * mp;
                userOffsetY += dy * mp;
            }
            dragState.startX = ev.clientX;
            dragState.startY = ev.clientY;
            transformPending = true;
        });

        const endDrag = () => {
            if (!dragState.active) return;
            dragState.active = false;
            flushUserTransform();
            try {
                if (dragState.slot === 2) {
                    localStorage.setItem('nekoWebShowDuoPos', JSON.stringify({ x: duoOffsetX, y: duoOffsetY }));
                } else {
                    localStorage.setItem('nekoWebShowCharPos', JSON.stringify({ x: userOffsetX, y: userOffsetY }));
                }
            } catch (e) { /* ignore */ }
        };
        listen(window, 'mouseup', endDrag);
        listen(window, 'blur', endDrag);

        listen(canvas, 'wheel', (ev) => {
            if (isLocked()) return;              // 锁定后禁止缩放
            ev.preventDefault();
            const factor = Math.exp(-ev.deltaY * 0.0012);
            userScale = Math.round(Math.max(0.25, Math.min(5, userScale * factor)) * 10000) / 10000;
            try { localStorage.setItem('nekoWebShowCharScale', userScale); } catch (e) {}
            transformPending = true;
        }, { passive: false });

        // 重设角色位置/大小：把被拖到屏外找不到的角色拉回默认位置（设置里“重设角色位置”按钮触发）
        listen(document, 'neko:reset-character', () => {
            userOffsetX = 0;
            userOffsetY = 0;
            userScale = 1;
            duoOffsetX = 0;
            duoOffsetY = 0;
            duoScaleMul = 1;
            try {
                localStorage.setItem('nekoWebShowCharScale', 1);
                localStorage.removeItem('nekoWebShowCharPos');
                localStorage.setItem('nekoWebShowDuoScale', 1);
                localStorage.removeItem('nekoWebShowDuoPos');
            } catch (e) {}
            applyResponsivePlayerLayout();
        });

        // 设置里「角色大小」的 ± 按钮（WE 不转发 wheel，滚轮缩放在壁纸里用不了）
        listen(document, 'neko:scale-character', (ev) => {
            const next = ev && ev.detail ? Number(ev.detail.scale) : NaN;
            if (!Number.isFinite(next)) return;
            const rounded = Math.round(Math.max(0.25, Math.min(5, next)) * 10000) / 10000;
            if (Number(ev.detail.slot) === 2) {
                duoScaleMul = rounded;
                try { localStorage.setItem('nekoWebShowDuoScale', duoScaleMul); } catch (e) { /* ignore */ }
            } else {
                userScale = rounded;
                try { localStorage.setItem('nekoWebShowCharScale', userScale); } catch (e) { /* ignore */ }
            }
            applyResponsivePlayerLayout();
        });

        // ---------- 双人模式：加载第二个模型 ----------
        // 从菜单链接里找到该模型的配置键，取出它的动作配置（点击反应要用）
        function reactionConfigFor(id) {
            const link = document.querySelector('#topbar a[data-model][href="#' + id + '"]');
            const key = link && link.dataset.config;
            if (key && window.NekoConfigs && typeof window.NekoConfigs[key] === 'function') {
                try { return window.NekoConfigs[key](); } catch (e) { /* ignore */ }
            }
            return null;
        }

    async function createDuoPlayer(id) {
        const url = `./data/${id}.pure.psb.zip`;
        const resp = await fetchBinary(url, signal);
        const zipData = new Uint8Array(await resp.arrayBuffer());
        const files = await new Promise((resolve, reject) => {
            fflate.unzip(zipData, (err, unzipped) => (err ? reject(err) : resolve(unzipped)));
        });
        const binName = Object.keys(files).find((name) => name.endsWith('.psb'));
        if (!binName) throw new Error('duo: no psb in ' + id);
        const partner = new EmotePlayer(canvas);
        try {
            partner.loadData(files[binName]);
            partner.setPresentation(window.NekoModels?.[id]?.presentation || {});
            // 和角色一保持一致：待机呼吸/轻微摆动是这条差分时间线驱动的，漏了就不动
            partner.diffTimelineSlot4 = '差分用_waiting_loop';
            partner.scale = layoutPlayerScale * duoScaleMul;
            partner.coord = [baseCoord[0] + duoOffsetX, baseCoord[1] + defaultOffsetY + duoOffsetY];
        } catch (error) {
            try { partner.unloadData(); } catch (e) { /* ignore */ }
            throw error;
        }
        return partner;
    }

    // 把新 player 正式接管为「角色二」：配置、口型通道、存储一起换
    function commitDuoPlayer(partner, id) {
        duoReactionConfig = reactionConfigFor(id);
        if (duoLipSync) {
            try { duoLipSync.dispose(); } catch (e) { /* ignore */ }
            duoLipSync = null;
        }
        duoLipSync = createLipSync(partner);
        duoPlayer = partner;
        duoId = id;
        try { localStorage.setItem('nekoWebShowDuoId', id); } catch (e) { /* ignore */ }
    }

    async function setDuo(on) {
        duoEnabled = !!on;
        try { localStorage.setItem('nekoWebShowDuo', duoEnabled ? '1' : '0'); } catch (e) { /* ignore */ }
        if (!duoEnabled) {
            duoActive = false;
            try { localStorage.setItem('nekoWebShowDuoSlot', '1'); } catch (e) { /* ignore */ }
            document.querySelectorAll('#topbar a.duo-current').forEach((a) => a.classList.remove('duo-current'));
            if (duoPlayer) {
                try { duoPlayer.unloadData(); } catch (e) { /* ignore */ }
                duoPlayer = null;
                duoReactionConfig = null;
                if (duoLipSync) {
                    try { duoLipSync.dispose(); } catch (e) { /* ignore */ }
                    duoLipSync = null;
                }
            }
            applyResponsivePlayerLayout();
            return;
        }
        if (duoPlayer) {
            applyResponsivePlayerLayout();
            return;
        }
        // 优先用上次选的角色二，没有就选另一个主角色
        const current = (document.body.dataset.character || '').toLowerCase();
        const partnerId = duoId || (current.indexOf('vanilla') === 0 ? 'chocola-lolita' : 'vanilla-lolita');
        try {
            const partner = await createDuoPlayer(partnerId);
            if (!duoEnabled) {           // 加载期间又被关掉了
                try { partner.unloadData(); } catch (e) { /* ignore */ }
                return;
            }
            commitDuoPlayer(partner, partnerId);
            markDuoCurrent(partnerId);
            applyResponsivePlayerLayout();
            if (lastPointer.x !== null && gazeEnabled) {
                eyetracking_reaction({ clientX: lastPointer.x, clientY: lastPointer.y });
            }
        } catch (error) {
            duoPlayer = null;
            // 加载失败就回到单人不，免得开关显示开着却只有一个人
            duoEnabled = false;
            applyResponsivePlayerLayout();   // 把主角色挪回中间
            try { localStorage.setItem('nekoWebShowDuo', '0'); } catch (e) { /* ignore */ }
            document.dispatchEvent(new CustomEvent('neko:duo-failed'));
            console.error('双人模式加载失败:', error);
        }
    }

    listen(document, 'neko:duo-toggle', (ev) => {
        setDuo(!!(ev && ev.detail && ev.detail.enabled));
    });

    // 角色二换装：不重建会话，只替换第二个 player
    // 菜单里给角色二选中的皮肤加个标记（和角色一的 aria-current 并存）
    function markDuoCurrent(id) {
        const target = '#' + id;
        document.querySelectorAll('#topbar a[data-model]').forEach((a) => {
            a.classList.toggle('duo-current', a.getAttribute('href') === target);
        });
    }

    async function loadDuoModel(id) {
        if (!duoEnabled || !duoPlayer) return;
        if (id === duoId) return;                 // 同一套皮肤，没必要重载
        if (duoBusy) { duoPending = id; return; } // 正在换，排队取最后一次
        duoBusy = true;
        const status = document.getElementById('character-status');
        try {
            if (status) status.textContent = '正在给角色二换装…';
            // 先卸旧的再加载新的：否则堆里会同时存在三个模型，几次之后就撑爆 256MB
            const old = duoPlayer;
            duoPlayer = null;
            if (duoLipSync) {
                try { duoLipSync.dispose(); } catch (e) { /* ignore */ }
                duoLipSync = null;
            }
            if (old) { try { old.unloadData(); } catch (e) { /* ignore */ } }

            const next = await createDuoPlayer(id);
            commitDuoPlayer(next, id);
            markDuoCurrent(id);
            applyResponsivePlayerLayout();
            if (lastPointer.x !== null && gazeEnabled) {
                eyetracking_reaction({ clientX: lastPointer.x, clientY: lastPointer.y });
            }
        } catch (error) {
            console.error('角色二换装失败:', error);
            duoEnabled = false;
            try { localStorage.setItem('nekoWebShowDuo', '0'); } catch (e) { /* ignore */ }
            document.dispatchEvent(new CustomEvent('neko:duo-failed'));
            applyResponsivePlayerLayout();
        } finally {
            duoBusy = false;
            if (status) status.textContent = '';
            if (duoPending) {
                const nextId = duoPending;
                duoPending = null;
                loadDuoModel(nextId);
            }
        }
    }

    // 选中角色一 / 角色二（决定菜单和拖动作用于谁）
    listen(document, 'neko:duo-slot', (ev) => {
        duoActive = Number(ev && ev.detail && ev.detail.slot) === 2;
        try { localStorage.setItem('nekoWebShowDuoSlot', duoActive ? '2' : '1'); } catch (e) { /* ignore */ }
    });

    // 双人模式 + 选中角色二时，点角色菜单是给角色二换装，不能让它跳转把角色一切走
    listen(document, 'click', (ev) => {
        if (!duoEnabled || !duoActive) return;
        const link = ev.target && ev.target.closest ? ev.target.closest('#topbar a[data-model]') : null;
        if (!link) return;
        ev.preventDefault();
        ev.stopPropagation();
        const id = (link.getAttribute('href') || '').replace('#', '');
        if (!id) return;
        const status = document.getElementById('character-status');
        if (status) status.textContent = '正在给角色二换装…';
        loadDuoModel(id).then(() => {
            if (status) status.textContent = '';
        });
    }, true);

    // 设置里「跟随鼠标」开关：关掉后角色不再盯着光标，注视变量归零
        listen(document, 'neko:gaze-toggle', (ev) => {
            gazeEnabled = !!(ev && ev.detail && ev.detail.enabled);
            if (gazeEnabled) {
                // 重新打开时用最后一次已知的光标位置立刻追一次，
                // 否则要等鼠标动一下才有 mousemove，看起来像“没生效”。
                shadowState = null;
                leaveX = null;
                leaveY = null;
                if (lastMouseX !== null) {
                    pendingGaze = { clientX: lastMouseX, clientY: lastMouseY };
                }
                return;
            }
            shadowState = null;
            pendingGaze = null;
            // 两个角色都要回正，否则角色二会僵在最后一次的斜眼状态
            const gazeTargets = duoPlayer ? [player, duoPlayer] : [player];
            gazeTargets.forEach((target) => {
                ['face_eye_LR', 'face_eye_UD', 'head_slant', 'head_LR', 'head_UD',
                 'body_slant', 'body_LR', 'body_UD'].forEach((label) => {
                    target.setVariableDiff('eyetrack', label, 0, 400, -1);
                });
            });
        });

        canvas.onclick = (ev) => {
            if (dragState.moved) {
                dragState.moved = false;
                return;
            }
            touch_reaction(ev);
        };
        listen(canvas, 'touchstart', (ev) => {
            touch_reaction(ev.touches[0]);
            ev.preventDefault();
        }, false);
        listen(canvas, 'touchend', (ev) => {
            ev.preventDefault();
        }, false);
    } catch (error) {
        session.dispose();
        throw error;
    }
}

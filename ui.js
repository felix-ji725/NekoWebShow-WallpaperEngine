/* ============================================================
   NekoWebShow 控制 UI 交互（PHP 版与静态版共用）
   - 侧边栏展开/收起、抽屉手风琴（点开/再点收起，点其它自动收起上一个）
   - 切换图标 / 侧边栏可拖动（限制在视口内，不越界）
   - “设置”抽屉：帧率限制（默认 60，可选无上限），localStorage 持久化
   ============================================================ */
(function () {
  'use strict';

  // ---------- 帧率限制 ----------
  var FPS_KEY = 'nekoWebShowFpsLimit';
  var FPS_DEFAULT = 60;            // 0 表示无上限
  var ICON_POS_KEY = 'nekoWebShowIconPos';
  var TOPBAR_POS_KEY = 'nekoWebShowTopbarPos';

  function readFps() {
    var raw = null;
    try { raw = localStorage.getItem(FPS_KEY); } catch (e) {}
    if (raw === null || raw === '') return FPS_DEFAULT;
    var n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 0) return FPS_DEFAULT;
    return n;
  }
  function writeFps(v) {
    try { localStorage.setItem(FPS_KEY, String(v)); } catch (e) {}
  }
  function applyFps() {
    // 注意：emoteplayer.js 里 EmotePlayer 是顶层 class 声明，不会挂在 window 上。
    if (typeof EmotePlayer !== 'undefined') {
      EmotePlayer.fpsLimit = readFps();
    }
  }

  // ---------- 无上限时的实时帧数 ----------
  var fpsLiveEl = null;          // 「无上限」行右侧那个位置
  var fpsMeterRaf = null;
  var fpsMeterFrames = 0;
  var fpsMeterT0 = 0;
  var currentFpsValue = readFps();

  function startFpsMeter() {
    if (!fpsLiveEl || fpsMeterRaf !== null) return;
    if (currentFpsValue !== 0) return;
    if (!document.querySelector('#topbar .settings-item.open')) return;
    fpsMeterFrames = 0;
    fpsMeterT0 = 0;

    var loop = function (t) {
      if (fpsMeterT0 === 0) fpsMeterT0 = t;
      fpsMeterFrames++;
      var dt = t - fpsMeterT0;
      if (dt >= 500) {
        fpsLiveEl.textContent = Math.round((fpsMeterFrames * 1000) / dt) + ' fps';
        fpsMeterFrames = 0;
        fpsMeterT0 = t;
        // 半秒检查一次：面板关了或不再是无上限就停掉
        var open = !!document.querySelector('#topbar .settings-item.open');
        if (!open || currentFpsValue !== 0) {
          fpsLiveEl.textContent = '';
          fpsMeterRaf = null;
          return;
        }
      }
      fpsMeterRaf = requestAnimationFrame(loop);
    };
    fpsMeterRaf = requestAnimationFrame(loop);
  }

  // ---------- 角色锁定 / 静音 / 壁纸状态 ----------
  var LOCK_KEY = 'nekoWebShowLock';
  var MUTE_KEY = 'nekoWebShowMute';
  var GAZE_KEY = 'nekoWebShowGaze';
  var DUO_KEY = 'nekoWebShowDuo';
  var duoSlots = null;
  var applyDuoUI = function () {};

  function readBool(key, def) {
    var raw = null;
    try { raw = localStorage.getItem(key); } catch (e) {}
    if (raw === null) return def;
    return raw === '1';
  }
  function writeBool(key, v) {
    try { localStorage.setItem(key, v ? '1' : '0'); } catch (e) {}
  }

  function isLocked() { return readBool(LOCK_KEY, false); }
  function isMuted() { return readBool(MUTE_KEY, false); }
  function isGazeEnabled() { return readBool(GAZE_KEY, true); }
  function isDuo() { return readBool(DUO_KEY, false); }

  function applyCharCursor() {
    try { document.body.classList.toggle('char-unlocked', !isLocked()); } catch (e) {}
  }

  // ---------- 抽屉手风琴 ----------
  function setDrawerOpen(item, open) {
    item.classList.toggle('open', open);
    var body = item.querySelector('.dropdown');
    if (!body) return;
    // 抽屉保持完整高度，由侧边栏整体滚动；内嵌滚动条在壁纸里很难拖。
    body.style.maxHeight = open ? (body.scrollHeight + 'px') : '0px';
  }

  function toggleDrawer(item) {
    var isOpen = item.classList.contains('open');
    document.querySelectorAll('#topbar .menu-item.open').forEach(function (o) {
      if (o !== item) setDrawerOpen(o, false);
    });
    setDrawerOpen(item, !isOpen);
    // 打开设置时把角色列表收进「角色」分组，关掉再展开
    syncCharGroup();
    // 选的是「无上限」时，开始刷实时帧数
    startFpsMeter();
  }

  window.NekoUI = {
    readFps: readFps,
    setFps: function (v) { writeFps(v); applyFps(); currentFpsValue = v; startFpsMeter(); },
    applyFps: applyFps,
    toggleDrawer: toggleDrawer,
    isLocked: isLocked,
    isMuted: isMuted,
    applyCharCursor: applyCharCursor,
    isGazeEnabled: isGazeEnabled
  };

  // ---------- 拖动辅助 ----------
  function enableDrag(target, key, handle, opts) {
    opts = opts || {};
    var dragging = false, moved = false;
    var startX = 0, startY = 0, origX = 0, origY = 0;
    var moveFrame = null, pendingMove = null, pointerId = null;

    function applyMove() {
      moveFrame = null;
      if (!pendingMove) return;
      var point = pendingMove;
      pendingMove = null;
      var vw = window.innerWidth || document.documentElement.clientWidth;
      var vh = window.innerHeight || document.documentElement.clientHeight;
      var w = target.offsetWidth;
      var h = target.offsetHeight;
      var nx = Math.max(0, Math.min(vw - w, origX + point.dx));
      var ny = Math.max(0, Math.min(vh - h, origY + point.dy));
      target.style.left = nx + 'px';
      target.style.top = ny + 'px';
      target.style.right = 'auto';
    }

    // 壁纸/DLL 注入的鼠标事件下 setPointerCapture 经常失败，指针一离开把手就收不到
    // move；所以监听挂到 window 上，并用 capture 阶段保证不被其它元素吞掉。
    function onMove(e) {
      if (!dragging) return;
      if (pointerId !== null && e.pointerId !== undefined && e.pointerId !== pointerId) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (!moved) return;
      pendingMove = { dx: dx, dy: dy };
      if (moveFrame === null) moveFrame = requestAnimationFrame(applyMove);
    }

    function end() {
      if (!dragging) return;
      dragging = false;
      if (moveFrame !== null) { cancelAnimationFrame(moveFrame); moveFrame = null; }
      applyMove();
      target.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
      pointerId = null;
      if (moved && key) {
        var r = target.getBoundingClientRect();
        try { localStorage.setItem(key, JSON.stringify({ x: r.left, y: r.top })); } catch (e) {}
        // 拖完松手会补一个 click，把这次点击吞掉，否则会顺带触发图标的开关。
        var swallow = function (ev) {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, true);
        setTimeout(function () { window.removeEventListener('click', swallow, true); }, 0);
      }
    }

    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target && e.target.closest && e.target.closest('a,button,.dropdown,.menu-item,.opt')) return;
      dragging = true;
      moved = false;
      pointerId = e.pointerId === undefined ? null : e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      var r = target.getBoundingClientRect();
      origX = r.left;
      origY = r.top;
      if (opts.onStart) opts.onStart(target);
      target.classList.add('dragging');
      window.addEventListener('pointermove', onMove, true);
      window.addEventListener('pointerup', end, true);
      window.addEventListener('pointercancel', end, true);
      e.preventDefault();
    });

    window.addEventListener('blur', end);

    return { wasMoved: function () { return moved; } };
  }

  function restorePos(el, key, onRestored) {
    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(key)); } catch (e) {}
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
      el.style.left = saved.x + 'px';
      el.style.top = saved.y + 'px';
      el.style.right = 'auto';
      if (onRestored) onRestored(el);
    }
  }

  // ---------- 视口边界约束（拖动窗口时不让图标/侧边栏飞出界面） ----------
  function viewportSize() {
    return {
      w: window.innerWidth || document.documentElement.clientWidth || 0,
      h: window.innerHeight || document.documentElement.clientHeight || 0
    };
  }

  // 元素“显示态”下的布局矩形（忽略隐藏时的 translateX 等 transform）
  function restRect(el) {
    var cs = window.getComputedStyle(el);
    var left = parseFloat(cs.left);
    var top = parseFloat(cs.top);
    if (!Number.isFinite(left)) left = 0;
    if (!Number.isFinite(top)) top = 0;
    return { left: left, top: top, width: el.offsetWidth || 0, height: el.offsetHeight || 0 };
  }

  function clampToViewport(el, pad) {
    pad = pad || 0;
    var vp = viewportSize();
    var r = restRect(el);
    var maxLeft = Math.max(pad, vp.w - pad - r.width);
    var maxTop = Math.max(pad, vp.h - pad - r.height);
    var left = Math.min(Math.max(r.left, pad), maxLeft);
    var top = Math.min(Math.max(r.top, pad), maxTop);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
    el.style.right = 'auto';
    return { left: left, top: top };
  }

  function resetTopbarToInitial(topbar) {
    topbar.classList.remove('free');
    // 默认贴右上角，但要往左让开右上角的猫爪图标（44px + 左右各 8px）。
    // 面板高度上限是 100vh-16px，纵向没有余量，所以不能靠下移来避让。
    var vw = viewportSize().w;
    var w = topbar.offsetWidth || 268;
    var iconGap = 60;
    topbar.style.left = Math.max(8, vw - w - iconGap) + 'px';
    topbar.style.top = '8px';
    topbar.style.right = 'auto';
    try { localStorage.removeItem(TOPBAR_POS_KEY); } catch (e) {}
  }

  // ---------- 角色分组（打开设置时收起，省掉 8 行高度） ----------
  var CHAR_KEYS = { chocola: 1, vanilla: 1, azuki: 1, coconut: 1, maple: 1, cinnamon: 1, milk: 1, fraise: 1 };
  var charGroup = null;

  function initCharGroup(topbar) {
    if (!topbar) return;
    var items = [];
    Array.prototype.forEach.call(topbar.children, function (el) {
      if (!el.classList || !el.classList.contains('menu-item')) return;
      var label = el.querySelector(':scope > .label');
      var key = label && label.getAttribute('data-i18n');
      if (key && CHAR_KEYS[key]) items.push(el);
    });
    if (items.length < 2) return;

    var group = document.createElement('div');
    group.id = 'char-group';
    var head = document.createElement('div');
    head.id = 'char-group-head';
    var text = document.createElement('span');
    text.setAttribute('data-i18n', 'characterSettings');
    text.textContent = '角色';
    var count = document.createElement('span');
    count.className = 'char-count';
    count.textContent = String(items.length);
    head.appendChild(text);
    head.appendChild(count);
    group.appendChild(head);

    // 双人模式下用来选「角色一 / 角色二」的两个圈
    var slots = document.createElement('div');
    slots.id = 'duo-slots';
    slots.style.display = 'none';
    [1, 2].forEach(function (n) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'duo-slot' + (n === 1 ? ' active' : '');
      btn.dataset.slot = String(n);
      btn.textContent = String(n);
      btn.title = (window.languageManager && window.languageManager.get(n === 1 ? 'charOne' : 'charTwo')) || (n === 1 ? '角色一' : '角色二');
      btn.addEventListener('click', function (e) {
        e.stopPropagation();
        [].forEach.call(slots.children, function (x) { x.classList.toggle('active', x === btn); });
        document.dispatchEvent(new CustomEvent('neko:duo-slot', { detail: { slot: n } }));
      });
      slots.appendChild(btn);
    });
    group.appendChild(slots);
    try {
      if (localStorage.getItem('nekoWebShowDuoSlot') === '2') {
        [].forEach.call(slots.children, function (x) { x.classList.toggle('active', x.dataset.slot === '2'); });
      }
    } catch (e) { /* ignore */ }
    duoSlots = slots;

    topbar.insertBefore(group, items[0]);
    items.forEach(function (el) { group.appendChild(el); });

    // 手动点击标题可以临时展开／收起
    head.addEventListener('click', function (e) {
      e.stopPropagation();
      group.classList.toggle('collapsed');
    });

    charGroup = group;
    syncCharGroup();
    applyDuoUI();
  }

  function syncCharGroup() {
    if (!charGroup) return;
    var settingsOpen = !!document.querySelector('#topbar .settings-item.open');
    charGroup.classList.toggle('collapsed', settingsOpen);
  }

  // 语言选择器是 locales.js 动态塞进来的，位置不定；统一挪到「设置」下面
  function placeLanguage(topbar) {
    var lang = topbar.querySelector('.language-selector');
    var settings = topbar.querySelector('.settings-item');
    if (!lang || !settings) return;
    if (lang.previousElementSibling !== settings) {
      topbar.insertBefore(lang, settings.nextSibling);
    }
  }

  // ---------- 抽屉委托处理 ----------
  function initDrawers(topbar) {
    if (!topbar) return;
    topbar.addEventListener('click', function (e) {
      var t = e.target;
      if (!t || !t.closest) return;
      if (t.closest('.dropdown')) return;            // 点抽屉内容(链接/选项)不切换
      var item = t.closest('.menu-item');
      if (!item) return;
      if (item.classList.contains('language-selector')) return; // 语言选择器自行处理
      if (item.classList.contains('settings-item')) return;     // 设置项自行处理
      toggleDrawer(item);
    });
  }

  // ---------- 切换图标（点击切换 + 拖动） ----------
  function initToggleIcon(icon, topbar) {
    if (!icon || !topbar) return;

    restorePos(icon, ICON_POS_KEY);
    if (icon.style.left === '' || icon.style.left === 'auto') {
      // 默认定位到右上角：用视口宽度 + 固定尺寸（CSS 已固定 44px）计算，
      // 不依赖图片是否加载完成，刷新后图标不再消失。
      var vw = viewportSize().w;
      var iw = icon.offsetWidth || 44;
      icon.style.top = '8px';
      icon.style.left = Math.max(8, vw - iw - 8) + 'px';
      icon.style.right = 'auto';
    }
    // 防御：即使保存的位置越界，也把图标夹回视口内
    clampToViewport(icon, 8);

    var drag = enableDrag(icon, ICON_POS_KEY, icon);
    icon.addEventListener('click', function () {
      if (drag.wasMoved()) return;
      var willOpen = !topbar.classList.contains('open');
      if (willOpen) {
        // 面板本来就比屏幕高，"完整可见"永远不成立；只把越界的部分夹回来
        clampToViewport(topbar, 8);
      }
      topbar.classList.toggle('open');
    });
  }

  // ---------- 侧边栏拖动（用标题栏作把手，不显示额外图标） ----------
  function initTopbarDrag(topbar) {
    if (!topbar) return;
    var handle = topbar.querySelector(':scope > .label') || topbar.querySelector('.label');
    if (!handle) return;
    handle.title = '拖动侧边栏';

    var restored = false;
    restorePos(topbar, TOPBAR_POS_KEY, function (el) {
      restored = true;
      el.classList.add('free');
      el.style.transform = 'translateX(0)';
    });
    if (!restored) {
      // 从没拖过：默认贴右上角
      resetTopbarToInitial(topbar);
    }

    enableDrag(topbar, TOPBAR_POS_KEY, handle, {
      onStart: function (el) {
        var r = el.getBoundingClientRect();
        el.style.left = r.left + 'px';
        el.style.top = r.top + 'px';
        el.style.transform = 'translateX(0)';
      }
    });
  }

  // ---------- 设置抽屉（帧率限制） ----------
  function initSettings(topbar) {
    if (!topbar) return;

    var fpsOptions = [
      { value: 30,   label: '30 FPS', badge: '' },
      { value: 60,   label: '60 FPS', badge: '' },
      { value: 120,  label: '120 FPS', badge: '' },
      { value: 240,  label: '240 FPS', badge: '' },
      { value: 0,    label: '无上限',  i18nLabel: 'fpsUnlimited' }
    ];

    var item = document.createElement('div');
    item.className = 'menu-item settings-item';

    var label = document.createElement('span');
    label.className = 'label';
    label.setAttribute('data-i18n', 'settings');
    label.textContent = '设置';
    item.appendChild(label);

    var dd = document.createElement('div');
    dd.className = 'dropdown settings-dropdown';

    var title = document.createElement('div');
    title.className = 'opt';
    title.style.cursor = 'default';
    title.style.fontWeight = 'bold';
    title.setAttribute('data-i18n', 'fpsLimit');
    title.textContent = '帧率限制';
    dd.appendChild(title);

    var current = readFps();

    fpsOptions.forEach(function (o) {
      var row = document.createElement('div');
      row.className = 'opt' + (o.value === current ? ' selected' : '');
      row.dataset.fps = o.value;

      var dot = document.createElement('span');
      dot.className = 'dot';
      row.appendChild(dot);

      var text = document.createElement('span');
      if (o.i18nLabel) text.setAttribute('data-i18n', o.i18nLabel);
      text.textContent = o.label;
      row.appendChild(text);

      if (o.value === 0) {
        // 无上限：这个位置留给实时帧数，不再显示 ∞
        fpsLiveEl = document.createElement('span');
        fpsLiveEl.className = 'fps-live';
        row.appendChild(fpsLiveEl);
      } else if (o.badge) {
        var badge = document.createElement('span');
        badge.className = 'fps-badge';
        if (o.i18nBadge) badge.setAttribute('data-i18n', o.i18nBadge);
        badge.textContent = o.badge;
        row.appendChild(badge);
      }

      row.addEventListener('click', function (e) {
        e.stopPropagation();
        NekoUI.setFps(o.value);
        dd.querySelectorAll('.opt[data-fps]').forEach(function (r) {
          r.classList.toggle('selected', parseInt(r.dataset.fps, 10) === o.value);
        });
        startFpsMeter();
      });

      dd.appendChild(row);
    });

    // ---------- 角色设置 ----------
    var charTitle = document.createElement('div');
    charTitle.className = 'opt';
    charTitle.style.cursor = 'default';
    charTitle.style.fontWeight = 'bold';
    charTitle.setAttribute('data-i18n', 'characterSettings');
    charTitle.textContent = '角色';
    dd.appendChild(charTitle);

    function makeToggle(i18nKey, defLabel, checked, onChange) {
      var row = document.createElement('div');
      row.className = 'opt' + (checked ? ' on' : '');
      row.dataset.i18nKey = i18nKey;
      var text = document.createElement('span');
      text.setAttribute('data-i18n', i18nKey);
      text.textContent = defLabel;
      row.appendChild(text);
      var sw = document.createElement('span');
      sw.className = 'switch';
      var knob = document.createElement('span');
      knob.className = 'knob';
      sw.appendChild(knob);
      row.appendChild(sw);
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        checked = !checked;
        row.classList.toggle('on', checked);
        onChange(checked);
      });
      return row;
    }

    dd.appendChild(makeToggle('lockCharacter', '锁定人物位置与大小', isLocked(), function (on) {
      writeBool(LOCK_KEY, on);
      applyCharCursor();
    }));

    dd.appendChild(makeToggle('muteSound', '关闭声音', isMuted(), function (on) {
      writeBool(MUTE_KEY, on);
    }));

    dd.appendChild(makeToggle('followMouse', '跟随鼠标', isGazeEnabled(), function (on) {
      writeBool(GAZE_KEY, on);
      document.dispatchEvent(new CustomEvent('neko:gaze-toggle', { detail: { enabled: on } }));
    }));

    var duoToggleRow = makeToggle('duoMode', '双人模式', isDuo(), function (on) {
      writeBool(DUO_KEY, on);
      document.dispatchEvent(new CustomEvent('neko:duo-toggle', { detail: { enabled: on } }));
    });
    dd.appendChild(duoToggleRow);
    // 第二个模型加载失败时，把开关拨回去，避免“开着却只有一个人”
    document.addEventListener('neko:duo-failed', function () {
      duoToggleRow.classList.remove('on');
    });

    // 角色大小：WE 不转发 wheel，滚轮缩放在壁纸里用不了，改成 ± 按钮
    var SCALE_KEY = 'nekoWebShowCharScale';
    var DUO_SCALE_KEY = 'nekoWebShowDuoScale';

    function readStoredScale(key) {
      var v = NaN;
      try { v = parseFloat(localStorage.getItem(key)); } catch (e) { /* ignore */ }
      return (Number.isFinite(v) && v >= 0.25 && v <= 5) ? v : 1;
    }

    // 一行 ± 控件，绑定到某个槽位（1 = 角色一，2 = 角色二）
    function makeScaleRow(label, key, slot) {
      var row = document.createElement('div');
      row.className = 'opt scale-opt';
      var text = document.createElement('span');
      text.textContent = label;
      row.appendChild(text);
      var minus = document.createElement('button');
      minus.type = 'button';
      minus.className = 'scale-btn';
      minus.textContent = '−';
      var value = document.createElement('span');
      value.className = 'scale-val';
      var plus = document.createElement('button');
      plus.type = 'button';
      plus.className = 'scale-btn';
      plus.textContent = '+';
      row.appendChild(minus);
      row.appendChild(value);
      row.appendChild(plus);

      // 内存副本：localStorage 不可写时也不会每次从 1 重算
      var current = readStoredScale(key);
      function apply(v) {
        v = Math.round(Math.max(0.25, Math.min(5, v)) * 10000) / 10000;
        current = v;
        try { localStorage.setItem(key, v); } catch (e) { /* ignore */ }
        value.textContent = Math.round(v * 100) + '%';
        document.dispatchEvent(new CustomEvent('neko:scale-character', { detail: { scale: v, slot: slot } }));
      }
      value.textContent = Math.round(current * 100) + '%';
      minus.addEventListener('click', function (e) { e.stopPropagation(); apply(current / 1.12); });
      plus.addEventListener('click', function (e) { e.stopPropagation(); apply(current * 1.12); });
      // 「重设角色位置」会把缩放一并归 1，这里跟着刷新显示
      document.addEventListener('neko:reset-character', function () {
        current = 1;
        value.textContent = '100%';
      });
      return {
        el: row,
        // 切换文案时同步 data-i18n，切语言才会跟着变
        setI18n: function (key, fallback) {
          text.setAttribute('data-i18n', key);
          text.textContent = fallback;
          if (window.languageManager && typeof window.languageManager.applyTranslations === 'function') {
            try { window.languageManager.applyTranslations(); } catch (e) { /* ignore */ }
          }
        }
      };
    }

    var scaleRowA = makeScaleRow('角色大小', SCALE_KEY, 1);
    scaleRowA.setI18n('charSize', '角色大小');
    var scaleRowB = makeScaleRow('角色二', DUO_SCALE_KEY, 2);
    scaleRowB.setI18n('charTwo', '角色二');
    scaleRowB.el.style.display = 'none';
    dd.appendChild(scaleRowA.el);
    dd.appendChild(scaleRowB.el);

    // 双人模式：角色一行改名「角色一」，并露出角色二那一行和两个选择圈
    applyDuoUI = function () {
      var on = isDuo();
      scaleRowA.setI18n(on ? 'charOne' : 'charSize', on ? '角色一' : '角色大小');
      scaleRowB.el.style.display = on ? '' : 'none';
      if (duoSlots) duoSlots.style.display = on ? '' : 'none';
      // 关掉双人模式时把选择圈拨回角色一，避免一直停在「角色二」导致换装改错对象
      if (!on && duoSlots) {
        [].forEach.call(duoSlots.children, function (b) {
          b.classList.toggle('active', b.dataset.slot === '1');
        });
      }
    };
    applyDuoUI();

    // ---------- 壁纸选择 ----------
    var wpTitle = document.createElement('div');
    wpTitle.className = 'opt';
    wpTitle.style.cursor = 'default';
    wpTitle.style.fontWeight = 'bold';
    wpTitle.setAttribute('data-i18n', 'wallpaper');
    wpTitle.textContent = '壁纸选择';
    dd.appendChild(wpTitle);

    var wps = window.NekoBackground.list();
    var currentWp = window.NekoBackground.current();
    var section = null;
    // 背景有 50 多个选项，单列会把面板撑到两屏高，改成双列网格
    var bgGrid = document.createElement('div');
    bgGrid.className = 'bg-grid';
    wps.forEach(function (background) {
      var name = background.id;
      if (section !== background.type) {
        section = background.type;
        var heading = document.createElement('div');
        heading.className = 'opt background-section';
        heading.setAttribute('data-i18n', section === 'dynamic' ? 'dynamicBackgrounds' : 'staticBackgrounds');
        bgGrid.appendChild(heading);
        if (section === 'dynamic') {
          var schedule = document.createElement('div');
          schedule.className = 'background-schedule';
          schedule.setAttribute('data-i18n', 'backgroundSchedule');
          bgGrid.appendChild(schedule);
        }
      }
      var row = document.createElement('div');
      row.className = 'opt' + (name === currentWp ? ' selected' : '');
      row.dataset.wallpaper = name;
      var dot = document.createElement('span');
      dot.className = 'dot';
      row.appendChild(dot);
      var text = document.createElement('span');
      text.dataset.backgroundLabel = name;
      var lang = window.languageManager?.currentLang || 'zh-CN';
      text.textContent = background.names[lang] || background.names['zh-CN'] || name;
      row.appendChild(text);
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        window.NekoBackground.select(name);
        dd.querySelectorAll('.opt[data-wallpaper]').forEach(function (r) {
          r.classList.toggle('selected', r.dataset.wallpaper === name);
        });
      });
      bgGrid.appendChild(row);
    });

    dd.appendChild(bgGrid);
    // 重设角色位置：把被拖到屏外、找不到的角色拉回默认位置与大小
    var resetRow = document.createElement('div');
    resetRow.className = 'opt reset-opt';
    var resetText = document.createElement('span');
    resetText.setAttribute('data-i18n', 'resetCharacter');
    resetText.textContent = '重设角色位置';
    resetRow.appendChild(resetText);
    resetRow.addEventListener('click', function (e) {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent('neko:reset-character'));
    });
    dd.appendChild(resetRow);

    item.appendChild(dd);

    var infotext = topbar.querySelector('.infotext');
    if (infotext) topbar.insertBefore(item, infotext);
    else topbar.appendChild(item);

    item.addEventListener('click', function (e) {
      if (e.target.closest && e.target.closest('.opt')) return; // 选项点击不切换抽屉
      e.stopPropagation();
      toggleDrawer(item);
    });
  }

  // ---------- 自绘滚动条 ----------
  // 壁纸里原生滚动条拖不动（拿不到正确的指针状态），用 pointer 事件自己做一条。
  function setupScrollThumb(topbar) {
    var thumb = document.createElement('div');
    thumb.className = 'neko-scroll-thumb';
    document.body.appendChild(thumb);

    var dragging = false, startY = 0, startScroll = 0, trackH = 0, thumbH = 0;
    var lastSig = '';

    function maxScroll() {
      return Math.max(0, topbar.scrollHeight - topbar.clientHeight);
    }

    function layout() {
      var open = topbar.classList.contains('open');
      if (!open) {
        if (lastSig !== 'hidden') {
          lastSig = 'hidden';
          thumb.style.display = 'none';
        }
        return;
      }
      var max = maxScroll();
      var r = topbar.getBoundingClientRect();
      if (max <= 2 || r.width < 10 || r.height < 10) {
        if (lastSig !== 'hidden') {
          lastSig = 'hidden';
          thumb.style.display = 'none';
        }
        return;
      }
      var sig = r.top + '|' + r.left + '|' + r.height + '|' + r.width + '|' +
        topbar.scrollTop + '|' + topbar.scrollHeight;
      if (sig === lastSig) return;
      lastSig = sig;
      trackH = r.height - 12;
      thumbH = Math.max(36, trackH * (topbar.clientHeight / topbar.scrollHeight));
      var y = r.top + 6 + (trackH - thumbH) * (topbar.scrollTop / max);
      thumb.style.display = 'block';
      thumb.style.height = thumbH + 'px';
      thumb.style.top = y + 'px';
      thumb.style.left = (r.right - 14) + 'px';
    }

    var rafId = null;
    function frame() {
      layout();
      rafId = requestAnimationFrame(frame);
    }
    setInterval(function () {
      if (topbar.classList.contains('open')) {
        if (rafId === null) rafId = requestAnimationFrame(frame);
      } else if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
        layout();
      }
    }, 200);

    thumb.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startY = e.clientY;
      startScroll = topbar.scrollTop;
      var r = topbar.getBoundingClientRect();
      trackH = r.height - 12;
      thumbH = thumb.offsetHeight;
      try { thumb.setPointerCapture(e.pointerId); } catch (err) { /* 合成事件忽略 */ }
    });

    window.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var max = maxScroll();
      var span = Math.max(1, trackH - thumbH);
      topbar.scrollTop = startScroll + (e.clientY - startY) * (max / span);
    });

    window.addEventListener('pointerup', function () { dragging = false; });
    window.addEventListener('pointercancel', function () { dragging = false; });
  }
  // ---------- 初始化 ----------
  function init() {
    try {
    applyFps();
    window.NekoBackground.init();
    applyCharCursor();
    var topbar = document.getElementById('topbar');
    var icon = document.getElementById('toggle-icon');
    initSettings(topbar);
    initCharGroup(topbar);
    // 菜单链接被拖到桌面会生成 .url 快捷方式，直接禁掉
    document.addEventListener('dragstart', function (e) {
      if (e.target && e.target.closest && e.target.closest('#topbar')) {
        e.preventDefault();
      }
    }, true);
    // 双人模式开关变化时刷新面板上的两组控件
    document.addEventListener('neko:duo-toggle', function () { applyDuoUI(); });
    applyDuoUI();
    placeLanguage(topbar);
    new MutationObserver(function () { placeLanguage(topbar); })
      .observe(topbar, { childList: true });
    initTopbarDrag(topbar);
    initDrawers(topbar);
    initToggleIcon(icon, topbar);

    // 滚轮在壁纸里不一定被转发，给标题栏加一对常驻的滚动按钮。
    if (topbar) {
      var titleBar = topbar.querySelector(':scope > .label') || topbar.querySelector('.label');
      if (titleBar) {
        var nav = document.createElement('div');
        nav.className = 'panel-nav';
        [['▲', -300, '向上滚动'], ['▼', 300, '向下滚动']].forEach(function (spec) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = spec[0];
          btn.title = spec[2];
          btn.addEventListener('click', function (e) {
            e.stopPropagation();
            topbar.scrollTop += spec[1];
          });
          // 按住不放连续滚动：WE 不转发 wheel 时的替代操作
          var holdTimer = null, holdRepeat = null;
          function stopHold() {
            clearTimeout(holdTimer);
            clearInterval(holdRepeat);
            holdTimer = null;
            holdRepeat = null;
          }
          btn.addEventListener('pointerdown', function (e) {
            e.stopPropagation();
            stopHold();
            holdTimer = setTimeout(function () {
              holdRepeat = setInterval(function () {
                topbar.scrollTop += spec[1] / 4;
              }, 60);
            }, 320);
          });
          btn.addEventListener('pointerup', stopHold);
          btn.addEventListener('pointercancel', stopHold);
          btn.addEventListener('pointerleave', stopHold);
          nav.appendChild(btn);
        });
        titleBar.appendChild(nav);
      }
      // 滚轮：新式 wheel 与旧式 mousewheel 都接，deltaMode 按行/按页也换算
      function onPanelWheel(e) {
        var d = e.deltaY;
        if (e.deltaMode === 1) {
          d = (d || (e.wheelDelta ? -e.wheelDelta / 40 : 0)) * 16;
        } else if (e.deltaMode === 2) {
          d = d * (topbar.clientHeight || 600);
        } else if (!d && e.wheelDelta) {
          d = -e.wheelDelta;
        }
        topbar.scrollTop += d;
        e.preventDefault();
      }
      topbar.addEventListener('wheel', onPanelWheel, { passive: false });
      topbar.addEventListener('mousewheel', onPanelWheel, { passive: false });
      setupScrollThumb(topbar);


    }

    // ---------- 自检探针（仅本地排查：index.html?audit） ----------
    if (location.search.indexOf('audit') >= 0) {
      setTimeout(function () {
        var out = {};
        try {
          var noAnim = document.createElement('style');
          noAnim.textContent = '*{transition:none!important;animation:none!important}';
          document.head.appendChild(noAnim);

          topbar.classList.add('open');
          var settings = document.querySelector('.settings-item');
          var grp = document.getElementById('char-group');
          if (settings) toggleDrawer(settings);

          var bar = topbar.getBoundingClientRect();
          var iconRect = document.getElementById('toggle-icon').getBoundingClientRect();
          out.overlap = (bar.right > iconRect.left && bar.top < iconRect.bottom) ? 'YES' : 'no';
          out.bottomGap = Math.round(window.innerHeight - bar.bottom);
          out.settings = !!settings;
          out.scaleRows = document.querySelectorAll('.scale-opt').length;
          out.duoSlots = !!document.getElementById('duo-slots');
          out.charGroup = !!grp;
          out.groupCollapsed = grp ? grp.classList.contains('collapsed') : 'n/a';

          out.fpsOrder = [].map.call(document.querySelectorAll('.opt[data-fps]'), function (el) {
            return el.dataset.fps;
          }).join(',');
          out.fpsBadges = document.querySelectorAll('.fps-badge').length;
          out.fpsLive = !!document.querySelector('.fps-live');

          var lang = document.querySelector('.language-selector');
          out.langAfterSettings = (lang && settings && lang.previousElementSibling === settings) ? 'ok' : 'bad';

          topbar.scrollTop = 400;
          out.scroll = Math.round(topbar.scrollTop);

          var th = document.querySelector('.neko-scroll-thumb');
          if (th && th.style.display !== 'none') {
            var tr = th.getBoundingClientRect();
            topbar.scrollTop = 0;
            th.dispatchEvent(new PointerEvent('pointerdown', { clientY: tr.top + 5, bubbles: true, pointerId: 7 }));
            window.dispatchEvent(new PointerEvent('pointermove', { clientY: tr.top + 105, bubbles: true, pointerId: 7 }));
            window.dispatchEvent(new PointerEvent('pointerup', { clientY: tr.top + 105, bubbles: true, pointerId: 7 }));
            out.thumb = Math.round(topbar.scrollTop);
          } else {
            out.thumb = 'hidden';
          }

          topbar.scrollTop = 0;
          topbar.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }));
          out.wheel = Math.round(topbar.scrollTop);

          var btns = document.querySelectorAll('.scale-btn');
          var val = document.querySelector('.scale-val');
          var before = val ? val.textContent : '';
          if (btns.length > 1) {
            btns[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            out.scale = before + '->' + (val ? val.textContent : '');
          }

          var duoEvents = 0;
          document.addEventListener('neko:duo-toggle', function () { duoEvents++; });
          var duoRow = document.querySelector('.settings-item .opt[data-i18n-key="duoMode"]');
          if (duoRow) {
            duoRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            out.duo = localStorage.getItem('nekoWebShowDuo');
            out.row2 = (function () {
              var rows = document.querySelectorAll('.scale-opt');
              return rows.length > 1 && getComputedStyle(rows[1]).display !== 'none';
            })();
            var labelA = document.querySelector('.scale-opt span');
            out.labelA = labelA ? labelA.textContent : '';
            duoRow.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            out.duoEvents = duoEvents;
          }

          var link = document.querySelector('.infotext a[href^="http"]');
          var ev2 = new MouseEvent('click', { bubbles: true, cancelable: true });
          if (link) link.dispatchEvent(ev2);
          out.link = ev2.defaultPrevented ? 'blocked' : 'NOT-BLOCKED';

          var bgText = document.querySelector('.bg-grid .opt[data-wallpaper] span:last-child');
          out.bgTextW = bgText ? Math.round(bgText.getBoundingClientRect().width) : -1;

          out.err = (window.__initError || '').slice(0, 200);
        } catch (e) {
          out.fatal = String((e && e.message) || e);
        }
        // 写进 DOM 属性，避免被页面后续设置的 title 覆盖
        document.documentElement.setAttribute('data-audit', JSON.stringify(out));
      }, 4000);
    }
    // 窗口尺寸变化时，重新校准已展开抽屉的高度
    var resizeFrame = null;
    function updateViewport() {
      resizeFrame = null;
      document.querySelectorAll('#topbar .menu-item.open > .dropdown').forEach(function (dd) {
        dd.style.maxHeight = dd.scrollHeight + 'px';
      });
      // 拖动窗口时，确保控制按钮始终留在界面内；
      // 侧边栏仅在“显示中”时才夹回视口，隐藏态保持原位，
      // 这样点击按钮恢复显示时才会整块回到默认初始位置，而不是就近卡进视口。
      clampToViewport(icon, 8);
      if (topbar.classList.contains('open')) {
        clampToViewport(topbar, 8);
      }
    }
    window.addEventListener('resize', function () {
      if (resizeFrame === null) resizeFrame = requestAnimationFrame(updateViewport);
    });

    // 静态版有 i18n：注入设置项后补一次翻译
    if (window.languageManager && typeof window.languageManager.applyTranslations === 'function') {
      try { window.languageManager.applyTranslations(); } catch (e) {}
    }

    // 面板底部有作者主页/GitHub 两个外链。壁纸里点一下会把整个页面导航走
    // （或者弹新窗口），壁纸就废了，所以直接拦掉。
    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a[href^="http"]') : null;
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);
    } catch (e) {
      window.__initError = (e && (e.stack || e.message)) || String(e);
      document.documentElement.setAttribute('data-init-err', String((e && e.message) || e));
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

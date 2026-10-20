(function() {
    'use strict';

    if (!location.hostname.includes('swis.mohw.gov.tw')) return;
    if (location.pathname.indexOf('/socs/login.jsp') !== -1) return;

    function isUtilityFrame() {
        var frameName = String(window.name || '').toLowerCase();
        var path = String(location.pathname || '').toLowerCase();
        var utilityNames = {
            city_frm: true,
            soc_frm: true,
            ifm_filter: true,
            qdata_ifm: true,
            qzap_ifm: true
        };

        return utilityNames[frameName] || /\/socs\/jsp\/comm\/(blank|filter|city_all)\.jsp$/.test(path);
    }

    if (isUtilityFrame()) return;

    var TRANSITION_HINT_KEY = 'swisPageTransitionHint';
    var TRANSITION_SNAPSHOT_KEY = 'swisPageTransitionSnapshot';
    var TRANSITION_HINT_TTL = 2500;

    function injectGlobalFontFace() {
        if (document.getElementById('swis-global-font-face')) return;
        if (!window.chrome || !chrome.runtime || !chrome.runtime.getURL) return;

        var style = document.createElement('style');
        style.id = 'swis-global-font-face';
        var regularUrl = chrome.runtime.getURL('assets/fonts/NotoSansTC-Regular.ttf');
        var semiBoldUrl = chrome.runtime.getURL('assets/fonts/NotoSansTC-SemiBold.ttf');
        style.textContent = [
            '@font-face{font-family:"NotoSansTC-Regular";src:url("', regularUrl, '") format("truetype");font-style:normal;font-weight:400;font-display:swap;}',
            '@font-face{font-family:"NotoSansTC-Regular";src:url("', semiBoldUrl, '") format("truetype");font-style:normal;font-weight:600;font-display:swap;}',
            'html,body,body *,button,input,select,textarea,option,optgroup,table,svg text{font-family:"NotoSansTC-Regular","Microsoft JhengHei","PingFang TC","Segoe UI",Arial,sans-serif!important;}'
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    injectGlobalFontFace();

    function readTransitionHint() {
        try {
            var raw = sessionStorage.getItem(TRANSITION_HINT_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.ts || (Date.now() - parsed.ts) > TRANSITION_HINT_TTL) {
                sessionStorage.removeItem(TRANSITION_HINT_KEY);
                return null;
            }
            return parsed;
        } catch (e) {
            return null;
        }
    }

    function readTransitionSnapshot() {
        try {
            var raw = sessionStorage.getItem(TRANSITION_SNAPSHOT_KEY);
            if (!raw) return null;
            var parsed = JSON.parse(raw);
            if (!parsed || !parsed.ts || !parsed.html || (Date.now() - parsed.ts) > TRANSITION_HINT_TTL) {
                sessionStorage.removeItem(TRANSITION_SNAPSHOT_KEY);
                return null;
            }
            return parsed;
        } catch (e) {
            return null;
        }
    }

    var transitionHint = readTransitionHint();
    var transitionSnapshot = readTransitionSnapshot();
    var isTransitionNavigation = !!transitionHint;
    var OVERLAY_FADE_MS = isTransitionNavigation ? 180 : 140;

    function notifyMainFrameTransitionReady() {
        try {
            if (window.name === 'main_frm' && window.top) {
                window.top.postMessage({
                    type: 'SWIS_MAIN_FRAME_TRANSITION_READY',
                    frameName: window.name,
                    path: location.pathname
                }, '*');
            }
        } catch (e) {
            // ignore cross-frame notify failures
        }
    }

    function buildOverlayCss(backgroundColor, frameBorderColor, transitionMode) {
        var overlayScale = transitionMode ? '1.018' : '1.012';
        var bodyDuration = transitionMode ? (OVERLAY_FADE_MS + 40) : (OVERLAY_FADE_MS + 20);
        var bodyOpacity = transitionMode ? '0.88' : '0.93';
        var bodyTranslate = transitionMode ? '8px' : '4px';
        var bodyScale = transitionMode ? '0.994' : '0.997';
        var topSheen = transitionMode ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)';
        return [
            'html::after{content:"";position:fixed;top:0;left:0;width:100%;height:100%;z-index:2147483647;',
            'background:linear-gradient(180deg,', topSheen, ',rgba(255,255,255,0) 28%),', backgroundColor, ';',
            'opacity:1;pointer-events:none;will-change:opacity,transform;transform:scale(1);transform-origin:50% 0;',
            'transition:opacity ', OVERLAY_FADE_MS, 'ms cubic-bezier(0.22,1,0.36,1),transform ', (OVERLAY_FADE_MS + 40), 'ms cubic-bezier(0.22,1,0.36,1)}',
            '#swis-transition-snapshot-host{position:fixed;inset:0;z-index:2147483646;overflow:hidden;pointer-events:none;opacity:1;transform:scale(1);transform-origin:50% 0;',
            'background:', backgroundColor, ';transition:opacity ', OVERLAY_FADE_MS, 'ms cubic-bezier(0.22,1,0.36,1),transform ', (OVERLAY_FADE_MS + 40), 'ms cubic-bezier(0.22,1,0.36,1)}',
            '#swis-transition-snapshot-host iframe{width:100%;height:100%;border:0;display:block;pointer-events:none;background:', backgroundColor, ';}',
            'html.swis-transition-handoff::after{box-shadow:inset 0 1px 0 rgba(255,255,255,0.24),0 10px 28px rgba(0,0,0,0.04)}',
            'html.swis-early-reveal #swis-transition-snapshot-host{opacity:0;transform:scale(', overlayScale, ')}',
            'html.swis-early-reveal::after{opacity:0;transform:scale(', overlayScale, ')}',
            'html.swis-early-reveal body{animation:swis-page-unveil ', bodyDuration, 'ms cubic-bezier(0.22,1,0.36,1);transform-origin:50% 0}',
            '@keyframes swis-page-unveil{from{opacity:', bodyOpacity, ';transform:translate3d(0,', bodyTranslate, ',0) scale(', bodyScale, ')}to{opacity:1;transform:translate3d(0,0,0) scale(1)}}',
            frameBorderColor ? 'frame,iframe{background-color:' + backgroundColor + '!important;border-color:' + frameBorderColor + '!important}' : ''
        ].join('');
    }

    function createTransitionSnapshotHost(snapshot) {
        if (!snapshot || !snapshot.html) return null;

        try {
            var host = document.createElement('div');
            host.id = 'swis-transition-snapshot-host';

            var frame = document.createElement('iframe');
            frame.setAttribute('aria-hidden', 'true');
            frame.setAttribute('scrolling', 'no');
            frame.setAttribute('sandbox', 'allow-same-origin');
            frame.srcdoc = snapshot.html;
            frame.addEventListener('load', function() {
                try {
                    frame.contentWindow.scrollTo(snapshot.scrollX || 0, snapshot.scrollY || 0);
                    if (frame.contentDocument && frame.contentDocument.body) {
                        frame.contentDocument.body.style.pointerEvents = 'none';
                    }
                } catch (e) {
                    // ignore snapshot iframe access failures
                }
            });

            host.appendChild(frame);
            (document.documentElement || document.body).appendChild(host);
            return host;
        } catch (e) {
            return null;
        }
    }

    function cleanupOverlay() {
        var o = document.getElementById('swis-early-overlay');
        if (o) o.remove();
        var snapshotHost = document.getElementById('swis-transition-snapshot-host');
        if (snapshotHost) snapshotHost.remove();
        document.documentElement.classList.remove('swis-early-reveal');
        document.documentElement.classList.remove('swis-transition-handoff');
        document.documentElement.style.removeProperty('background');
        try {
            sessionStorage.removeItem(TRANSITION_HINT_KEY);
            sessionStorage.removeItem(TRANSITION_SNAPSHOT_KEY);
        } catch (e) {}
        notifyMainFrameTransitionReady();
    }

    function revealOverlay() {
        if (revealed) return;
        revealed = true;
        document.documentElement.classList.add('swis-early-reveal');
        setTimeout(cleanupOverlay, OVERLAY_FADE_MS + 40);
    }

    var overlay = document.createElement('style');
    overlay.id = 'swis-early-overlay';
    if (isTransitionNavigation) {
        document.documentElement.classList.add('swis-transition-handoff');
    }
    overlay.textContent = buildOverlayCss('#eee6dc', '#ccb8a3', isTransitionNavigation);
    (document.head || document.documentElement).appendChild(overlay);

    if (transitionSnapshot && transitionSnapshot.html) {
        createTransitionSnapshotHost(transitionSnapshot);
    }

    var revealed = false;

    document.addEventListener('readystatechange', function() {
        if (document.readyState === 'interactive' || document.readyState === 'complete') {
            revealOverlay();
        }
    });

    document.addEventListener('DOMContentLoaded', revealOverlay);

    if (document.readyState !== 'loading') {
        revealOverlay();
    }

    setTimeout(revealOverlay, 1100);
})();

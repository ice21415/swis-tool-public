(function () {
    if (window.hasRunSwisLateInit) return;
    window.hasRunSwisLateInit = true;

    if (typeof window.runDeferredExtensionFeatures === 'function') {
        window.runDeferredExtensionFeatures();
    }
})();
// ==UserScript==
// @name         F95-Zone Skipper Ultra (EARLY AI TESTS)
// @namespace    f95-skipper-2-aitest
// @version      0.1.9
// @description  F95Zone /dl/ and legacy /masked/ skipper.
// @author       Cat-Ling
// @homepageURL  https://github.com/Cat-Ling
// @icon         https://www.google.com/s2/favicons?sz=64&domain=f95zone.to
// @match        https://f95zone.to/dl/*
// @match        https://f95zone.to/masked/*
// @match        https://www.google.com/recaptcha/*
// @match        https://recaptcha.net/recaptcha/*
// @exclude      https://f95zone.to/masked/
// @license      GPL-2.0
// @downloadURL  https://raw.githubusercontent.com/Cat-Ling/f95zone-skipper/main/f95-skipper-ultra_AI-experiments.user.js
// @updateURL    https://raw.githubusercontent.com/Cat-Ling/f95zone-skipper/main/f95-skipper-ultra_AI-experiments.user.js
// @supportURL   https://github.com/Cat-Ling/f95zone-skipper/issues
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    var F95_SITE_KEY = '6LcwQ5kUAAAAAAI-_CXQtlnhdMjmFDt-MruZ2gov';

    // F95's captured XenForo handler uses 2100ms. Add a small activation
    // margin and measure from DOMContentLoaded/page discovery, not responseStart.
    var DL_CODE_DELAY_MS = 2350;

    var DL_FETCH_TIMEOUT_MS = 20000;
    var DL_CAPTCHA_POLL_MS = 250;
    var DL_CAPTCHA_API_TIMEOUT_MS = 60000;
    var DL_REDIRECT_PAINT_MS = 450;
    var MASKED_TIMEOUT_MS = 20000;

    function onDomReady(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback, { once: true });
        } else {
            callback();
        }
    }

    function isF95Host() {
        var hostname = window.location.hostname;
        return hostname === 'f95zone.to' || hostname.endsWith('.f95zone.to');
    }

    function getHttpUrl(value, absoluteOnly) {
        if (typeof value !== 'string' || !value.trim()) return null;

        value = value.trim();

        if (absoluteOnly && !/^https?:\/\//i.test(value)) return null;

        try {
            var url = new URL(value, window.location.href);

            return url.protocol === 'http:' || url.protocol === 'https:'
                ? url.href
                : null;
        } catch (error) {
            return null;
        }
    }

    function decodeF95Code(encoded) {
        if (!encoded) return '';

        try {
            return window.atob(
                String(encoded).replace(/^c/, '')
            ).split('').reverse().join('');
        } catch (error) {
            return '';
        }
    }

    function nativeSubmit(form) {
        if (!form) return;

        try {
            window.HTMLFormElement.prototype.submit.call(form);
        } catch (error) {
            try {
                form.submit();
            } catch (fallbackError) {
                console.error(
                    '[F95-Zone Skipper Ultra] Native form submission failed.',
                    fallbackError
                );
            }
        }
    }

    // Retained legacy Google reCAPTCHA checkbox click attempt.
    // This does not solve image challenges or guarantee acceptance.
    if (
        window.location.href.includes('recaptcha') &&
        window.location.href.includes(F95_SITE_KEY)
    ) {
        var recaptchaAttempts = 0;

        var recaptchaTimer = window.setInterval(function () {
            var checkbox =
                document.querySelector('.recaptcha-checkbox-checkmark') ||
                document.querySelector('.recaptcha-checkbox-border');

            if (checkbox) {
                checkbox.click();
                window.clearInterval(recaptchaTimer);
            } else if (++recaptchaAttempts >= 120) {
                window.clearInterval(recaptchaTimer);
            }
        }, 250);

        return;
    }

    if (!isF95Host()) return;

    var pathname = window.location.pathname;

    // =====================================================================
    // /dl/ — pre-armed skipper with managed-challenge detection and backoff
    // =====================================================================

    if (pathname.startsWith('/dl/')) {
        var dlObserver = null;
        var dlObserverActive = false;
        var dlTimer = null;
        var cfProbeTimer = null;
        var fetchTimeoutTimer = null;

        var dlRedirectTimer = null;
        var dlStatusPanel = null;
        var dlStatusTitle = null;
        var dlStatusLink = null;

        var dlCaptchaTimer = null;
        var dlCaptchaDetectedAt = null;
        var dlCaptchaExecuteAttempted = false;
        var dlCaptchaExecuteAt = 0;
        var dlCaptchaNativeFallback = false;

        var dlPage = null;
        var dlForm = null;
        var dlPageDetectedAt = null;

        var dlDomReadyAt =
            document.readyState === 'loading'
                ? null
                : performance.now();

        var dlCancelled = false;
        var dlRequestStarted = false;
        var dlRedirecting = false;
        var dlChallengeMode = false;
        var dlSawChallenge = false;
        var dlPausedAfterChallenge = false;
        var dlChallengeBackoffMs = 1500;
        var dlAbortController = null;
        var dlFetchChallengeReloadAttempted = false;
        var dlNativeFallback = false;
        var dlPriorPostAttempt = false;
        var dlNativeFallbackTimer = null;
        var dlButtonReadyTimer = null;
        var dlButtonReadyAttempts = 0;
        var dlOriginalAutoAttribute = null;
        var dlAutoAttributeSaved = false;
        var dlSubmitHandler = null;
        var dlSubmitForm = null;

        var dlFetchChallengeRetryKey =
            'f95zone-skipper:dl-challenge-retry:' + window.location.href;

        var dlPostAttemptKey =
            'f95zone-skipper:dl-post-attempt:' + window.location.href;

        function dlCameBack() {
            try {
                var entries = performance.getEntriesByType('navigation');

                if (entries && entries.length) {
                    return entries[0].type === 'back_forward';
                }

                return !!(
                    performance.navigation &&
                    performance.navigation.type === 2
                );
            } catch (error) {
                return false;
            }
        }

        // Do not immediately re-trigger a download when restored by Back.
        if (dlCameBack()) return;

        function safeSessionGet(key) {
            try {
                return sessionStorage.getItem(key);
            } catch (error) {
                return null;
            }
        }

        function safeSessionSet(key, value) {
            try {
                sessionStorage.setItem(key, value);
            } catch (error) {}
        }

        function safeSessionRemove(key) {
            try {
                sessionStorage.removeItem(key);
            } catch (error) {}
        }

        // A fetch POST can reach F95 even when the browser loses the response.
        // Never issue a second automatic POST after an ambiguous outcome.
        dlPriorPostAttempt = safeSessionGet(dlPostAttemptKey) === '1';

        function dlHasNativePageMarkup(doc) {
            return !!doc.querySelector(
                '[data-xf-init~="f95dl-page"], ' +
                '[data-xf-init~="f95dl-go"], form.f95dl-box'
            );
        }

        function dlIsCloudflareChallengeDocument(doc) {
            doc = doc || document;

            // Normal F95 markup takes precedence over challenge heuristics.
            if (dlHasNativePageMarkup(doc)) return false;

            var title = (doc.title || '').trim();

            var titleLooksLikeChallenge =
                /^(just a moment|attention required|checking your browser|security verification)/i
                    .test(title);

            var bodyText = '';

            try {
                bodyText = (
                    doc.body &&
                    (doc.body.innerText || doc.body.textContent) ||
                    ''
                ).slice(0, 12000);
            } catch (error) {}

            var textLooksLikeChallenge =
                /performing security verification|verification successful\. waiting for|this website uses a security service to protect against malicious bots|enable javascript and cookies to continue/i
                    .test(bodyText);

            var hasChallengePlatform = !!doc.querySelector(
                'script[src*="/cdn-cgi/challenge-platform/"]'
            );

            var hasTurnstileScript = !!doc.querySelector(
                'script[src*="challenges.cloudflare.com/turnstile/"]'
            );

            var hasRefreshMeta = !!doc.querySelector(
                'meta[http-equiv="refresh" i]'
            );

            var hasChallengeToken =
                /(?:\?|&)__cf_chl_(?:rt_)?tk=/i.test(window.location.search);

            var hasCfOptions = false;

            try {
                hasCfOptions = !!window._cf_chl_opt;
            } catch (error) {}

            var cloudflareSignal =
                hasChallengePlatform ||
                hasTurnstileScript ||
                hasRefreshMeta ||
                hasChallengeToken ||
                hasCfOptions;

            return !!(
                hasCfOptions ||
                (
                    cloudflareSignal &&
                    (titleLooksLikeChallenge || textLooksLikeChallenge)
                ) ||
                (hasChallengeToken && hasChallengePlatform)
            );
        }

        function dlLooksLikeCloudflareChallengeHtml(html) {
            if (typeof html !== 'string' || !html) return false;

            var challengeTitle =
                /<title[^>]*>\s*(?:just a moment|attention required|checking your browser)/i
                    .test(html);

            var challengePlatform =
                /\/cdn-cgi\/challenge-platform\//i.test(html);

            var turnstile =
                /challenges\.cloudflare.com\/turnstile\//i.test(html);

            var challengeText =
                /performing security verification|verification successful\. waiting for|this website uses a security service to protect against malicious bots/i
                    .test(html);

            var cfOptions = /window\._cf_chl_opt\s*=/.test(html);

            return !!(
                (
                    challengeTitle &&
                    (challengePlatform || turnstile || challengeText)
                ) ||
                (cfOptions && challengePlatform)
            );
        }

        function dlGetGoUrl(element) {
            if (!element) return '';

            // The supplied rendered wrapper uses data-url.
            return element.getAttribute('data-url') ||
                element.getAttribute('data-f95dl-go-url') ||
                '';
        }

        // Reuse the exact F95 redirector presentation while the automated
        // POST is waiting. The form remains in the DOM until FormData has
        // been serialized, so its hidden fields and CAPTCHA response survive.
        function dlInstallStatusStyles() {
            if (document.getElementById('f95-skipper-status-style')) return;

            var style = document.createElement('style');
            style.id = 'f95-skipper-status-style';
            style.textContent =
                '.f95dl-spinner{display:inline-block;width:1em;height:1em;margin-right:.5em;' +
                'border:2px solid currentColor;border-right-color:transparent;border-radius:50%;' +
                'vertical-align:-.15em;box-sizing:border-box;animation:f95dl-spin .7s linear infinite}' +
                '@keyframes f95dl-spin{to{transform:rotate(360deg)}}' +
                '.f95dl-going{max-width:560px;margin:28px auto;text-align:center}' +
                '.f95dl-going-title{font-size:1.5rem;font-weight:600}' +
                '.f95dl-going-link{margin-top:10px;color:#9398a0;font-size:1.3rem}' +
                '@media(prefers-reduced-motion:reduce){.f95dl-spinner{animation-duration:2s}}';

            (document.head || document.documentElement).appendChild(style);
        }

        function dlGetStatusRoot() {
            return document.querySelector('.f95dl-page') ||
                document.querySelector('.f95dl-shell-main') ||
                document.querySelector('main') ||
                document.body ||
                document.documentElement;
        }

        function dlGetInitialStatusMessage(form) {
            var hostElement = form && form.querySelector('.f95dl-link-host');
            var host = hostElement
                ? (hostElement.textContent || '').trim()
                : '';

            return host
                ? 'Opening ' + host + '…'
                : 'Generating your link…';
        }

        function dlCreateStatusPanel(message) {
            var panel = document.createElement('div');
            panel.className = 'blockMessage f95dl-going';
            panel.setAttribute('role', 'status');
            panel.setAttribute('aria-live', 'polite');
            panel.setAttribute('data-f95-skipper-status', '1');

            var title = document.createElement('div');
            title.className = 'f95dl-going-title';

            var spinner = document.createElement('span');
            spinner.className = 'f95dl-spinner';
            spinner.setAttribute('aria-hidden', 'true');

            title.appendChild(spinner);
            title.appendChild(document.createTextNode(message || 'Generating your link…'));
            panel.appendChild(title);

            return panel;
        }

        function dlShowActivity(message) {
            if (dlCancelled || dlRedirecting) return;

            dlInstallStatusStyles();

            if (!dlStatusPanel || !dlStatusPanel.isConnected) {
                dlStatusPanel = dlCreateStatusPanel(message);
                dlStatusTitle = dlStatusPanel.querySelector('.f95dl-going-title');
                dlStatusLink = null;

                var root = dlGetStatusRoot();
                if (root) {
                    root.insertBefore(dlStatusPanel, root.firstChild);
                }
                return;
            }

            if (dlStatusTitle) {
                var spinner = dlStatusTitle.querySelector('.f95dl-spinner');
                dlStatusTitle.textContent = '';

                if (spinner) {
                    dlStatusTitle.appendChild(spinner);
                } else {
                    spinner = document.createElement('span');
                    spinner.className = 'f95dl-spinner';
                    spinner.setAttribute('aria-hidden', 'true');
                    dlStatusTitle.appendChild(spinner);
                }

                dlStatusTitle.appendChild(
                    document.createTextNode(message || 'Generating your link…')
                );
            }
        }

        function dlRememberAutoAttribute(page) {
            if (!page || dlAutoAttributeSaved) return;

            dlOriginalAutoAttribute = page.getAttribute('data-auto');
            dlAutoAttributeSaved = true;
        }

        function dlRestoreAutoAttribute() {
            if (!dlAutoAttributeSaved || !dlPage || !dlPage.isConnected) {
                return;
            }

            if (dlOriginalAutoAttribute === null) {
                dlPage.removeAttribute('data-auto');
            } else {
                dlPage.setAttribute('data-auto', dlOriginalAutoAttribute);
            }
        }

        function dlRemoveSubmitInterceptor() {
            if (dlSubmitForm && dlSubmitHandler) {
                dlSubmitForm.removeEventListener(
                    'submit',
                    dlSubmitHandler,
                    true
                );
                delete dlSubmitForm.dataset.f95SkipSubmitListener;
            }

            dlSubmitHandler = null;
            dlSubmitForm = null;
        }

        function dlShowNativeFallback(message) {
            if (dlCancelled || dlRedirecting) return;

            dlNativeFallback = true;
            dlRequestStarted = true;

            if (dlTimer !== null) {
                window.clearTimeout(dlTimer);
                dlTimer = null;
            }

            if (cfProbeTimer !== null) {
                window.clearTimeout(cfProbeTimer);
                cfProbeTimer = null;
            }

            if (fetchTimeoutTimer !== null) {
                window.clearTimeout(fetchTimeoutTimer);
                fetchTimeoutTimer = null;
            }

            if (dlNativeFallbackTimer !== null) {
                window.clearTimeout(dlNativeFallbackTimer);
                dlNativeFallbackTimer = null;
            }

            if (dlButtonReadyTimer !== null) {
                window.clearTimeout(dlButtonReadyTimer);
                dlButtonReadyTimer = null;
            }

            dlStopCaptchaMonitor();
            dlStopObserver();
            dlRemoveSubmitInterceptor();
            dlRestoreAutoAttribute();

            dlShowActivity(message ||
                'Automatic request could not be verified. Continue with F95 manually.');

            if (dlStatusTitle) {
                var fallbackSpinner = dlStatusTitle.querySelector('.f95dl-spinner');
                if (fallbackSpinner) fallbackSpinner.remove();
            }

            if (!dlStatusPanel || !dlStatusPanel.isConnected) return;

            var existing = dlStatusPanel.querySelector(
                '[data-f95-skipper-native-fallback]'
            );

            if (existing) return;

            var actions = document.createElement('div');
            actions.className = 'f95dl-going-link';
            actions.setAttribute('data-f95-skipper-native-fallback', '1');

            var button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Continue using F95';
            button.style.cssText =
                'margin:12px 0 0;padding:9px 16px;border:1px solid currentColor;' +
                'border-radius:4px;background:transparent;color:inherit;' +
                'font:inherit;cursor:pointer';

            button.addEventListener('click', function () {
                dlContinueWithNativeFlow();
            }, { once: true });

            actions.appendChild(button);
            dlStatusPanel.appendChild(actions);
        }

        function dlContinueWithNativeFlow() {
            if (dlCancelled || dlRedirecting || !dlForm) return;

            // This is an explicit user action. Clear the guard so the native
            // F95 form flow, rather than another automatic fetch, can proceed.
            safeSessionRemove(dlPostAttemptKey);

            dlNativeFallback = true;
            dlRequestStarted = false;
            dlRemoveSubmitInterceptor();
            dlStopObserver();
            dlStopCaptchaMonitor();

            if (dlTimer !== null) {
                window.clearTimeout(dlTimer);
                dlTimer = null;
            }

            if (cfProbeTimer !== null) {
                window.clearTimeout(cfProbeTimer);
                cfProbeTimer = null;
            }

            if (fetchTimeoutTimer !== null) {
                window.clearTimeout(fetchTimeoutTimer);
                fetchTimeoutTimer = null;
            }

            if (dlButtonReadyTimer !== null) {
                window.clearTimeout(dlButtonReadyTimer);
                dlButtonReadyTimer = null;
            }

            dlRestoreAutoAttribute();

            if (dlStatusPanel && dlStatusPanel.parentNode) {
                dlStatusPanel.parentNode.removeChild(dlStatusPanel);
            }

            dlStatusPanel = dlStatusTitle = dlStatusLink = null;

            var attempts = 0;
            var maxAttempts = 80;

            function submitWhenReady() {
                dlNativeFallbackTimer = null;

                if (dlCancelled || dlRedirecting || !dlForm ||
                    !dlForm.isConnected) {
                    return;
                }

                var button = dlGetContinueButton();

                if (dlIsContinueButtonReady(button)) {
                    button.click();
                    return;
                }

                if (++attempts < maxAttempts) {
                    dlNativeFallbackTimer = window.setTimeout(
                        submitWhenReady,
                        250
                    );
                    return;
                }

                // requestSubmit preserves submit events and the site's native
                // handler. Only use the legacy submit() fallback when needed.
                try {
                    if (typeof dlForm.requestSubmit === 'function') {
                        dlForm.requestSubmit();
                    } else {
                        nativeSubmit(dlForm);
                    }
                } catch (error) {
                    nativeSubmit(dlForm);
                }
            }

            submitWhenReady();
        }

        function dlShowResolvedWrapper(sourceWrapper, destination) {
            dlInstallStatusStyles();

            var sourceIsLive = !!(sourceWrapper && sourceWrapper.isConnected);

            // If the wrapper came from the live document, neutralize the
            // original node before cloning it so XenForo cannot race our
            // short paint delay with its own immediate location.replace().
            if (sourceIsLive) {
                sourceWrapper.removeAttribute('data-xf-init');
                sourceWrapper.removeAttribute('data-url');
                sourceWrapper.removeAttribute('data-f95dl-go-url');
            }

            var panel = sourceWrapper
                ? sourceWrapper.cloneNode(true)
                : dlCreateStatusPanel('Opening your download host…');

            // Do not let XenForo's native handler race our short paint delay.
            panel.removeAttribute('data-xf-init');
            panel.removeAttribute('data-url');
            panel.removeAttribute('data-f95dl-go-url');
            panel.setAttribute('role', 'status');
            panel.setAttribute('aria-live', 'polite');
            panel.setAttribute('data-f95-skipper-status', '1');

            var title = panel.querySelector('.f95dl-going-title');
            if (!title) {
                title = document.createElement('div');
                title.className = 'f95dl-going-title';

                var spinner = document.createElement('span');
                spinner.className = 'f95dl-spinner';
                spinner.setAttribute('aria-hidden', 'true');

                title.appendChild(spinner);
                title.appendChild(document.createTextNode('Opening your download host…'));
                panel.insertBefore(title, panel.firstChild);
            } else if (!title.querySelector('.f95dl-spinner')) {
                var titleSpinner = document.createElement('span');
                titleSpinner.className = 'f95dl-spinner';
                titleSpinner.setAttribute('aria-hidden', 'true');
                title.insertBefore(titleSpinner, title.firstChild);
            }

            var linkContainer = panel.querySelector('.f95dl-going-link');
            if (!linkContainer) {
                linkContainer = document.createElement('div');
                linkContainer.className = 'f95dl-going-link';
                panel.appendChild(linkContainer);
            }

            var link = linkContainer.querySelector('a');
            if (!link) {
                link = document.createElement('a');
                linkContainer.textContent = 'Nothing happening? ';
                linkContainer.appendChild(link);
            }

            link.href = destination;
            link.rel = 'noopener';

            if (!link.textContent.trim()) {
                var host = new URL(destination).hostname;
                link.textContent = 'Continue to ' + host;
            }

            link.addEventListener('click', function () {
                if (dlRedirectTimer !== null) {
                    window.clearTimeout(dlRedirectTimer);
                    dlRedirectTimer = null;
                }
            }, { once: true });

            if (dlStatusPanel && dlStatusPanel.parentNode) {
                dlStatusPanel.parentNode.replaceChild(panel, dlStatusPanel);

                if (
                    sourceIsLive &&
                    sourceWrapper !== dlStatusPanel &&
                    sourceWrapper.parentNode
                ) {
                    sourceWrapper.parentNode.removeChild(sourceWrapper);
                }
            } else if (sourceIsLive && sourceWrapper.parentNode) {
                sourceWrapper.parentNode.replaceChild(panel, sourceWrapper);
            } else {
                var root = dlGetStatusRoot();
                if (root) root.insertBefore(panel, root.firstChild);
            }

            dlStatusPanel = panel;
            dlStatusTitle = title;
            dlStatusLink = link;

            return panel;
        }

        function dlBeginRedirect(destination, sourceWrapper) {
            if (dlRedirecting || !destination) return;

            dlRedirecting = true;
            safeSessionRemove(dlFetchChallengeRetryKey);
            safeSessionRemove(dlPostAttemptKey);
            dlStopObserver();
            dlStopCaptchaMonitor();

            if (dlTimer !== null) {
                window.clearTimeout(dlTimer);
                dlTimer = null;
            }

            if (cfProbeTimer !== null) {
                window.clearTimeout(cfProbeTimer);
                cfProbeTimer = null;
            }

            if (fetchTimeoutTimer !== null) {
                window.clearTimeout(fetchTimeoutTimer);
                fetchTimeoutTimer = null;
            }

            dlShowResolvedWrapper(sourceWrapper, destination);

            // Give the browser two frames plus a short interval to paint the
            // spinner and provider-specific fallback link before leaving.
            var navigate = function () {
                dlRedirectTimer = window.setTimeout(function () {
                    dlRedirectTimer = null;
                    window.location.replace(destination);
                }, DL_REDIRECT_PAINT_MS);
            };

            if (typeof window.requestAnimationFrame === 'function') {
                window.requestAnimationFrame(function () {
                    window.requestAnimationFrame(navigate);
                });
            } else {
                navigate();
            }
        }

        function dlStopObserver() {
            if (dlObserver && dlObserverActive) {
                dlObserver.disconnect();
                dlObserverActive = false;
            }
        }

        function dlInstallObserver() {
            if (dlCancelled || dlRedirecting || dlObserverActive) return;

            try {
                if (!dlObserver) {
                    dlObserver = new MutationObserver(dlOnMutation);
                }

                dlObserver.observe(document, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: [
                        'title',
                        'http-equiv',
                        'src',
                        'data-xf-init',
                        'data-code',
                        'data-auto',
                        'data-url',
                        'data-f95dl-page-code',
                        'data-f95dl-go-url'
                    ]
                });

                dlObserverActive = true;
            } catch (error) {
                // Compatibility fallback for browsers without a usable
                // MutationObserver. Avoid aggressive polling during challenge.
                if (cfProbeTimer === null) {
                    cfProbeTimer = window.setTimeout(function fallbackProbe() {
                        cfProbeTimer = null;

                        if (dlCancelled || dlRedirecting) return;

                        if (dlIsCloudflareChallengeDocument(document)) {
                            dlEnterChallengeMode();
                        } else {
                            dlArm();

                            cfProbeTimer = window.setTimeout(
                                fallbackProbe,
                                750
                            );
                        }
                    }, 750);
                }
            }
        }

        function dlRedirectToGoWrapper() {
            if (
                dlRedirecting ||
                dlIsCloudflareChallengeDocument(document)
            ) {
                return false;
            }

            var wrappers = document.querySelectorAll(
                '[data-xf-init~="f95dl-go"]'
            );

            for (var i = 0; i < wrappers.length; i++) {
                var destination = getHttpUrl(
                    dlGetGoUrl(wrappers[i]),
                    true
                );

                if (!destination) continue;

                dlBeginRedirect(destination, wrappers[i]);
                return true;
            }

            return false;
        }

        function dlEnterChallengeMode() {
            if (dlCancelled || dlRedirecting) return;

            dlSawChallenge = true;

            if (!dlChallengeMode) {
                dlChallengeMode = true;
                dlChallengeBackoffMs = 1500;
                dlStopObserver();

                if (dlTimer !== null) {
                    window.clearTimeout(dlTimer);
                    dlTimer = null;
                }

                console.info(
                    '[F95-Zone Skipper Ultra] Cloudflare challenge detected; ' +
                    'pausing requests and backing off.'
                );
            }

            if (cfProbeTimer === null) {
                cfProbeTimer = window.setTimeout(
                    dlChallengeBackoffProbe,
                    dlChallengeBackoffMs
                );
            }
        }

        function dlChallengeBackoffProbe() {
            cfProbeTimer = null;

            if (dlCancelled || dlRedirecting) return;

            if (dlIsCloudflareChallengeDocument(document)) {
                dlChallengeMode = true;
                dlStopObserver();

                dlChallengeBackoffMs = Math.min(
                    10000,
                    Math.round(dlChallengeBackoffMs * 1.7)
                );

                cfProbeTimer = window.setTimeout(
                    dlChallengeBackoffProbe,
                    dlChallengeBackoffMs
                );

                return;
            }

            if (dlChallengeMode) {
                dlChallengeMode = false;
                dlChallengeBackoffMs = 1500;
                dlInstallObserver();
                dlArm();
            }
        }

        // F95 currently renders /dl/ verification through XenForo's
        // invisible hCaptcha handler. Keep that existing widget and callback;
        // never replace it with a second render() call.
        function dlGetHCaptchaContainer(form) {
            if (!form) return null;

            return form.querySelector(
                '[data-xf-init~="h-captcha"], ' +
                '.h-captcha[data-sitekey], ' +
                '[data-sitekey][data-invisible]'
            );
        }

        function dlHasHCaptcha(form) {
            return !!dlGetHCaptchaContainer(form);
        }

        function dlHasOtherCaptcha(form) {
            if (!form || dlHasHCaptcha(form)) return false;

            return !!form.querySelector(
                '.g-recaptcha, .cf-turnstile, ' +
                '[data-xf-init~="recaptcha"], ' +
                '[data-xf-init~="turnstile"], ' +
                'iframe[src*="recaptcha"], ' +
                'iframe[src*="challenges.cloudflare.com"], ' +
                'input[name="cf-turnstile-response"]'
            );
        }

        function dlReadHCaptchaToken(form) {
            if (!form) return '';

            // hCaptcha inserts h-captcha-response into the owning form.
            // F95's compatibility configuration may also populate the
            // g-recaptcha-response alias with the same token.
            var selectors = [
                'textarea[name="h-captcha-response"]',
                'input[name="h-captcha-response"]',
                'textarea[name="g-recaptcha-response"]',
                'input[name="g-recaptcha-response"]'
            ];

            for (var i = 0; i < selectors.length; i++) {
                var field = form.querySelector(selectors[i]);

                var value = field && typeof field.value === 'string'
                    ? field.value.trim()
                    : '';

                if (value.length > 20) return value;
            }

            return '';
        }

        function dlStopCaptchaMonitor() {
            if (dlCaptchaTimer !== null) {
                window.clearInterval(dlCaptchaTimer);
                dlCaptchaTimer = null;
            }
        }

        function dlCaptchaSolved(form) {
            if (
                dlCancelled ||
                dlRedirecting ||
                dlRequestStarted ||
                dlCaptchaNativeFallback
            ) {
                return false;
            }

            var token = dlReadHCaptchaToken(form);
            if (!token) return false;

            dlStopCaptchaMonitor();
            dlPopulateForm(dlPage, form);

            console.info(
                '[F95-Zone Skipper Ultra] hCaptcha response detected; continuing download.'
            );

            dlScheduleRequest();
            return true;
        }

        function dlTryExecuteHCaptcha(form, manualRetry) {
            if (
                dlCancelled ||
                dlRedirecting ||
                dlRequestStarted
            ) {
                return false;
            }

            // Automatic execution happens once. A real Continue click may
            // retry a dismissed/failed invisible challenge after a cooldown.
            if (
                dlCaptchaExecuteAttempted &&
                (!manualRetry || performance.now() - dlCaptchaExecuteAt < 5000)
            ) {
                return false;
            }

            var container = dlGetHCaptchaContainer(form);

            if (!container || !container.hasAttribute('data-invisible')) {
                return false;
            }

            if (!window.hcaptcha || typeof window.hcaptcha.execute !== 'function') {
                return false;
            }

            // Wait for XenForo's own HCaptcha handler to render its widget.
            // The generated response textarea or iframe is a reliable signal.
            var responseField = form.querySelector(
                'textarea[name="h-captcha-response"], ' +
                'input[name="h-captcha-response"]'
            );

            var widgetFrame = container.querySelector('iframe');

            if (!responseField && !widgetFrame) return false;

            try {
                // hCaptcha defaults to the first rendered widget when no ID
                // is supplied. F95's /dl/ form has one widget.
                window.hcaptcha.execute();

                dlCaptchaExecuteAttempted = true;
                dlCaptchaExecuteAt = performance.now();

                console.info(
                    '[F95-Zone Skipper Ultra] Started the page hCaptcha workflow; waiting for verification.'
                );

                return true;
            } catch (error) {
                // XenForo may still be finishing widget initialization.
                // The monitor retries without rendering a duplicate widget.
                return false;
            }
        }

        function dlCheckHCaptcha(form) {
            if (
                dlCancelled ||
                dlRedirecting ||
                dlRequestStarted ||
                dlCaptchaNativeFallback
            ) {
                dlStopCaptchaMonitor();
                return;
            }

            if (
                !document.documentElement ||
                !document.documentElement.contains(form)
            ) {
                dlStopCaptchaMonitor();
                return;
            }

            if (dlCaptchaSolved(form)) return;

            var container = dlGetHCaptchaContainer(form);

            if (!container) {
                dlStopCaptchaMonitor();
                return;
            }

            if (dlCaptchaDetectedAt === null) {
                dlCaptchaDetectedAt = performance.now();
            }

            if (container.hasAttribute('data-invisible')) {
                dlTryExecuteHCaptcha(form);

                // Give the challenge time to be completed. If it has not
                // completed, leave F95's native flow usable.
                if (
                    performance.now() -
                    (dlCaptchaExecuteAttempted
                        ? dlCaptchaExecuteAt
                        : dlCaptchaDetectedAt) >= DL_CAPTCHA_API_TIMEOUT_MS
                ) {
                    dlCaptchaNativeFallback = true;
                    dlStopCaptchaMonitor();

                    console.warn(
                        '[F95-Zone Skipper Ultra] hCaptcha did not complete in time. ' +
                        'Falling back to F95 native Continue flow.'
                    );
                }
            }
        }

        function dlStartCaptchaMonitor(form) {
            if (!dlHasHCaptcha(form) || dlCaptchaNativeFallback) return;

            if (dlCaptchaDetectedAt === null) {
                dlCaptchaDetectedAt = performance.now();
            }

            if (dlCaptchaTimer === null) {
                dlCaptchaTimer = window.setInterval(function () {
                    dlCheckHCaptcha(form);
                }, DL_CAPTCHA_POLL_MS);
            }

            dlCheckHCaptcha(form);
        }

        function dlReadCode(page, form) {
            var field =
                page.querySelector('.js-f95dlCode') ||
                form.querySelector('.js-f95dlCode');

            if (!field) {
                return {
                    field: null,
                    encoded: '',
                    decoded: ''
                };
            }

            // XenForo's handler option is "code" (normally data-code).
            var encoded =
                page.getAttribute('data-code') ||
                page.getAttribute('data-f95dl-page-code') ||
                '';

            var decoded = decodeF95Code(encoded);

            if (decoded) {
                field.value = decoded;
            }

            return {
                field: field,
                encoded: encoded,
                decoded: decoded
            };
        }

        function dlPopulateForm(page, form) {
            var codeState = dlReadCode(page, form);

            // Preserve F95's current hidden-field state. The captured native
            // no-challenge transaction sent had_check=0; forcing it to 1
            // changes the request and is not justified by the page markup.
            // XenForo/hCaptcha remains responsible for its own challenge state.

            var token = form.querySelector(
                'input[name="_xfToken"]'
            );

            if (token && !token.value) {
                var csrf = document.documentElement &&
                    document.documentElement.getAttribute('data-csrf');

                if (csrf) {
                    token.value = csrf;
                }
            }

            return codeState;
        }

        function dlGetRemainingDelay() {
            // The captured F95 handler waits 2100ms after its XenForo page
            // handler initializes. responseStart predates that initialization
            // and can make a replayed POST premature. Use DOMContentLoaded /
            // page discovery, plus a small activation margin, instead.
            if (dlDomReadyAt === null) {
                return DL_CODE_DELAY_MS;
            }

            var base = Math.max(
                dlDomReadyAt || 0,
                dlPageDetectedAt || 0
            );

            return Math.max(
                0,
                DL_CODE_DELAY_MS - (performance.now() - base)
            );
        }

        function dlCancel() {
            dlCancelled = true;

            if (dlTimer !== null) {
                window.clearTimeout(dlTimer);
                dlTimer = null;
            }

            if (cfProbeTimer !== null) {
                window.clearTimeout(cfProbeTimer);
                cfProbeTimer = null;
            }

            if (fetchTimeoutTimer !== null) {
                window.clearTimeout(fetchTimeoutTimer);
                fetchTimeoutTimer = null;
            }

            if (dlRedirectTimer !== null) {
                window.clearTimeout(dlRedirectTimer);
                dlRedirectTimer = null;
            }

            if (dlNativeFallbackTimer !== null) {
                window.clearTimeout(dlNativeFallbackTimer);
                dlNativeFallbackTimer = null;
            }

            if (dlButtonReadyTimer !== null) {
                window.clearTimeout(dlButtonReadyTimer);
                dlButtonReadyTimer = null;
            }

            dlRemoveSubmitInterceptor();

            if (dlStatusPanel && dlStatusPanel.parentNode) {
                dlStatusPanel.parentNode.removeChild(dlStatusPanel);
            }

            dlStatusPanel = dlStatusTitle = dlStatusLink = null;

            dlStopCaptchaMonitor();

            if (dlAbortController) {
                try {
                    dlAbortController.abort();
                } catch (error) {}
            }

            dlStopObserver();
        }

        function dlPauseAfterRepeatedChallenge() {
            dlRequestStarted = false;
            dlPausedAfterChallenge = true;
            dlStopCaptchaMonitor();

            console.warn(
                '[F95-Zone Skipper Ultra] A second Cloudflare challenge ' +
                'was returned. Automatic POST attempts are paused; use the ' +
                'normal Continue control after verification.'
            );

            dlShowNativeFallback(
                'Cloudflare returned a second verification page. ' +
                'Automatic requests are paused; continue with F95 manually.'
            );
        }

        function dlHandleFetchChallenge() {
            var alreadyRetried =
                safeSessionGet(dlFetchChallengeRetryKey) === '1';

            if (
                !alreadyRetried &&
                !dlFetchChallengeReloadAttempted
            ) {
                dlFetchChallengeReloadAttempted = true;

                // The challenged fetch response is not accepted as a completed
                // F95 transaction. Permit one clean document-level retry after
                // Cloudflare has had a chance to verify the browser.
                safeSessionRemove(dlPostAttemptKey);
                safeSessionSet(dlFetchChallengeRetryKey, '1');

                if (safeSessionGet(dlFetchChallengeRetryKey) === '1') {
                    // A challenge returned inside fetch cannot perform its
                    // normal top-level verification flow. Reload the original
                    // URL once so Cloudflare can run its own page scripts.
                    window.location.reload();
                    return;
                }
            }

            // Do not loop endlessly if a second POST returns another challenge.
            dlPauseAfterRepeatedChallenge();
        }

        function dlGetContinueButton() {
            return dlPage && dlPage.querySelector('.js-f95dlContinue');
        }

        function dlIsContinueButtonReady(button) {
            if (
                !button ||
                !button.isConnected ||
                button.disabled ||
                button.getAttribute('aria-disabled') === 'true' ||
                button.closest('[hidden], .u-hidden')
            ) {
                return false;
            }

            try {
                var style = window.getComputedStyle(button);
                if (
                    style.display === 'none' ||
                    style.visibility === 'hidden'
                ) {
                    return false;
                }
            } catch (error) {
                return false;
            }

            return true;
        }

        function dlSendRequest() {
            if (
                dlCancelled ||
                dlNativeFallback ||
                dlRequestStarted ||
                dlRedirecting ||
                dlChallengeMode ||
                dlPausedAfterChallenge ||
                !dlPage ||
                !dlForm
            ) {
                return;
            }

            if (dlIsCloudflareChallengeDocument(document)) {
                dlEnterChallengeMode();
                return;
            }

            if (dlRedirectToGoWrapper()) return;

            var continueButton = dlGetContinueButton();

            // The timer is only a lower bound. Use F95's actual button state as
            // the readiness signal, so late XenForo initialization cannot cause
            // an early POST. This is bounded and falls back to native F95.
            if (!dlIsContinueButtonReady(continueButton)) {
                if (dlButtonReadyAttempts >= 40) {
                    dlShowNativeFallback(
                        'F95 did not enable its Continue control in time. ' +
                        'Continue with the native F95 flow.'
                    );
                    return;
                }

                if (dlButtonReadyTimer === null) {
                    dlButtonReadyAttempts += 1;
                    dlButtonReadyTimer = window.setTimeout(function () {
                        dlButtonReadyTimer = null;
                        dlSendRequest();
                    }, DL_CAPTCHA_POLL_MS);
                }
                return;
            }

            dlButtonReadyAttempts = 0;

            if (
                !document.documentElement ||
                !document.documentElement.contains(dlForm)
            ) {
                return;
            }

            if (dlHasHCaptcha(dlForm)) {
                if (!dlReadHCaptchaToken(dlForm)) {
                    dlStartCaptchaMonitor(dlForm);
                    return;
                }
            } else if (dlHasOtherCaptcha(dlForm)) {
                // Unknown CAPTCHA integrations remain under F95's native flow.
                return;
            }

            var codeState = dlPopulateForm(dlPage, dlForm);

            if (
                codeState.encoded &&
                !codeState.decoded &&
                codeState.field &&
                !codeState.field.value
            ) {
                dlShowNativeFallback(
                    'F95 download code could not be decoded. Continue with F95 manually.'
                );
                return;
            }

            var method = String(dlForm.method || 'GET').toUpperCase();

            if (method !== 'POST') {
                dlShowNativeFallback(
                    'F95 form method changed from POST. Continue with F95 manually.'
                );
                return;
            }

            var action;

            try {
                action = new URL(
                    dlForm.action || window.location.href,
                    window.location.href
                );

                if (action.origin !== window.location.origin) {
                    dlShowNativeFallback(
                        'The form action is not same-origin. Continue with F95 manually.'
                    );
                    return;
                }
            } catch (error) {
                dlShowNativeFallback(
                    'The form action could not be validated. Continue with F95 manually.'
                );
                return;
            }

            var body;

            try {
                var formData;

                try {
                    formData = new FormData(dlForm, continueButton);
                } catch (submitterError) {
                    formData = new FormData(dlForm);
                }

                body = new URLSearchParams(formData);
            } catch (error) {
                dlShowNativeFallback(
                    'The native form could not be serialized safely. Continue with F95 manually.'
                );
                return;
            }

            dlShowActivity(dlGetInitialStatusMessage(dlForm));
            dlRequestStarted = true;

            // Persist before dispatch. If the document is later refreshed after
            // an ambiguous network outcome, do not automatically POST again.
            safeSessionSet(dlPostAttemptKey, '1');

            if (typeof AbortController === 'function') {
                dlAbortController = new AbortController();
            }

            var fetchOptions = {
                method: 'POST',
                mode: 'same-origin',
                credentials: 'same-origin',
                redirect: 'follow',
                body: body,
                headers: {
                    // Matches the captured native form content type. Do not add
                    // X-Requested-With: the native F95 request did not send it.
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            };

            if (dlAbortController) {
                fetchOptions.signal = dlAbortController.signal;
            }

            fetchTimeoutTimer = window.setTimeout(function () {
                if (dlAbortController) {
                    try {
                        dlAbortController.abort();
                    } catch (error) {}
                }
            }, DL_FETCH_TIMEOUT_MS);

            fetch(action.href, fetchOptions)
                .then(function (response) {
                    return response.text().then(function (html) {
                        return {
                            ok: response.ok,
                            status: response.status,
                            url: response.url,
                            redirected: response.redirected,
                            contentType: response.headers.get('content-type') || '',
                            html: html
                        };
                    });
                })
                .then(function (result) {
                    if (fetchTimeoutTimer !== null) {
                        window.clearTimeout(fetchTimeoutTimer);
                        fetchTimeoutTimer = null;
                    }

                    if (dlCancelled || dlRedirecting) return;

                    // Inspect HTML before HTTP status: Cloudflare challenge
                    // responses are not guaranteed to use status 200.
                    if (
                        dlLooksLikeCloudflareChallengeHtml(result.html)
                    ) {
                        dlHandleFetchChallenge();
                        return;
                    }

                    if (!result.ok) {
                        dlShowNativeFallback(
                            'F95 returned HTTP ' + result.status +
                            '. The request may have reached the server; ' +
                            'continue manually rather than automatically resubmitting.'
                        );
                        return;
                    }

                    // fetch() cannot reproduce a top-level navigation's
                    // Sec-Fetch-Dest/Mode headers. At minimum, require a
                    // same-origin HTML response before trusting the wrapper.
                    var responseUrl;
                    try {
                        responseUrl = new URL(result.url || action.href);
                    } catch (error) {
                        dlShowNativeFallback(
                            'F95 returned an invalid response URL. Continue manually.'
                        );
                        return;
                    }

                    if (
                        responseUrl.origin !== window.location.origin ||
                        !/text\/html/i.test(result.contentType)
                    ) {
                        dlShowNativeFallback(
                            'F95 returned an unexpected response type or origin. ' +
                            'Continue manually.'
                        );
                        return;
                    }

                    var parsed = new DOMParser().parseFromString(
                        result.html,
                        'text/html'
                    );

                    var wrapper = parsed.querySelector(
                        '[data-xf-init~="f95dl-go"]'
                    );

                    var destination = wrapper
                        ? getHttpUrl(dlGetGoUrl(wrapper), true)
                        : null;

                    if (destination) {
                        dlBeginRedirect(destination, wrapper);
                        return;
                    }

                    // The POST has already been sent. Never issue a second POST
                    // automatically just because the response was unfamiliar.
                    dlShowNativeFallback(
                        'F95 response did not contain the expected f95dl-go wrapper. ' +
                        'The request may already have been processed; continue manually.'
                    );
                })
                .catch(function () {
                    if (fetchTimeoutTimer !== null) {
                        window.clearTimeout(fetchTimeoutTimer);
                        fetchTimeoutTimer = null;
                    }

                    if (
                        dlCancelled ||
                        dlRedirecting ||
                        dlPausedAfterChallenge ||
                        dlNativeFallback
                    ) {
                        return;
                    }

                    dlShowNativeFallback(
                        'The F95 request failed or timed out. Its server-side status ' +
                        'is unknown; continue manually to avoid an automatic duplicate POST.'
                    );
                });
        }

        function dlScheduleRequest() {
            if (
                dlCancelled ||
                dlNativeFallback ||
                dlRequestStarted ||
                dlRedirecting ||
                dlChallengeMode ||
                dlPausedAfterChallenge ||
                dlTimer !== null ||
                dlButtonReadyTimer !== null ||
                !dlPage ||
                !dlForm ||
                dlDomReadyAt === null
            ) {
                return;
            }

            // Wait for the captured XenForo code delay plus an initialization
            // margin. With hCaptcha, wait until its existing response field is
            // populated before displaying activity or issuing the request.
            if (
                dlHasHCaptcha(dlForm) &&
                !dlReadHCaptchaToken(dlForm)
            ) {
                return;
            }

            if (dlHasOtherCaptcha(dlForm)) return;

            dlShowActivity(dlGetInitialStatusMessage(dlForm));

            var remaining = dlGetRemainingDelay();

            if (remaining > 0) {
                dlTimer = window.setTimeout(function () {
                    dlTimer = null;
                    dlSendRequest();
                }, remaining);
            } else {
                dlSendRequest();
            }
        }

        function dlArm() {
            if (dlCancelled || dlNativeFallback || dlRedirecting) return;

            if (dlIsCloudflareChallengeDocument(document)) {
                dlEnterChallengeMode();
                return;
            }

            if (dlChallengeMode || dlRedirectToGoWrapper()) return;

            var page = document.querySelector(
                '[data-xf-init~="f95dl-page"]'
            );

            if (!page) return;

            var button = page.querySelector('.js-f95dlContinue');

            // Match the actual XenForo handler: Continue's form has priority
            // over unrelated forms, such as advertising forms.
            var form = (button && button.form) ||
                page.querySelector('form.f95dl-box');

            if (!button || !form) return;

            var hasHCaptcha = dlHasHCaptcha(form);
            var hasOtherCaptcha = dlHasOtherCaptcha(form);

            // Do not take over unknown CAPTCHA integrations. The hCaptcha
            // integration below is explicitly handled using its existing widget.
            if (hasOtherCaptcha && !hasHCaptcha) return;

            // Avoid submitting mid-parse before the hidden code input appears.
            // If data-code exists, wait for its field while the parser is active.
            var encodedCode =
                page.getAttribute('data-code') ||
                page.getAttribute('data-f95dl-page-code') ||
                '';

            var codeField =
                page.querySelector('.js-f95dlCode') ||
                form.querySelector('.js-f95dlCode');

            if (
                encodedCode &&
                !codeField &&
                document.readyState === 'loading'
            ) {
                return;
            }

            if (page !== dlPage || form !== dlForm) {
                dlPage = page;
                dlForm = form;
                dlPageDetectedAt = performance.now();
            }

            dlRememberAutoAttribute(page);

            if (dlPriorPostAttempt) {
                dlShowNativeFallback(
                    'A previous automatic POST was already attempted in this tab. ' +
                    'To avoid duplicate requests, automatic retry is disabled. ' +
                    'Continue with F95 manually if needed.'
                );
                return;
            }

            // Match the source handler's option attribute name.
            // Doing this early avoids a competing native auto-countdown when
            // our observer runs before XenForo activates the handler.
            if (page.getAttribute('data-auto') !== '0') {
                page.setAttribute('data-auto', '0');
            }

            dlPopulateForm(page, form);

            var stay = page.querySelector('.js-f95dlStay');

            if (stay && !stay.dataset.f95SkipStayListener) {
                stay.dataset.f95SkipStayListener = '1';

                stay.addEventListener('click', dlCancel, true);

                stay.addEventListener('keydown', function (event) {
                    if (
                        event.key === 'Enter' ||
                        event.key === ' ' ||
                        event.keyCode === 13 ||
                        event.keyCode === 32
                    ) {
                        dlCancel();
                    }
                }, true);
            }

            if (!form.dataset.f95SkipSubmitListener) {
                form.dataset.f95SkipSubmitListener = '1';
                dlSubmitForm = form;

                dlSubmitHandler = function (event) {
                    // Native fallback, explicit cancellation, and unresolved
                    // CAPTCHA states must remain under F95's own submit handler.
                    if (
                        dlNativeFallback ||
                        dlPausedAfterChallenge ||
                        dlCancelled ||
                        dlCaptchaNativeFallback
                    ) {
                        return;
                    }

                    if (dlHasHCaptcha(form)) {
                        event.preventDefault();
                        event.stopImmediatePropagation();

                        if (!dlCaptchaSolved(form)) {
                            dlStartCaptchaMonitor(form);
                            dlTryExecuteHCaptcha(form, true);
                        }

                        return;
                    }

                    if (dlHasOtherCaptcha(form)) return;

                    event.preventDefault();
                    event.stopImmediatePropagation();

                    dlScheduleRequest();
                };

                form.addEventListener('submit', dlSubmitHandler, true);
            }

            if (hasHCaptcha) {
                // Start the invisible verification workflow automatically.
                // The challenge itself remains human-controlled; navigation
                // resumes only after hCaptcha populates its response field.
                dlStartCaptchaMonitor(form);
                return;
            }

            dlScheduleRequest();
        }

        function dlOnMutation() {
            if (dlCancelled || dlNativeFallback || dlRedirecting) return;

            if (dlIsCloudflareChallengeDocument(document)) {
                dlEnterChallengeMode();
                return;
            }

            if (!dlChallengeMode) {
                dlArm();
            }
        }

        window.addEventListener('pageshow', function (event) {
            if (event && event.persisted) {
                dlCancel();
            }
        });

        onDomReady(function () {
            if (dlDomReadyAt === null) {
                dlDomReadyAt = performance.now();
            }

            if (dlIsCloudflareChallengeDocument(document)) {
                dlEnterChallengeMode();
            } else {
                dlInstallObserver();
                dlArm();
            }
        });

        // Start observing at document-start, before DOMContentLoaded.
        dlInstallObserver();
        dlOnMutation();

        return;
    }

    // =====================================================================
    // /masked/ — restored legacy XHR state machine
    // =====================================================================

    if (!pathname.startsWith('/masked/')) return;

    onDomReady(function initMaskedPage() {
        var leaving = document.querySelector('.leaving');
        var loading = document.getElementById('loading');
        var captcha = document.getElementById('captcha');
        var errorBox = document.getElementById('error');

        var requestInFlight = false;
        var captchaRendered = false;
        var captchaWaitTimer = null;

        if (leaving) {
            leaving.style.width = leaving.offsetWidth + 'px';

            var leavingText = document.querySelector('.leaving-text');

            if (leavingText) {
                leavingText.style.display = 'none';
            }
        }

        function setLoading(visible) {
            if (loading) {
                loading.style.display = visible ? 'block' : 'none';
            }
        }

        function handleError(title, message, retry) {
            setLoading(false);

            if (!errorBox) {
                console.error(
                    '[F95-Zone Skipper Ultra] ' + title + ': ' + message
                );
                return;
            }

            while (errorBox.firstChild) {
                errorBox.removeChild(errorBox.firstChild);
            }

            var heading = document.createElement('h2');
            heading.textContent = title;

            var paragraph = document.createElement('p');
            paragraph.textContent =
                message || 'The request could not be completed.';

            errorBox.appendChild(heading);
            errorBox.appendChild(paragraph);

            if (retry) {
                var retryParagraph = document.createElement('p');
                var retryLink = document.createElement('a');

                retryLink.href = window.location.href;
                retryLink.textContent = 'Retry';

                retryParagraph.appendChild(retryLink);
                errorBox.appendChild(retryParagraph);
            }

            errorBox.style.display = 'block';
        }

        function sendMaskedRequest(captchaToken) {
            if (requestInFlight) return;

            requestInFlight = true;
            setLoading(true);

            var payload = new URLSearchParams();

            payload.set('xhr', '1');
            payload.set('download', '1');

            if (captchaToken) {
                payload.set('captcha', captchaToken);
            }

            var xhr = new XMLHttpRequest();

            xhr.open('POST', window.location.pathname, true);

            xhr.setRequestHeader(
                'Content-Type',
                'application/x-www-form-urlencoded;charset=UTF-8'
            );

            xhr.timeout = MASKED_TIMEOUT_MS;

            xhr.onreadystatechange = function () {
                if (xhr.readyState !== XMLHttpRequest.DONE) return;

                requestInFlight = false;

                if (xhr.status !== 200) {
                    handleError(
                        'Server Error',
                        'Please try again in a few moments.',
                        true
                    );
                    return;
                }

                var response;

                try {
                    response = JSON.parse(xhr.responseText);
                } catch (error) {
                    handleError(
                        'Invalid Response',
                        'The server returned an unrecognized response.',
                        true
                    );
                    return;
                }

                if (!response || typeof response !== 'object') {
                    handleError(
                        'Invalid Response',
                        'The server returned an unrecognized response.',
                        true
                    );
                    return;
                }

                switch (response.status) {
                    case 'ok': {
                        var destination = getHttpUrl(response.msg, false);

                        if (destination) {
                            window.location.replace(destination);
                        } else {
                            handleError(
                                'Invalid Destination',
                                'The server did not provide a valid HTTP(S) destination.',
                                true
                            );
                        }

                        break;
                    }

                    case 'error':
                        handleError(
                            'Error',
                            response.msg || 'The server rejected this link.',
                            true
                        );
                        break;

                    case 'captcha':
                        if (captchaToken) {
                            handleError(
                                'Captcha Error',
                                response.msg ||
                                    'The CAPTCHA was rejected. Retry the link.',
                                true
                            );
                        } else {
                            if (captcha) {
                                captcha.style.display = 'block';
                            }

                            renderCaptchaWhenAvailable();
                        }

                        break;

                    default:
                        handleError(
                            'Unexpected Response',
                            'The server returned an unknown status.',
                            true
                        );
                        break;
                }
            };

            xhr.onerror = function () {
                requestInFlight = false;

                handleError(
                    'Network Error',
                    'The request failed. Check your connection and retry.',
                    true
                );
            };

            xhr.ontimeout = function () {
                requestInFlight = false;

                handleError(
                    'Request Timeout',
                    'The server took too long to respond. Retry the request.',
                    true
                );
            };

            xhr.onabort = function () {
                requestInFlight = false;
            };

            xhr.send(payload.toString());
        }

        function renderCaptchaWhenAvailable() {
            if (captchaRendered) return;

            if (!captcha) {
                handleError(
                    'Captcha Unavailable',
                    'The page does not contain the CAPTCHA container.',
                    true
                );
                return;
            }

            var attempts = 0;

            if (captchaWaitTimer !== null) {
                window.clearInterval(captchaWaitTimer);
            }

            captchaWaitTimer = window.setInterval(function () {
                attempts++;

                if (
                    window.grecaptcha &&
                    typeof window.grecaptcha.render === 'function'
                ) {
                    window.clearInterval(captchaWaitTimer);
                    captchaWaitTimer = null;

                    try {
                        window.grecaptcha.render(captcha, {
                            theme: 'dark',
                            sitekey: F95_SITE_KEY,

                            callback: function (captchaResponse) {
                                if (!captchaResponse) {
                                    handleError(
                                        'Captcha Error',
                                        'The CAPTCHA did not return a response. Retry.',
                                        true
                                    );
                                    return;
                                }

                                captcha.style.display = 'none';
                                sendMaskedRequest(captchaResponse);
                            }
                        });

                        captchaRendered = true;
                    } catch (error) {
                        handleError(
                            'Captcha Error',
                            'The CAPTCHA could not be initialized. Reload and retry.',
                            true
                        );
                    }
                } else if (attempts >= 150) {
                    window.clearInterval(captchaWaitTimer);
                    captchaWaitTimer = null;

                    handleError(
                        'Captcha Unavailable',
                        'The reCAPTCHA script did not become available. Reload and retry.',
                        true
                    );
                }
            }, 100);
        }

        sendMaskedRequest('');
    });
})();

// ==UserScript==
// @name         F95-Zone Skipper Ultra (EARLY AI TESTS)
// @namespace    f95-skipper-2-aitest
// @version      0.1.7
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
    var DL_CODE_DELAY_MS = 2150;
    var DL_FETCH_TIMEOUT_MS = 20000;
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

        var dlFetchChallengeRetryKey =
            'f95zone-skipper:dl-challenge-retry:' + pathname;

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
                /challenges\.cloudflare\.com\/turnstile\//i.test(html);

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

                dlRedirecting = true;
                safeSessionRemove(dlFetchChallengeRetryKey);
                dlStopObserver();

                if (cfProbeTimer !== null) {
                    window.clearTimeout(cfProbeTimer);
                }

                if (fetchTimeoutTimer !== null) {
                    window.clearTimeout(fetchTimeoutTimer);
                }

                window.location.replace(destination);
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

        function dlHasCaptcha(form) {
            if (!form) return false;

            return !!form.querySelector(
                '.g-recaptcha, .h-captcha, .cf-turnstile, ' +
                '[data-xf-init*="captcha"], [data-sitekey], ' +
                'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], ' +
                'iframe[src*="challenges.cloudflare.com"], ' +
                'input[name="cf-turnstile-response"]'
            );
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
            // responseStart is safer than requestStart: requestStart precedes
            // arrival at the origin and could make the POST premature.
            //
            // We decode data-code ourselves, so parsing time after the first
            // response byte counts toward the delay instead of waiting a full
            // 2150ms after DOMContentLoaded.
            //
            // After a challenge, anchor to the real F95 page's appearance
            // because the effective timing may have reset.
            var base = null;

            try {
                var entries = performance.getEntriesByType('navigation');
                var nav = entries && entries[0];

                if (!dlSawChallenge && nav && nav.responseStart > 0) {
                    base = nav.responseStart;
                }
            } catch (error) {}

            if (base === null) {
                base = Math.max(
                    dlDomReadyAt || 0,
                    dlPageDetectedAt || 0
                );
            }

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

            console.warn(
                '[F95-Zone Skipper Ultra] A second Cloudflare challenge ' +
                'was returned. Automatic POST attempts are paused; use the ' +
                'normal Continue control after verification.'
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

        function dlSendRequest() {
            if (
                dlCancelled ||
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

            if (
                !document.documentElement ||
                !document.documentElement.contains(dlForm)
            ) {
                return;
            }

            if (dlHasCaptcha(dlForm)) return;

            var codeState = dlPopulateForm(dlPage, dlForm);

            if (
                codeState.encoded &&
                !codeState.decoded &&
                codeState.field &&
                !codeState.field.value
            ) {
                nativeSubmit(dlForm);
                return;
            }

            var action;

            try {
                action = new URL(
                    dlForm.action || window.location.href,
                    window.location.href
                );

                if (action.origin !== window.location.origin) {
                    nativeSubmit(dlForm);
                    return;
                }
            } catch (error) {
                nativeSubmit(dlForm);
                return;
            }

            var body;

            try {
                body = new URLSearchParams(new FormData(dlForm));
            } catch (error) {
                nativeSubmit(dlForm);
                return;
            }

            dlRequestStarted = true;

            if (typeof AbortController === 'function') {
                dlAbortController = new AbortController();
            }

            var fetchOptions = {
                method: 'POST',
                credentials: 'same-origin',
                body: body,
                headers: {
                    'Content-Type':
                        'application/x-www-form-urlencoded;charset=UTF-8',
                    'X-Requested-With': 'XMLHttpRequest'
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
                        throw new Error(
                            'Download POST returned HTTP ' + result.status
                        );
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
                        safeSessionRemove(dlFetchChallengeRetryKey);
                        dlRedirecting = true;
                        dlStopObserver();

                        window.location.replace(destination);
                        return;
                    }

                    // Unknown response structure: use native form flow instead
                    // of guessing the destination from unrelated page links.
                    nativeSubmit(dlForm);
                })
                .catch(function () {
                    if (fetchTimeoutTimer !== null) {
                        window.clearTimeout(fetchTimeoutTimer);
                        fetchTimeoutTimer = null;
                    }

                    if (
                        dlCancelled ||
                        dlRedirecting ||
                        dlPausedAfterChallenge
                    ) {
                        return;
                    }

                    nativeSubmit(dlForm);
                });
        }

        function dlScheduleRequest() {
            if (
                dlCancelled ||
                dlRequestStarted ||
                dlRedirecting ||
                dlChallengeMode ||
                dlPausedAfterChallenge ||
                dlTimer !== null ||
                !dlPage ||
                !dlForm
            ) {
                return;
            }

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
            if (dlCancelled || dlRedirecting) return;

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

            if (!button || !form || dlHasCaptcha(form)) return;

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

                form.addEventListener('submit', function (event) {
                    // After repeated challenges, permit ordinary XenForo
                    // submission instead of intercepting the user.
                    if (
                        dlPausedAfterChallenge ||
                        dlCancelled ||
                        dlHasCaptcha(form)
                    ) {
                        return;
                    }

                    event.preventDefault();
                    event.stopImmediatePropagation();

                    dlScheduleRequest();
                }, true);
            }

            dlScheduleRequest();
        }

        function dlOnMutation() {
            if (dlCancelled || dlRedirecting) return;

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

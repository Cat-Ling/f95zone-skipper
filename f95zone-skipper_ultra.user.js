// ==UserScript==
// @name         F95-Zone skipper (beta)
// @namespace    -
// @version      0.1.2
// @description  This is an alternative version of f95zone-skipper that works even faster.
// @author       Cat-Ling
// @homepageURL  https://github.com/Cat-Ling
// @icon         https://www.google.com/s2/favicons?sz=64&domain=f95zone.to
// @match        https://f95zone.to/masked/*
// @exclude      https://f95zone.to/masked/
// @grant        none
// @license      GPL-2.0
// @supportURL   https://github.com/Cat-Ling/f95zone-skipper/issues
// @downloadURL  -
// @updateURL    -
// ==/UserScript==

(function() {
    'use strict';

    var $leaving = $(".leaving");
    var $loading = $("#loading");
    var $captcha = $("#captcha");
    var $error = $("#error");

    function handleError(title, message, retry) {
        $error.html("<h2>" + title + "</h2><p>" + message + "</p>" + (retry ? '<p><a href="javascript:window.location.reload(true);">Retry</a></p>' : ""));
        $loading.hide();
        $error.show();
    }

    $leaving.css("width", $leaving.outerWidth());
    $(".leaving-text").hide();
    $loading.show();

    $.ajax({
        method: "POST",
        url: document.location.pathname,
        data: { xhr: 1, download: 1 },
        cache: false,
        dataType: "json",
        timeout: 20000,
        success: function(response) {
            switch (response.status) {
                case "ok":
                    window.location.href = response.msg;
                    break;
                case "error":
                    handleError("Error", response.msg, true);
                    break;
                case "captcha":
                    $captcha.show();
                    handleCaptcha(response);
                    break;
            }
        },
        error: function() {
            handleError("Server Error", "Please try again in a few moments", true);
        }
    });

    function handleCaptcha(response) {
        grecaptcha.render("captcha", {
            theme: "dark",
            sitekey: "6LcwQ5kUAAAAAAI-_CXQtlnhdMjmFDt-MruZ2gov",
            callback: function(captchaResponse) {
                $captcha.hide();
                $loading.show();
                $.ajax({
                    method: "POST",
                    url: document.location.pathname,
                    data: { xhr: 1, download: 1, captcha: captchaResponse },
                    cache: false,
                    dataType: "json",
                    timeout: 20000,
                    success: function(response) {
                        if (response.status !== "ok") {
                            handleError("Captcha Error", response.msg, true);
                        } else {
                            window.location.href = response.msg;
                        }
                    },
                    error: function() {
                        handleError("Server Error", "Please try again in a few moments", true);
                    }
                });
            }
        });
    }
})();

// ==UserScript==
// @name         Anonym File Autodownloader
// @namespace    -
// @version      0.1
// @description  Automatically starts file download without needing to wait for the timer to finish.
// @author       Cat-Ling
// @homepageURL  https://github.com/Cat-Ling
// @icon         https://www.google.com/s2/favicons?sz=64&domain=f95zone.to
// @match        https://anonymfile.com/*
// @exclude      https://anonymfile.com/
// @license      GPL-2.0
// @supportURL   https://github.com/Cat-Ling/f95zone-skipper/issues
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    function extractAndRedirect() {
        var elements = document.querySelectorAll('*');

        for (var i = 0; i < elements.length; i++) {
            var element = elements[i];
            if (element.outerHTML.includes('.append(\'<a href="') && element.outerHTML.includes('anonymfile.com/f/')) {
                // Extract the link from the element's HTML
                var startIndex = element.outerHTML.indexOf('anonymfile.com/f/');
                var endIndex = element.outerHTML.indexOf('"', startIndex);
                var link = element.outerHTML.slice(startIndex, endIndex);
                window.location.href = "https://" + link;
                return;
            }
        }
    }

    window.addEventListener('load', extractAndRedirect);
})();

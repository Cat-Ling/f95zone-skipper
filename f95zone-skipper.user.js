// ==UserScript==
// @name         F95-Zone skipper
// @namespace    -
// @version      1.2.3
// @description  This userscript skips masked f95 links for you.
// @author       Cat-Ling
// @homepageURL  https://github.com/Cat-Ling
// @icon         https://www.google.com/s2/favicons?sz=64&domain=f95zone.to
// @match        https://f95zone.to/masked/*
// @exclude https://f95zone.to/masked/
// @grant        none
// @license GPL-2.0
// @supportURL https://github.com/Cat-Ling/f95zone-skipper/issues
// @downloadURL https://github.com/Cat-Ling/f95zone-skipper/raw/main/f95zone-skipper.user.js
// @updateURL https://github.com/Cat-Ling/f95zone-skipper/raw/main/f95zone-skipper.user.js
// ==/UserScript==

(function() {
    'use strict';
  
    var simulateClick = function(element) {
        var event = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window
        });
        element.dispatchEvent(event);
    };
  
    function waitForHostLink(callback) {
        var intervalId = setInterval(function() {
            var hostLink = document.querySelector('.host_link');
            if (hostLink) {
                clearInterval(intervalId);
                callback(hostLink);
            }
        }, 500);
    }
  
    waitForHostLink(function(hostLink) {
        simulateClick(hostLink);
    });
  })();

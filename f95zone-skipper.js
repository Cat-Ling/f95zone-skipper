// ==UserScript==
// @name         F95-Zone skipper.
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  This userscript skips masked f95 links for you.
// @author       Cat-Ling
// @icon         https://www.google.com/s2/favicons?sz=64&domain=f95zone.to
// @match        https://f95zone.to/masked/*
// @grant        none
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
      }, 100);
  }

  waitForHostLink(function(hostLink) {
      simulateClick(hostLink);
  });
})();

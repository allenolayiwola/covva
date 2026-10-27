/*! Covva quote widget · https://covva.com.gh/docs/embedding
 * <script src="https://covva.com.gh/embed/widget.js" data-partner="CODE" data-category="motor" async></script>
 * Injects a responsive iframe after the script tag (or into data-target="#id"). The iframe reports its
 * height with postMessage; only messages from the Covva origin and this iframe are accepted.
 * Technology provided by Covva. Insurance provided by licensed insurers and brokers. */
(function () {
  "use strict";
  var scripts = document.querySelectorAll("script[data-partner]:not([data-covva-mounted])");
  for (var i = 0; i < scripts.length; i++) mount(scripts[i]);

  function mount(s) {
    if (!/\/embed\/widget\.js(\?|$)/.test(s.src || "")) return;
    s.setAttribute("data-covva-mounted", "1");
    var origin;
    try { origin = new URL(s.src).origin; } catch (e) { return; }
    var code = String(s.getAttribute("data-partner") || "").toUpperCase().replace(/[^A-Z2-7]/g, "").slice(0, 8);
    var category = String(s.getAttribute("data-category") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
    var maxWidth = parseInt(s.getAttribute("data-max-width") || "480", 10) || 480;
    var src = origin + "/embed/quote?partner=" + encodeURIComponent(code) + (category ? "&category=" + encodeURIComponent(category) : "");

    var frame = document.createElement("iframe");
    frame.src = src;
    frame.title = "Insurance quotes by Covva";
    frame.loading = "lazy";
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox");
    frame.style.cssText = "display:block;width:100%;max-width:" + maxWidth + "px;height:560px;border:0;margin:0 auto;overflow:hidden;color-scheme:light;";

    var target = s.getAttribute("data-target");
    var host = target ? document.querySelector(target) : null;
    if (host) host.appendChild(frame);
    else if (s.parentNode) s.parentNode.insertBefore(frame, s.nextSibling);

    window.addEventListener("message", function (ev) {
      if (ev.origin !== origin || ev.source !== frame.contentWindow) return;
      var d = ev.data;
      if (!d || d.type !== "covva:embed:height") return;
      var h = Number(d.height);
      if (h > 120 && h < 4000) frame.style.height = Math.ceil(h) + "px";
    });
  }
})();

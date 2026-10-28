"use client";
import { useEffect } from "react";

/** Tells the parent page (widget.js) how tall the content is, so the iframe never scrolls. Height only — no data. */
export function HeightReporter() {
  useEffect(() => {
    if (window.parent === window) return;
    let last = 0;
    const post = () => {
      const h = Math.ceil(document.documentElement.scrollHeight);
      if (h === last) return;
      last = h;
      window.parent.postMessage({ type: "covva:embed:height", height: h }, "*");
    };
    post();
    const ro = new ResizeObserver(post);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  return null;
}

const PAGE_SLUGS: Record<string, string> = {
  Home: "home",
  Editor: "editor",
  Effects: "effects",
  Scenes: "scenes",
  Audio: "audio",
  Output: "output",
  Server: "server",
  Devices: "devices",
  About: "about",
};

let currentPage = "home";
let scheduled = false;

function applyReferenceChrome() {
  scheduled = false;
  const app = document.querySelector<HTMLElement>(".app");
  const nav = app?.querySelector<HTMLElement>(".nav");
  if (!app || !nav) return;

  app.dataset.page = currentPage;
  app.dataset.referenceChrome = "approved";

  const buttons = Array.from(nav.querySelectorAll<HTMLButtonElement>("button"));
  for (const button of buttons) {
    const label = (button.textContent || "").trim();
    const slug = PAGE_SLUGS[label];
    if (!slug) continue;
    button.dataset.refPage = slug;
    button.classList.toggle("ref-active", slug === currentPage);
    if (!button.dataset.refBound) {
      button.dataset.refBound = "1";
      button.addEventListener("click", () => {
        currentPage = slug;
        queueApply();
      });
    }
  }
}

function queueApply() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(applyReferenceChrome);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", queueApply, { once: true });
} else {
  queueApply();
}

const observer = new MutationObserver(queueApply);
observer.observe(document.documentElement, { childList: true, subtree: true });

"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

export const ADMAX_TAG_ID = "871fc8c13766c0e157be99e1ca95fdf6";
export const ADMAX_ASYNC_SDK_SRC = "https://adm.shinobi.jp/st/t.js";
export const NINJA_COOKIE_POLICY_URL = "https://corp.ninja.co.jp/privacy/cookie/";
export const NINJA_PRIVACY_POLICY_URL = "https://corp.ninja.co.jp/privacy/";
const SDK_MARKER = "data-admax-sdk";
const PRODUCTION_HOSTS = new Set(["web-url-audit-tool.vercel.app"]);

type AdMaxWindow = Window & {
  admaxads?: { admax_id: string; type: "banner" }[];
  __admax_tag__?: unknown;
  __admax_render__?: unknown;
};

/** The SDK keeps global state, so each mount starts from a clean queue and loader. */
function resetAdMax(win: AdMaxWindow) {
  win.admaxads = [];
  win.__admax_tag__ = undefined;
  win.__admax_render__ = undefined;
  document.querySelectorAll(`script[${SDK_MARKER}]`).forEach((script) => script.remove());
}

function isProductionHost() {
  return process.env.NODE_ENV === "production" && PRODUCTION_HOSTS.has(window.location.hostname);
}

function subscribe() {
  return () => {};
}

function getProductionSnapshot() {
  return isProductionHost();
}

function getServerSnapshot() {
  return false;
}

export function NinjaAdMaxSlot() {
  const eligible = useSyncExternalStore(subscribe, getProductionSnapshot, getServerSnapshot);
  if (!eligible) return null;
  return (
    <aside aria-label="広告" className="ninja-admax-slot" style={{ marginTop: 32, paddingTop: 20, paddingBottom: 12, textAlign: "center" }}>
      <p className="ninja-admax-label" style={{ margin: "0 0 12px", fontSize: 12, lineHeight: 1.7, opacity: 0.7 }}>
        広告
      </p>
      <AdMaxUnit />
    </aside>
  );
}

function AdMaxUnit() {
  const unitRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const unit = unitRef.current;
    if (!unit) return;
    const win = window as AdMaxWindow;
    resetAdMax(win);
    unit.replaceChildren();
    win.admaxads!.push({ admax_id: ADMAX_TAG_ID, type: "banner" });
    const sdk = document.createElement("script");
    sdk.src = ADMAX_ASYNC_SDK_SRC;
    sdk.async = true;
    sdk.setAttribute("charset", "utf-8");
    sdk.setAttribute(SDK_MARKER, ADMAX_TAG_ID);
    document.body.appendChild(sdk);
    return () => {
      resetAdMax(win);
      unit.replaceChildren();
    };
  }, []);
  return (
    <div
      ref={unitRef}
      className="admax-ads"
      data-admax-id={ADMAX_TAG_ID}
      style={{ display: "inline-block", width: 300, height: 250 }}
    />
  );
}

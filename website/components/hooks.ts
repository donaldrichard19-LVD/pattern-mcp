"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export function onScrollEvt(fn: () => void) {
  window.addEventListener("scroll", fn, { passive: true });
  document.addEventListener("scroll", fn, { passive: true, capture: true });
  window.addEventListener("resize", fn);
  return () => {
    window.removeEventListener("scroll", fn);
    document.removeEventListener("scroll", fn, { capture: true } as EventListenerOptions);
    window.removeEventListener("resize", fn);
  };
}

export function useIsMobile(breakpoint = 900) {
  const [m, setM] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const h = () => setM(mq.matches);
    h();
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [breakpoint]);
  return m;
}

export function useScrollProgress(ref: RefObject<HTMLElement | null>) {
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf: number | null = null;
    const read = () => {
      raf = null;
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const total = el.offsetHeight - window.innerHeight;
      setP(total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    const off = onScrollEvt(onScroll);
    return () => {
      off();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [ref]);
  return p;
}

export function useReveal(delay = 0) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const inView = () => {
      const r = el.getBoundingClientRect();
      return r.bottom > 0 && r.top < (window.innerHeight || 0);
    };
    if (inView()) {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) =>
        es.forEach((e) => {
          if (e.isIntersecting) {
            setShown(true);
            io.disconnect();
          }
        }),
      { threshold: 0.1, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    const check = () => {
      if (inView()) {
        setShown(true);
        cleanup();
      }
    };
    const t0 = setTimeout(check, 0);
    const t1 = setTimeout(check, 400);
    const t2 = setTimeout(() => setShown(true), 800);
    const off = onScrollEvt(check);
    const cleanup = () => {
      io.disconnect();
      clearTimeout(t0);
      clearTimeout(t1);
      clearTimeout(t2);
      off();
    };
    return cleanup;
  }, []);
  return { ref, shown, delay };
}

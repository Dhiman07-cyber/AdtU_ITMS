"use client";

import type Lenis from "lenis";
import { usePathname } from "next/navigation";
import { useEffect,useRef } from "react";

const ENABLE_LENIS = process.env.NEXT_PUBLIC_ENABLE_LENIS_SMOOTH_SCROLL === "true";
const PUBLIC_SMOOTH_SCROLL_ROUTES = new Set([
    "/",
    "/about",
    "/faq",
    "/how-it-works",
    "/privacy-policy",
    "/terms-and-conditions",
]);

type NavigatorWithHints = Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
};

function isPublicSmoothScrollRoute(pathname: string | null): boolean {
    return Boolean(pathname && PUBLIC_SMOOTH_SCROLL_ROUTES.has(pathname));
}

function shouldPreferNativeScroll(): boolean {
    const nav = navigator as NavigatorWithHints;
    return (
        window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
        window.matchMedia("(pointer: coarse)").matches ||
        nav.connection?.saveData === true ||
        (typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency <= 4) ||
        (typeof nav.deviceMemory === "number" && nav.deviceMemory <= 4)
    );
}

export default function SmoothScrollProvider({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();
    const lenisRef = useRef<Lenis | null>(null);
    const rafIdRef = useRef<number | null>(null);

    useEffect(() => {
        if (!ENABLE_LENIS || !isPublicSmoothScrollRoute(pathname) || shouldPreferNativeScroll()) {
            return;
        }

        let cancelled = false;
        const options: AddEventListenerOptions = { passive: true, capture: true };
        let removeNestedScrollListeners: (() => void) | null = null;

        void import("lenis").then(({ default: LenisCtor }) => {
            if (cancelled) return;

            const lenis = new LenisCtor({
                duration: 0.9,
                easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
                smoothWheel: true,
                wheelMultiplier: 0.9,
            });

            lenisRef.current = lenis;

            const scrollableCache = new WeakSet<Element>();
            const isScrollable = (element: Element): boolean => {
                if (!(element instanceof HTMLElement)) return false;
                if (scrollableCache.has(element)) return true;

                const style = window.getComputedStyle(element);
                const isOverflow = ["auto", "scroll"].includes(style.overflowY) || ["auto", "scroll"].includes(style.overflow);
                const result = isOverflow && element.scrollHeight > element.clientHeight;

                if (result) scrollableCache.add(element);
                return result;
            };

            const preventLenisScroll = (event: Event) => {
                let target = event.target as HTMLElement | null;

                while (target && target !== document.body && target !== document.documentElement) {
                    if (target.hasAttribute("data-lenis-prevent")) return;
                    if (isScrollable(target)) {
                        target.setAttribute("data-lenis-prevent", "true");
                        return;
                    }
                    target = target.parentElement;
                }
            };

            window.addEventListener("wheel", preventLenisScroll, options);
            removeNestedScrollListeners = () => {
                window.removeEventListener("wheel", preventLenisScroll, options);
            };

            let lastTime = 0;
            function raf(time: number) {
                if (time - lastTime >= 16) {
                    lenis.raf(time);
                    lastTime = time;
                }
                rafIdRef.current = requestAnimationFrame(raf);
            }

            rafIdRef.current = requestAnimationFrame(raf);
        });

        return () => {
            cancelled = true;
            removeNestedScrollListeners?.();
            if (rafIdRef.current) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
            lenisRef.current?.destroy();
            lenisRef.current = null;
        };
    }, [pathname]);

    return <>{children}</>;
}

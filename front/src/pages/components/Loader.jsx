import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useLocation } from "react-router-dom";
import {
  beginTask,
  endTask,
  getPending,
  subscribeLoading,
} from "../../loading";

// Loader never flashes for less than this - quick loads still get one beat.
const MIN_VISIBLE_MS = 500;
const FADE_MS = 400;

// Minimal indeterminate bar pinned to the top edge of the viewport, plus an
// opaque splash that covers the screen on navigation and fades out once the
// page's first load settles. The splash is driven by local state set in
// useLayoutEffect - it does not depend on store->render timing, so it is
// guaranteed to be up before the new page paints. Later background refetches
// only pulse the top bar - the splash does not flash back in.
const Loader = () => {
  const { pathname } = useLocation();
  const pending = useSyncExternalStore(subscribeLoading, getPending);
  const active = pending > 0;

  const [barHold, setBarHold] = useState(false); // keeps bar up to MIN_VISIBLE_MS
  const [splash, setSplash] = useState(true); // splash mounted (starts covered)
  const [fading, setFading] = useState(false); // splash in fade-out phase
  const [navPath, setNavPath] = useState(pathname);
  const shownAt = useRef(0);
  const navAt = useRef(Date.now());

  // Raise the splash during render so it is committed together with the new
  // route - there is no frame where the new page exists without the splash.
  if (pathname !== navPath) {
    setNavPath(pathname);
    navAt.current = Date.now();
    setFading(false);
    setSplash(true);
  }

  // Count the navigation itself as a task so quick pages still get a full
  // beat, and hand off from the static boot splash in index.html.
  useLayoutEffect(() => {
    document.getElementById("boot-splash")?.remove();
    beginTask();
    let ended = false;
    const t = setTimeout(() => {
      ended = true;
      endTask();
    }, MIN_VISIBLE_MS);
    return () => {
      if (!ended) {
        clearTimeout(t);
        endTask();
      }
    };
  }, [pathname]);

  // Enforce the minimum visible time on the top bar.
  useEffect(() => {
    if (active) {
      shownAt.current = Date.now();
      return;
    }
    const remaining = MIN_VISIBLE_MS - (Date.now() - shownAt.current);
    if (remaining <= 0) return;
    setBarHold(true);
    const t = setTimeout(() => setBarHold(false), remaining);
    return () => clearTimeout(t);
  }, [active]);

  // Fade the splash once the minimum time has passed and nothing is pending.
  // Polls the counter directly - robust regardless of render timing.
  useEffect(() => {
    if (!splash || fading) return;
    let timer;
    const check = () => {
      if (getPending() === 0 && Date.now() - navAt.current >= MIN_VISIBLE_MS) {
        setFading(true);
        timer = setTimeout(() => {
          setSplash(false);
          setFading(false);
        }, FADE_MS);
      } else {
        timer = setTimeout(check, 100);
      }
    };
    timer = setTimeout(
      check,
      Math.max(50, MIN_VISIBLE_MS - (Date.now() - navAt.current)),
    );
    return () => clearTimeout(timer);
  }, [splash, fading]);

  return (
    <>
      {(active || barHold) && (
        <div className="loader" role="status" aria-label="Loading">
          <span />
        </div>
      )}
      {splash && (
        <div
          className={`loader-center${fading ? " out" : ""}`}
          aria-hidden={fading}
        >
          <span className="loader-x">X</span>
        </div>
      )}
    </>
  );
};

export default Loader;

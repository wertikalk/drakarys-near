import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";

// Max distance the iris travels from center, in viewBox units - small enough
// that the iris always stays inside the eye outline.
const MAX_SHIFT = 16;

const Home = () => {
  const eyeRef = useRef(null);
  const irisRef = useRef(null);

  useEffect(() => {
    const target = { x: 0, y: 0 };
    const pos = { x: 0, y: 0 };
    let raf;

    const onMove = (e) => {
      const rect = eyeRef.current?.getBoundingClientRect();
      if (!rect) return;
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      const dist = Math.hypot(dx, dy) || 1;
      const shift = Math.min(MAX_SHIFT, dist * 0.08);
      target.x = (dx / dist) * shift;
      target.y = (dy / dist) * shift;
    };

    const tick = () => {
      pos.x += (target.x - pos.x) * 0.15;
      pos.y += (target.y - pos.y) * 0.15;
      if (irisRef.current) {
        irisRef.current.style.transform = `translate(${pos.x}px, ${pos.y}px)`;
      }
      raf = requestAnimationFrame(tick);
    };

    window.addEventListener("pointermove", onMove);
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div className="home">
      <svg
        ref={eyeRef}
        className="vision"
        viewBox="0 0 200 200"
        role="img"
        aria-label="Focused vision"
      >
        {/* triangle corner ticks only - sides left open */}
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="0.75"
          strokeLinecap="butt"
        >
          {/* apex */}
          <path d="M91 40 L100 24 L109 40" />
          {/* bottom-left */}
          <path d="M23 160 L14 176 L32 176" />
          {/* bottom-right */}
          <path d="M177 160 L186 176 L168 176" />
        </g>
        {/* eye, centered on the triangle's visual center (~y=126) */}
        <g transform="translate(100,126) scale(0.65) translate(-100,-100)">
          <path
            d="M44 100 Q100 56 156 100 Q100 144 44 100 Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="butt"
          />
          {/* iris + pupil: translated toward the cursor. Filled with the
              foreground color, pupil cut out in the background color - so it
              reads black-on-white in light mode and inverts in dark mode */}
          <g ref={irisRef}>
            <circle cx="100" cy="100" r="24" fill="currentColor" />
            <circle cx="100" cy="100" r="9" fill="var(--bg)" />
          </g>
        </g>
      </svg>

      <section className="news">
        <h2 className="news-heading">News</h2>
        <article className="news-item">
          <span className="news-date">30 Oct 2026</span>
          <p>
            <b>Drakarys</b> Gym Environment released on GitHub.
          </p>
        </article>
        <article className="news-item">
          <span className="news-date">12 Oct 2026</span>
          <p>
            <b>Drakarys</b> submitted to the{" "}
            <a
              href="https://colosseum.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Colosseum's World Fair
            </a>{" "}
            and{" "}
            <a
              href="https://monad.xyz/developers/hackathons/metropolis"
              target="_blank"
              rel="noopener noreferrer"
            >
              Monad's Metropolis Hackathon.
            </a>
          </p>
        </article>
        <article className="news-item">
          <span className="news-date">01 Oct 2026</span>
          <p>
            <b>Drakarys</b> is launched ⚡⚡⚡{" "}
            <Link to="/projects" className="news-link">
              Projects →
            </Link>
          </p>
        </article>
        <article className="news-item">
          <span className="news-date">01 Oct 2026</span>
          <p>The website is live. Живели! 🇷🇸</p>
        </article>
      </section>
    </div>
  );
};

export default Home;

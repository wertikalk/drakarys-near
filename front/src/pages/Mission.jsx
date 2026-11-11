import { Link } from "react-router-dom";
import milosCeo from "../assets/1000002736.jpg";

const Mission = () => {
  return (
    <div className="mission">
      <section className="founder">
        <img src={milosCeo} alt="Milos Bojinovic" className="founder-photo" />
        <div className="founder-bio">
          <h2 className="founder-name">
            Milos Bojinovic
            <span className="founder-title">MSc EE</span>
            <span className="founder-socials">
              <a
                href="https://www.linkedin.com/in/milos-bojinovic-765010202/"
                aria-label="LinkedIn"
                target="_blank"
                rel="noreferrer"
              >
                <svg
                  className="button-icon"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.225 0z" />
                </svg>
              </a>
              <a
                href="https://x.com/wertikalk"
                aria-label="X"
                target="_blank"
                rel="noreferrer"
              >
                <svg className="button-icon" aria-hidden="true">
                  <use href="/icons.svg#x-icon" />
                </svg>
              </a>
            </span>
          </h2>
          <p className="founder-role">CEO</p>
          <p className="statement-lead">
            Decentralizing AI knowledge across the globe.
          </p>
          <p>
            AI capability is concentrating inside a handful of labs — the ones
            with the compute budgets, the proprietary datasets, and the tooling
            to ship. Independent researchers with real ideas are locked out
            before their first experiment even runs.
          </p>
          <ul className="statement-problems">
            <li>
              <span className="k">Compute</span>
              <p>
                Serious training runs cost more than a research grant. Most
                independents never get past the quote.
              </p>
            </li>
            <li>
              <span className="k">Data</span>
              <p>
                The best datasets are licensed, gated, or hoarded. What remains
                is scraped, stale, or too small to prove anything.
              </p>
            </li>
            <li>
              <span className="k">Tools</span>
              <p>
                Production-grade frameworks assume a platform team. Solo
                researchers burn months on plumbing instead of science.
              </p>
            </li>
            <li>
              <span className="k">Incentive</span>
              <p>
                AI is powerful on its own, but turning that work into income is
                a challenge of its own — monetizing research is harder than
                doing it.
              </p>
            </li>
          </ul>
          <p className="statement-close">
            Our mission is to change that. See{" "}
            <Link to="/projects">projects</Link> for the full picture of our
            work.
          </p>
        </div>
      </section>
    </div>
  );
};

export default Mission;

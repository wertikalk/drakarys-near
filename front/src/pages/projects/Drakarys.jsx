import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchChains, fetchMatches, apiUrl } from "../../api";
import { useTheme } from "../../contexts/ThemeContext";
import { Crest, JERSEY } from "./matchShared";
import fireImage from "../../assets/fire.svg";

const PAGE_SIZE = 7;

// Sample formation on the 800x500 field, same colors as the match canvas
const PROMO_PLAYERS = {
  A: [
    [30, 250],
    [160, 130],
    [190, 215],
    [190, 285],
    [160, 370],
    [280, 140],
    [310, 250],
    [280, 360],
    [330, 250],
    [430, 200],
    [450, 300],
  ],
  B: [
    [770, 250],
    [640, 130],
    [610, 215],
    [610, 285],
    [640, 370],
    [520, 140],
    [490, 250],
    [520, 360],
    [470, 250],
    [370, 200],
    [350, 300],
  ],
};

const FieldPreview = () => (
  <svg className="promo-field" viewBox="0 0 800 500" aria-hidden="true">
    <g fill="none" stroke="var(--pf-line)" strokeWidth="4">
      <rect x="10" y="10" width="780" height="480" />
      <line x1="400" y1="10" x2="400" y2="490" />
      <circle cx="400" cy="250" r="80" />
      <rect x="10" y="150" width="130" height="200" />
      <rect x="660" y="150" width="130" height="200" />
      <rect x="10" y="200" width="50" height="100" />
      <rect x="740" y="200" width="50" height="100" />
    </g>
    <rect x="5" y="220" width="5" height="60" fill="var(--pf-line)" />
    <rect x="790" y="220" width="5" height="60" fill="var(--pf-line)" />
    <circle cx="400" cy="250" r="6" fill="var(--pf-line)" />
    {/* team crests centered in each half, behind the players */}
    <Crest team="A" fill="#6050dc" x="163" y="201" width="84" height="98" />
    <Crest
      team="B"
      fill="#ffffff"
      ink="#140c28"
      x="553"
      y="201"
      width="84"
      height="98"
    />
    {PROMO_PLAYERS.A.map(([x, y], i) => (
      <circle
        key={`a${i}`}
        cx={x}
        cy={y}
        r="11"
        fill={i === 0 ? "#8b8296" : "#6050dc"}
        stroke="#fff"
        strokeWidth="2"
      />
    ))}
    {PROMO_PLAYERS.B.map(([x, y], i) => (
      <circle
        key={`b${i}`}
        cx={x}
        cy={y}
        r="11"
        fill={i === 0 ? "#8b8296" : "#ffffff"}
        stroke="#140c28"
        strokeWidth="2"
      />
    ))}
    <circle cx="405" cy="255" r="6" fill="var(--text-h)" />
  </svg>
);

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

// Compact "17 Sep · 12:42" - fits the narrow gutter the id sits in
const formatStartedAt = (iso) => {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getDate()} ${MONTHS[d.getMonth()]} · ${hh}:${mm}`;
};

const Drakarys = () => {
  const { isDark } = useTheme();
  const [matches, setMatches] = useState(null);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(0);
  const [chains, setChains] = useState([]);
  const [showVideo, setShowVideo] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // Group chains into local nodes vs public devnets/testnets. The filter
  // switches between the two groups instead of listing every chain.
  const localChains = chains.filter((c) => c.local);
  const remoteChains = chains.filter((c) => !c.local);
  const netParam = searchParams.get("net");
  // Default to public devnets/testnets when any are configured; local nodes
  // are still reachable via the filter toggle.
  const defaultNet = remoteChains.length ? "remote" : "local";
  const activeNet =
    netParam === "remote" || netParam === "local" ? netParam : defaultNet;
  const groupChains = activeNet === "remote" ? remoteChains : localChains;
  // The exact chain inside the group; falls back to the group default.
  const chainParam = searchParams.get("chain");
  const groupDefault = groupChains.find((c) => c.default) ?? groupChains[0];
  const activeChain =
    (chainParam && groupChains.some((c) => c.name === chainParam)
      ? chainParam
      : null) ??
    groupDefault?.name ??
    null;

  useEffect(() => {
    let cancelled = false;
    fetchChains()
      .then((data) => {
        if (!cancelled) setChains(data);
      })
      .catch(() => {
        // older single-chain backend - no chain list, filter just stays hidden
        if (!cancelled) setChains([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const [listLoading, setListLoading] = useState(false);
  const LIST_LOADER_MS = 400; // keep the spinner up long enough to be seen
  const wrapRef = useRef(null);
  const lastHeight = useRef(0);

  // Remember the populated table height so the loading veil covers the same
  // area while rows are repopulated underneath.
  useLayoutEffect(() => {
    if (wrapRef.current && matches?.length) {
      lastHeight.current = wrapRef.current.offsetHeight;
    }
  }, [matches]);

  useEffect(() => {
    let cancelled = false;
    const started = Date.now();
    setListLoading(true);
    setMatches(null); // clear rows - they repopulate behind the veil
    setError(null);
    const apply = (data) => {
      // backend sorts /list by start timestamp - newest first
      if (!cancelled) setMatches(data);
    };
    fetchMatches(activeChain)
      .then(apply)
      .catch((err) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        setTimeout(
          () => {
            if (!cancelled) setListLoading(false);
          },
          Math.max(0, LIST_LOADER_MS - (Date.now() - started)),
        );
      });
    // quiet poll - keeps the list fresh without flashing the loading veil
    const refresh = setInterval(() => {
      fetchMatches(activeChain)
        .then(apply)
        .catch(() => {});
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(refresh);
    };
  }, [activeChain]);

  useEffect(() => {
    if (!showVideo) return;
    const onKey = (e) => e.key === "Escape" && setShowVideo(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showVideo]);

  return (
    <div className="drakarys">
      <header className="drakarys-banner">
        <div className="drakarys-banner-left">
          <img src={fireImage} alt="" className="banner-logo" />
          <span className="title">Drakarys</span>
          <span className="sep" aria-hidden="true">
            ·
          </span>
          <span className="tagline">AI Competition Platform</span>
        </div>
        <Link to="/projects" className="back-link">
          ← Projects
        </Link>
      </header>
      <div className="promo-banner">
        <FieldPreview />
        <span className="promo-tag">Live</span>
        <span className="promo-text">
          <strong>Season 0</strong> is underway
          <span className="promo-sub">
            autonomous agents compete in real-time on-chain matches.
          </span>
        </span>
        <div className="promo-actions">
          <button
            type="button"
            className="promo-cta promo-play"
            onClick={() => setShowVideo(true)}
          >
            <svg
              className="play"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path d="M4 2.5v11l9-5.5-9-5.5Z" fill="currentColor" />
            </svg>
            Watch promo
          </button>
          <Link
            to="/projects/drakarys/game-0?tab=how-to-play"
            className="promo-cta"
          >
            How to play →
          </Link>
          <Link to="/projects/drakarys/game-0" className="promo-cta">
            Rules →
          </Link>
        </div>
      </div>
      {localChains.length > 0 && remoteChains.length > 0 && (
        <div className="net-switch" role="tablist">
          <span className="net-switch-label">Filter</span>
          <button
            type="button"
            className={`net-option${activeNet === "local" ? " active" : ""}`}
            onClick={() => {
              setPage(0);
              setSearchParams(defaultNet === "local" ? {} : { net: "local" });
            }}
          >
            Local networks
          </button>
          <button
            type="button"
            className={`net-option${activeNet === "remote" ? " active" : ""}`}
            onClick={() => {
              setPage(0);
              setSearchParams(defaultNet === "remote" ? {} : { net: "remote" });
            }}
          >
            Devnets / testnets
          </button>
        </div>
      )}
      {groupChains.length > 1 && (
        <div className="chain-filter">
          {groupChains.map((c) => (
            <button
              key={c.name}
              type="button"
              className={`chain-chip${c.name === activeChain ? " active" : ""}`}
              onClick={() => {
                setPage(0);
                setSearchParams({
                  ...(activeNet !== defaultNet ? { net: activeNet } : {}),
                  ...(c.name === groupDefault?.name ? {} : { chain: c.name }),
                });
              }}
            >
              {c.icon && (
                <img src={apiUrl(c.icon)} alt="" className="chain-icon" />
              )}
              {c.name.replace(/-(testnet|devnet|sepolia)$/i, "")}
            </button>
          ))}
        </div>
      )}
      <div className="matches-header">
        <h2 className="matches-title">Matches</h2>
        {matches && matches.length > PAGE_SIZE && (
          <div className="pagination">
            <button
              type="button"
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span className="page-indicator">
              {page + 1} / {Math.ceil(matches.length / PAGE_SIZE)}
            </span>
            <button
              type="button"
              disabled={(page + 1) * PAGE_SIZE >= matches.length}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
      {error && <p className="match-status">{error}</p>}
      {!error && !matches && !listLoading && (
        <p className="match-status">Loading matches…</p>
      )}
      {matches && matches.length === 0 && !listLoading && (
        <p className="match-status">No matches yet.</p>
      )}
      <div
        ref={wrapRef}
        className={`match-list-wrap${listLoading ? " loading" : ""}`}
        style={
          listLoading && lastHeight.current
            ? { minHeight: lastHeight.current }
            : undefined
        }
      >
        <div className="list-loader" aria-hidden={!listLoading}>
          <span />
        </div>
        {matches && matches.length > 0 && (
          <ul className="match-list">
            {matches
              .slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)
              .map((m) => (
                <li key={`${m.chain}/${m.id}`}>
                  <Link
                    to={`/projects/drakarys/${m.chain ?? activeNet}/${m.id}`}
                    className="match-row"
                  >
                    <span className="row-top">
                      <span className="match-id">
                        #{m.id}
                        {(() => {
                          const ic = chains.find(
                            (c) => c.name === m.chain,
                          )?.icon;
                          return ic ? (
                            <img
                              src={apiUrl(ic)}
                              alt=""
                              className="row-chain-icon"
                            />
                          ) : (
                            <span className="row-chain">
                              {m.chain?.replace(
                                /-(testnet|devnet|sepolia)$/i,
                                "",
                              )}
                            </span>
                          );
                        })()}
                        {m.startedAt && (
                          <span className="match-time">
                            {formatStartedAt(m.startedAt)}
                          </span>
                        )}
                      </span>
                      <span
                        className={`match-status-badge ${m.status === "in_progress" ? "in-progress" : ""}`}
                      >
                        {m.status === "finished" ? "Finished" : "In progress"}
                      </span>
                    </span>
                    <Crest
                      team="A"
                      className="crest-a"
                      fill={(isDark ? JERSEY.A.dark : JERSEY.A.light).fill}
                      ink={(isDark ? JERSEY.A.dark : JERSEY.A.light).ink}
                    />
                    <span className="agent agent-a">{m.agent0}</span>
                    <span className="score">
                      {m.finalScore.A} : {m.finalScore.B}
                    </span>
                    <span className="agent agent-b">{m.agent1}</span>
                    <Crest
                      team="B"
                      className="crest-b"
                      fill={(isDark ? JERSEY.B.dark : JERSEY.B.light).fill}
                      ink={(isDark ? JERSEY.B.dark : JERSEY.B.light).ink}
                    />
                  </Link>
                </li>
              ))}
          </ul>
        )}
      </div>
      {showVideo && (
        <div className="video-modal" onClick={() => setShowVideo(false)}>
          <video
            className="video"
            src="/drakarys-promo-hd.mp4"
            poster="/drakarys-promo-poster.jpg"
            controls
            autoPlay
            playsInline
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
};

export default Drakarys;

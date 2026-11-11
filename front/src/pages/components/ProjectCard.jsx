import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

const ProjectCard = ({
  name,
  description,
  videoUrl,
  imageUrl,
  posterUrl,
  link,
}) => {
  const [showVideo, setShowVideo] = useState(false);

  useEffect(() => {
    if (!showVideo) return;
    const onKey = (e) => e.key === "Escape" && setShowVideo(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showVideo]);

  return (
    <div className="project-card">
      <img className="card-img" src={imageUrl ?? posterUrl} alt={name} />
      <div className="overlay">
        <h2 className="name">{name}</h2>
        <p className="description">{description}</p>
        <div className="actions">
          {videoUrl && (
            <button
              type="button"
              className="watch-link"
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
          )}
          <Link to={link} className="explore-link">
            Explore
            <svg
              className="arrow"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M1 8h13M9 3l5 5-5 5"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </Link>
        </div>
      </div>
      {showVideo && (
        <div className="video-modal" onClick={() => setShowVideo(false)}>
          <video
            className="video"
            src={videoUrl}
            poster={posterUrl}
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

export default ProjectCard;

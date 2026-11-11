import React from "react";
import { ReactP5Wrapper } from "react-p5-wrapper";
import { useTheme } from "../../contexts/ThemeContext";

function sketch(p5) {
  let particles = [];
  let isDarkMode = false;
  const MAX_DIST = 150; // max distance for a connection
  const FADE_FRAMES = 90; // frames to fade in/out

  p5.setup = () => {
    p5.createCanvas(p5.windowWidth, p5.windowHeight);
    // Check initial theme from data attribute
    isDarkMode = document.documentElement.getAttribute("data-theme") === "dark";
    initParticles();
  };

  function initParticles() {
    particles = [];
    let count = p5.floor((p5.width * p5.height) / 12000);
    count = p5.constrain(count, 40, 160);
    for (let i = 0; i < count; i++) {
      particles.push(new Particle(true));
    }
  }

  p5.updateWithProps = (props) => {
    if (props.isDark !== undefined && props.isDark !== isDarkMode) {
      isDarkMode = props.isDark;
    }
  };

  p5.draw = () => {
    // Background - based on theme
    if (isDarkMode) {
      p5.background(0, 0, 0);
    } else {
      p5.background(255, 255, 255);
    }

    drawConnections();

    for (let particle of particles) {
      particle.update();
      particle.display();
    }
  };

  function drawConnections() {
    p5.strokeWeight(1);
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        let a = particles[i];
        let b = particles[j];
        let d = p5.dist(a.x, a.y, b.x, b.y);
        if (d < MAX_DIST) {
          // Fade with distance and with the dimmest endpoint's alpha
          let alpha =
            p5.map(d, 0, MAX_DIST, 100, 0) *
            (p5.min(a.alpha(), b.alpha()) / 255);
          if (alpha <= 1) continue;
          if (isDarkMode) {
            p5.stroke(255, 255, 200, alpha);
          } else {
            p5.stroke(50, 50, 50, alpha);
          }
          p5.line(a.x, a.y, b.x, b.y);
        }
      }
    }
  }

  p5.windowResized = () => {
    p5.resizeCanvas(p5.windowWidth, p5.windowHeight);
    initParticles();
  };

  class Particle {
    constructor(scatterAge = false) {
      this.respawn(scatterAge);
    }

    respawn(scatterAge = false) {
      this.x = p5.random(p5.width);
      this.y = p5.random(p5.height);
      let angle = p5.random(p5.TWO_PI);
      let speed = p5.random(0.15, 0.5);
      this.vx = p5.cos(angle) * speed;
      this.vy = p5.sin(angle) * speed;
      this.size = p5.random(1.5, 4);
      this.maxLife = p5.random(400, 900); // frames until it fades out
      // scatterAge staggers initial particles so they don't all pulse together
      this.life = scatterAge ? p5.random(this.maxLife) : this.maxLife;
    }

    update() {
      this.x += this.vx;
      this.y += this.vy;
      this.life--;

      // Wrap around edges
      if (this.x < -10) this.x = p5.width + 10;
      else if (this.x > p5.width + 10) this.x = -10;
      if (this.y < -10) this.y = p5.height + 10;
      else if (this.y > p5.height + 10) this.y = -10;

      if (this.life <= 0) this.respawn();
    }

    alpha() {
      if (this.life > this.maxLife - FADE_FRAMES) {
        // Fading in
        return p5.map(
          this.life,
          this.maxLife,
          this.maxLife - FADE_FRAMES,
          0,
          255,
        );
      }
      if (this.life < FADE_FRAMES) {
        // Fading out
        return p5.map(this.life, 0, FADE_FRAMES, 0, 255);
      }
      return 255;
    }

    display() {
      let alpha = this.alpha() * 0.8;
      p5.noStroke();
      if (isDarkMode) {
        p5.fill(255, 255, 200, alpha);
      } else {
        p5.fill(50, 50, 50, alpha);
      }
      p5.circle(this.x, this.y, this.size);
    }
  }
}

export default function Background() {
  const { isDark } = useTheme();

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        opacity: 0.7,
      }}
    >
      <ReactP5Wrapper sketch={sketch} isDark={isDark} />
    </div>
  );
}

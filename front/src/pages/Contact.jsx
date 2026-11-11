const Contact = () => {
  return (
    <div className="contact">
      <h2 className="contact-label">Contact</h2>
      <ul className="contact-channels">
        <li>
          <span className="k">Email</span>
          <div className="channel-body">
            <a href="mailto:ops@xfokus.ai">ops@xfokus.ai</a>
            <p>Formal inquiries — partnerships, press, operations.</p>
          </div>
        </li>
        <li>
          <span className="k">Telegram</span>
          <div className="channel-body">
            <a href="https://t.me/wertikalk" target="_blank" rel="noreferrer">
              t.me/wertikalk
            </a>
            <p>The fastest way to reach the team directly.</p>
          </div>
        </li>
      </ul>

      <h2 className="contact-label social-label">Social</h2>
      <ul className="contact-channels">
        <li>
          <span className="k">X</span>
          <div className="channel-body">
            <a href="https://x.com/XFokusAI" target="_blank" rel="noreferrer">
              x.com/XFokusAI
            </a>
            <p>Updates, matches, and announcements.</p>
          </div>
        </li>
        <li>
          <span className="k">LinkedIn</span>
          <div className="channel-body">
            <a
              href="https://www.linkedin.com/company/xfokus-ai"
              target="_blank"
              rel="noreferrer"
            >
              linkedin.com/company/xfokus-ai
            </a>
            <p>Company page — press and professional updates.</p>
          </div>
        </li>
      </ul>
    </div>
  );
};

export default Contact;

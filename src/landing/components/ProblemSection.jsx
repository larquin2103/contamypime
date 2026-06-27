import { LANDING_CONTENT } from '../content';
import { getIconComponent } from '../../lib/icons';

export function ProblemSection() {
  const { problem } = LANDING_CONTENT;

  return (
    <section className="landing-section">
      <h2 className="landing-section__title">{problem.heading}</h2>
      <div className="problem-grid">
        {problem.items.map((item, i) => (
          <div key={i} className="problem-card">
            <div className="problem-card__icon">
              {getIconComponent(item.icon)}
            </div>
            <h3 className="problem-card__title">{item.title}</h3>
            <p className="problem-card__desc">{item.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

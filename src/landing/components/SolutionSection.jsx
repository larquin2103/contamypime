import { LANDING_CONTENT } from '../content';

export function SolutionSection() {
  const { solution } = LANDING_CONTENT;

  return (
    <section className="landing-section">
      <h2 className="landing-section__title">{solution.heading}</h2>
      <div className="solution-list">
        {solution.items.map((item, i) => (
          <div key={i} className="solution-item">
            <div className="solution-item__check">✓</div>
            <p className="solution-item__text">{item}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

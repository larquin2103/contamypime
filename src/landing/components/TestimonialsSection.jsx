import { LANDING_CONTENT } from '../content';

export function TestimonialsSection() {
  const { testimonials } = LANDING_CONTENT;

  return (
    <section className="landing-section">
      <h2 className="landing-section__title">{testimonials.heading}</h2>
      <div className="testimonials-grid">
        {testimonials.items.map((testimonial, i) => (
          <div key={i} className="testimonial-card">
            <div className="testimonial-card__emoji">{testimonial.emoji}</div>
            <p className="testimonial-card__text">"{testimonial.text}"</p>
            <div className="testimonial-card__author">
              <h4 className="testimonial-card__name">{testimonial.name}</h4>
              <p className="testimonial-card__business">{testimonial.business}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

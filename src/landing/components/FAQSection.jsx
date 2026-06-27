import { useState } from 'react';
import { LANDING_CONTENT } from '../content';
import { ChevronDown } from 'lucide-react';

export function FAQSection() {
  const { faq } = LANDING_CONTENT;
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <section className="landing-section">
      <h2 className="landing-section__title">{faq.heading}</h2>
      <div className="faq-list">
        {faq.items.map((item, i) => (
          <div
            key={i}
            className={`faq-item ${openIndex === i ? 'is-open' : ''}`}
          >
            <button
              className="faq-item__question"
              onClick={() => setOpenIndex(openIndex === i ? null : i)}
            >
              <span>{item.q}</span>
              <ChevronDown size={20} className="faq-item__toggle" />
            </button>
            <div className="faq-item__answer">
              <p className="faq-item__answer-text">{item.a}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

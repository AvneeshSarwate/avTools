import { useEffect, useState } from "react";
import { LESSONS } from "./lessons";
import { REFS } from "./lessons/refs";
import { Bench } from "./ui/Bench";

function parseHash() {
  const [, id, step] = window.location.hash.split("/");
  const index = Math.max(0, LESSONS.findIndex((l) => l.id === id));
  return { index, step: Math.max(0, Math.min(Number(step) || 0, LESSONS[index].steps.length - 1)) };
}

export function App() {
  const [where, setWhere] = useState(parseHash);
  useEffect(() => {
    const onHash = () => {
      setWhere(parseHash());
      document.querySelector("main")?.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const lesson = LESSONS[where.index];
  const step = lesson.steps[where.step];
  const href = (index: number, stepIndex = 0) => `#/${LESSONS[index].id}/${stepIndex}`;

  const previous =
    where.step > 0 ? href(where.index, where.step - 1)
    : where.index > 0 ? href(where.index - 1, LESSONS[where.index - 1].steps.length - 1) : null;
  const next =
    where.step < lesson.steps.length - 1 ? href(where.index, where.step + 1)
    : where.index < LESSONS.length - 1 ? href(where.index + 1) : null;

  const parts = [...new Set(LESSONS.map((l) => l.part))];

  return (
    <div className="layout">
      <nav className="contents">
        <div className="masthead">
          <div className="masthead-title">FM Synthesis</div>
          <div className="masthead-sub">A playable manual</div>
        </div>
        {parts.map((part) => (
          <section key={part}>
            <h2>{part}</h2>
            <ol>
              {LESSONS.map((l, i) =>
                l.part === part ? (
                  <li key={l.id} className={i === where.index ? "current" : ""}>
                    <a href={href(i)}>
                      <span className="num">{l.number}</span>
                      {l.title}
                    </a>
                  </li>
                ) : null,
              )}
            </ol>
          </section>
        ))}
      </nav>

      <main>
        <article>
          <header>
            <div className="kicker">
              {lesson.part} · {lesson.number}
            </div>
            <h1>{lesson.title}</h1>
            {lesson.steps.length > 1 && (
              <ol className="steps">
                {lesson.steps.map((s, i) => (
                  <li key={i} className={i === where.step ? "current" : ""}>
                    <a href={href(where.index, i)}>
                      <span className="num">{i + 1}</span>
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            )}
          </header>

          <section className="prose">
            {lesson.steps.length > 1 && <h2>{step.title}</h2>}
            {step.body}
          </section>

          <Bench key={`${lesson.id}/${where.step}`} step={step} />

          {step.tryThis && (
            <section className="prose try">
              <h3>Things to try</h3>
              <ul>
                {step.tryThis.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </section>
          )}

          {lesson.refs && (
            <section className="refs">
              <h3>Sources</h3>
              <ul>
                {lesson.refs.map((key) => (
                  <li key={key}>
                    <a href={REFS[key].url} target="_blank" rel="noreferrer">{REFS[key].label}</a>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="pager">
            {previous ? <a href={previous}>← Previous</a> : <span />}
            {next ? <a href={next}>Next →</a> : <span />}
          </footer>
        </article>
      </main>
    </div>
  );
}
